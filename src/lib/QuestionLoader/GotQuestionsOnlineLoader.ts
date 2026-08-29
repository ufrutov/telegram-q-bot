import type { RedisClientType } from "redis";

import BaseQuestionLoader from "./BaseQuestionLoader.js";
import { formatDate } from "@/utils/date.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import { COMPLEXITY_EMOJI, PACK_MAX_QUESTIONS_TO_SHOW } from "@/bot/constants.js";
import * as gotQuestionsAuth from "@/services/gotQuestionsAuth.js";
import type { Complexity, Pack, PackQuestionRef, Question } from "@/types/question.js";

/**
 * Server Action id used by the /search page to execute a question search.
 * This is a content hash of the deployed action — update it if the site
 * ships a breaking change (search requests will start returning 500).
 */
const SEARCH_ACTION_ID = "40bd142d2a21500c570305efe2c01cb555aa696469";

/**
 * TrueDL complexity ranges. The new site ignores these server-side (the
 * question search always returns the same pool), so they are kept only to
 * mirror the site's search UI request shape.
 */
const COMPLEXITY_RANGES: Record<Complexity, { min: number; max: number; pages: number }> = {
  random: { min: 0.1, max: 4.5, pages: 500 },
  easy: { min: 0.1, max: 3.5, pages: 500 },
  medium: { min: 3.5, max: 6.5, pages: 500 },
  hard: { min: 6.5, max: 10, pages: 500 },
};

interface RawQuestion {
  id: string | number;
  packId?: string | number | null;
  number?: number;
  text?: string;
  razdatkaText?: string;
  razdatkaPic?: string;
  answer?: string;
  zachet?: string;
  comment?: string;
  commentPic?: string;
  answerPic?: string;
  complexity?: Array<string | number>;
  tour?: { pack?: RawPack };
}

interface RawPack {
  id: string | number;
  pubDate?: string;
  title: string;
  trueDl?: Array<string | number>;
  truedls?: Array<string | number>;
  legacyTournaments?: Array<{ truedl?: string | number }>;
  tours?: Array<{ questions?: RawQuestion[] }>;
}

/**
 * GotQuestionsOnlineLoader - Loads questions from gotquestions.online
 *
 * The site is a Next.js (App Router) application. The old JSON API (`/api/search`,
 * `/api/question`, `/api/pack`) is gone — those paths now redirect to HTML pages,
 * while the search itself is executed by a Next.js Server Action (`POST /search`
 * with the `Next-Action` header) that returns RSC flight JSON. Question/pack data
 * is embedded as JSON inside the pages' RSC payload.
 */
export default class GotQuestionsOnlineLoader extends BaseQuestionLoader {
  readonly baseUrl: string;
  readonly pages: number;
  readonly complexity: Complexity;
  readonly maxRetries: number = 3;

  /**
   * In-memory pack cache (per invocation) — multiple questions on a search
   * page often share a pack, so avoid re-fetching the same pack page.
   */
  private packCache = new Map<string | number, Pack | null>();

  constructor(target: string = "gotquestions.online", complexity: Complexity = "random") {
    super();
    const range = COMPLEXITY_RANGES[complexity] ?? COMPLEXITY_RANGES.medium;
    this.baseUrl = `https://${target}`;
    this.pages = range.pages;
    this.complexity = complexity;
  }

  /**
   * Calculate delay before next retry attempt (exponential backoff)
   */
  private _getRetryDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt - 1), 4000);
  }

  /**
   * Check if error is a client-side HTTP error (4xx).
   * Client errors are not retryable — they will never succeed on retry.
   */
  private _isClientError(error: Error): boolean {
    const match = error.message.match(/^HTTP error! status: (\d+)/);
    if (!match) return false;
    const status = parseInt(match[1] ?? "0", 10);
    return status >= 400 && status < 500;
  }

  /**
   * Get auth headers (Better Auth session cookie). Missing/expired credentials
   * are tolerated — the current site serves questions without authentication.
   */
  private async _getAuthHeaders(redis?: RedisClientType): Promise<Record<string, string>> {
    try {
      const cookie = await gotQuestionsAuth.getSessionCookie(redis);
      return cookie ? { Cookie: cookie } : {};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[Auth] No session cookie, continuing without auth:", message);
      return {};
    }
  }

  /**
   * Fetch URL with optional Better Auth session cookie.
   * On 401: clears cached session, re-authenticates, retries once.
   * Throws on any non-OK status.
   */
  private async _fetchWithAuth(
    url: string,
    init: RequestInit = {},
    redis?: RedisClientType,
  ): Promise<Response> {
    const authHeaders = await this._getAuthHeaders(redis);
    let response = await fetch(url, { ...init, headers: { ...init.headers, ...authHeaders } });

    if (response.status === 401) {
      console.warn("[Auth] 401 received, clearing cache and retrying...");
      await gotQuestionsAuth.clearCachedToken(redis);
      const newAuthHeaders = await this._getAuthHeaders(redis);
      response = await fetch(url, { ...init, headers: { ...init.headers, ...newAuthHeaders } });
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response;
  }

  // ---------------------------------------------------------------------------
  // RSC payload helpers — the site embeds its data as serialized JSON inside
  // `self.__next_f.push([1, "<string>"])` scripts in every page.
  // ---------------------------------------------------------------------------

  /**
   * Concatenate all RSC payload strings embedded in an HTML page.
   */
  private _extractRscPayload(html: string): string {
    const chunks: string[] = [];
    const re = /self\.__next_f\.push\(\[1,\s*"((?:\\.|[^"\\])*)"\]\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html))) {
      try {
        chunks.push(JSON.parse(`"${match[1]}"`) as string);
      } catch {
        /* skip malformed chunk */
      }
    }
    return chunks.join("");
  }

  /**
   * Find the index of the matching closing brace for `{` at `start`.
   * Returns -1 if unbalanced.
   */
  private _matchBrace(text: string, start: number): number {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /**
   * Find and parse the first `"<key>":{...}` JSON object in `text`
   * matching an optional predicate.
   */
  private _findJsonObject<T>(
    text: string,
    key: string,
    predicate?: (obj: unknown) => boolean,
  ): T | null {
    const searchStr = `"${key}":{`;
    let idx = 0;
    while (true) {
      idx = text.indexOf(searchStr, idx);
      if (idx === -1) return null;
      const start = idx + searchStr.length - 1;
      const end = this._matchBrace(text, start);
      if (end !== -1) {
        try {
          const parsed = JSON.parse(text.slice(start, end + 1)) as T;
          if (!predicate || predicate(parsed)) return parsed;
        } catch {
          /* keep scanning */
        }
      }
      idx += searchStr.length;
    }
  }

  /**
   * Parse a Server Action (RSC flight) response and return the `questions` array.
   */
  private _parseSearchResponse(text: string): RawQuestion[] {
    for (const line of text.split("\n")) {
      if (!line.match(/^\d+:\{/)) continue;
      const json = line.slice(line.indexOf(":") + 1);
      try {
        const obj = JSON.parse(json) as { questions?: RawQuestion[] };
        if (Array.isArray(obj.questions)) return obj.questions;
      } catch {
        /* try next flight segment */
      }
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  /**
   * Build the search URL query params, mirroring the site's search UI.
   */
  private _searchParams(page: number): string {
    const range = COMPLEXITY_RANGES[this.complexity] ?? COMPLEXITY_RANGES.medium;
    const params = new URLSearchParams({
      type: "questions",
      solo: "false",
      uDL: "true",
      ansSearch: "true",
      textSearch: "true",
      commSearch: "true",
      sourceSearch: "false",
      or: "false",
      withdrawn: "false",
      toTrueDL: range.max.toString(),
      fromD: "34",
      uD: "true",
      limit: "1",
      page: String(page),
    });
    return params.toString();
  }

  /**
   * Build the Server Action argument body (JSON array of one args object).
   */
  private _searchBody(page: number): string {
    const range = COMPLEXITY_RANGES[this.complexity] ?? COMPLEXITY_RANGES.medium;
    const args = {
      type: "questions",
      solo: false,
      uDL: true,
      ansSearch: true,
      textSearch: true,
      commSearch: true,
      sourceSearch: false,
      or: false,
      withdrawn: false,
      toTrueDL: range.max,
      fromD: 34,
      uD: true,
      limit: 1,
      page,
    };
    return JSON.stringify([args]);
  }

  /**
   * Fetch a page of questions from the /search Server Action.
   */
  private async _fetchSearchQuestions(
    page: number,
    redis?: RedisClientType,
  ): Promise<RawQuestion[]> {
    const url = `${this.baseUrl}/search?${this._searchParams(page)}`;
    const response = await this._fetchWithAuth(
      url,
      {
        method: "POST",
        headers: {
          Accept: "text/x-component",
          "Content-Type": "text/plain;charset=UTF-8",
          "Next-Action": SEARCH_ACTION_ID,
          Origin: this.baseUrl,
          Referer: url,
        },
        body: this._searchBody(page),
      },
      redis,
    );
    const text = await response.text();
    return this._parseSearchResponse(text);
  }

  // ---------------------------------------------------------------------------
  // Data normalization
  // ---------------------------------------------------------------------------

  /**
   * Convert a mixed (number|string) array into an array of finite numbers.
   */
  private _toNumbers(values?: Array<string | number> | null): number[] | undefined {
    if (!values || values.length === 0) return undefined;
    const nums = values.map((v) => Number(v)).filter((n) => Number.isFinite(n));
    return nums.length > 0 ? nums : undefined;
  }

  /**
   * Strip the RSC `$D` marker from serialized dates
   * (e.g. `"$D2012-09-03T00:00:00.000Z"` → `"2012-09-03T00:00:00.000Z"`),
   * so formatDate can parse them.
   */
  private _cleanRscDate(value: string | null | undefined): string | undefined {
    if (value == null) return undefined;
    const s = String(value).trim();
    if (!s) return undefined;
    return s.startsWith("$D") ? s.slice(2) : s;
  }

  /**
   * Average TrueDL of a pack, or null if unknown.
   */
  private _trueDlOf(packData: Pack | null): number | null {
    if (!packData?.trueDl || packData.trueDl.length === 0) return null;
    return packData.trueDl.reduce((a, b) => a + b, 0) / packData.trueDl.length;
  }

  /**
   * Whether a pack TrueDL matches the requested complexity range.
   * `random` accepts anything; unknown TrueDL counts as a match (fail-open).
   */
  private _matchesComplexity(trueDl: number | null): boolean {
    if (this.complexity === "random" || trueDl == null) return true;
    const range = COMPLEXITY_RANGES[this.complexity] ?? COMPLEXITY_RANGES.medium;
    return trueDl >= range.min && trueDl <= range.max;
  }

  /**
   * Normalize a raw question: derive `packId` from the embedded tour.pack.
   */
  private _normalizeQuestion(raw: RawQuestion): RawQuestion {
    const packId = raw.tour?.pack?.id ?? raw.packId;
    return { ...raw, packId: packId ?? null };
  }

  /**
   * Build a pack object from a raw pack embed.
   * Pack TrueDL lives on the pack page as `legacyTournaments[].truedl`.
   */
  private _packFromRaw(packRaw: RawPack): Pack {
    const questions: PackQuestionRef[] = [];
    if (Array.isArray(packRaw.tours)) {
      for (const tour of packRaw.tours) {
        if (tour.questions) {
          for (const q of tour.questions) {
            questions.push({ id: q.id });
          }
        }
      }
    }
    const legacyTruedl = packRaw.legacyTournaments
      ?.map((t) => t.truedl)
      .filter((v): v is string | number => v != null);
    const trueDl = this._toNumbers(
      legacyTruedl && legacyTruedl.length > 0
        ? legacyTruedl
        : (packRaw.trueDl ?? packRaw.truedls),
    );
    return {
      id: packRaw.id,
      title: packRaw.title || "",
      pubDate: this._cleanRscDate(packRaw.pubDate),
      trueDl,
      total: questions.length,
      questions: questions.slice(0, PACK_MAX_QUESTIONS_TO_SHOW),
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Extract image URLs from razdatka fields
   */
  extractImages(razdatkaPic: string | undefined | null): string[] {
    const images: string[] = [];
    if (razdatkaPic) {
      let imgSrc = razdatkaPic;
      if (imgSrc.startsWith("/")) {
        imgSrc = this.baseUrl + imgSrc;
      }
      images.push(imgSrc);
    }
    return images;
  }

  /**
   * Load Questions Pack data — parsed from the `/pack/<id>` page RSC payload
   *
   * @param packId - Pack ID to load
   * @param redis - Optional Redis client for token caching
   * @returns Pack data object, or null if not found
   */
  async loadPackData(packId: string | number, redis?: RedisClientType): Promise<Pack | null> {
    if (!packId) {
      return null;
    }

    const cached = this.packCache.get(packId);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const url = `${this.baseUrl}/pack/${packId}`;
      const response = await this._fetchWithAuth(url, {}, redis);
      const html = await response.text();
      const rsc = this._extractRscPayload(html);
      const packRaw = this._findJsonObject<RawPack>(rsc, "pack", (obj) => {
        if (typeof obj !== "object" || obj === null) return false;
        return String((obj as RawPack).id) === String(packId);
      });
      if (!packRaw) {
        this.packCache.set(packId, null);
        return null;
      }
      const pack = this._packFromRaw(packRaw);
      this.packCache.set(packId, pack);
      return pack;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to load pack ${packId}: ${message}`);
      this.packCache.set(packId, null);
      return null;
    }
  }

  /**
   * Parse question data from the new-site JSON shape into the normalized Question.
   */
  parseQuestionData(
    questionData: RawQuestion,
    questionLink: string,
    packData: Pack | null = null,
  ): Question {
    const result: Question = {
      id: questionData.id,
      packId: questionData.packId ?? null,
      number: questionData.number,
      question: null,
      answer: null,
      description: undefined,
      questionPreview: [],
      answerPreview: [],
      link: questionLink,
    };

    // Parse question text and preview
    if (questionData.text) {
      result.question = questionData.text.trim();
    }

    // Add razdatka text if present
    if (questionData.razdatkaText) {
      const razdatkaText = questionData.razdatkaText.trim();
      if (razdatkaText) {
        result.question = result.question
          ? `${result.question}\n\n> ${razdatkaText}`
          : `> ${razdatkaText}`;
      }
    }

    // Extract preview images from razdatkaPic (question images)
    if (questionData.razdatkaPic) {
      const images = this.extractImages(questionData.razdatkaPic);
      result.questionPreview?.push(...images);
    }

    // Parse answer
    if (questionData.answer) {
      result.answer = questionData.answer.trim();
    }

    // Add zachet (accepted answer) to description
    const descriptionParts: string[] = [];

    if (questionData.zachet) {
      const zachet = questionData.zachet.trim();
      if (zachet) {
        descriptionParts.push(`Зачёт: ${zachet}`);
      }
    }

    // Add comment to description
    if (questionData.comment) {
      const comment = questionData.comment.trim();
      if (comment) {
        descriptionParts.push(comment);
      }
    }

    // Add complexity percent to description
    const complexityValues = this._toNumbers(questionData.complexity);
    if (complexityValues) {
      const complexityEmoji = COMPLEXITY_EMOJI[this.complexity] ?? "↗️";
      let complexityText = `[${complexityEmoji}](${this.baseUrl}/question/${questionData.id})`;

      // Add pack complexity (TrueDL) if available
      if (Array.isArray(packData?.trueDl) && packData.trueDl.length > 0) {
        const packComplexity = (
          packData.trueDl.reduce((a, b) => a + b, 0) / packData.trueDl.length
        ).toFixed(1);
        complexityText += ` Cложность *${escapeMarkdownV2(packComplexity)}*`;
        result.trueDl = packComplexity;
      }

      const questionComplexity = (
        complexityValues.reduce((a, b) => a + b, 0) / complexityValues.length
      ).toFixed(1);

      complexityText += ` • *${escapeMarkdownV2(questionComplexity)}%* верных ответов`;

      // Add pack info if available
      if (packData?.title) {
        const escapedTitle = escapeMarkdownV2(packData.title);
        complexityText += `\n[*${escapedTitle}*](${this.baseUrl}/pack/${packData.id}/) • ${formatDate(packData.pubDate)}`;
      }

      descriptionParts.push(complexityText);
    }

    if (descriptionParts.length > 0) {
      result.description = descriptionParts.join("\n\n");
    }

    // Add answerPic to answer preview if present
    if (questionData.answerPic) {
      const answerImages = this.extractImages(questionData.answerPic);
      result.answerPreview?.push(...answerImages);
    }

    // Add commentPic to answer preview if present
    if (questionData.commentPic) {
      const commentImages = this.extractImages(questionData.commentPic);
      result.answerPreview?.push(...commentImages);
    }

    // Clean up empty fields
    if (result.questionPreview && result.questionPreview.length === 0) {
      delete result.questionPreview;
    }
    if (result.answerPreview && result.answerPreview.length === 0) {
      delete result.answerPreview;
    }
    if (!result.description) {
      delete result.description;
    }

    return result;
  }

  /**
   * Load a question from gotquestions.online.
   *
   * If `questionId` is provided, loads that specific question from the
   * `/question/<id>` page RSC payload. Otherwise loads a random question
   * via the /search Server Action.
   *
   * Retry Logic:
   * - Client errors (4xx, except 401): No retry, fails immediately
   * - Server errors (5xx) or network errors: Retries up to 3 times with exponential backoff
   * - Delay between retries: 1s, 2s, 4s (max)
   * - 401 handled: Cookie refresh + single retry (before the retry loop)
   */
  async loadQuestion(questionId?: string | number, redis?: RedisClientType): Promise<Question> {
    // If a specific question id is provided, fetch it directly and return
    if (questionId != null) {
      try {
        const url = `${this.baseUrl}/question/${questionId}`;
        const response = await this._fetchWithAuth(url, {}, redis);
        const html = await response.text();
        const rsc = this._extractRscPayload(html);
        const raw = this._findJsonObject<RawQuestion>(rsc, "question", (obj) => {
          if (typeof obj !== "object" || obj === null) return false;
          const q = obj as RawQuestion;
          return "text" in q || String(q.id) === String(questionId);
        });
        if (!raw) {
          throw new Error("Question not found in page");
        }
        const normalized = this._normalizeQuestion(raw);
        const packData = normalized.packId
          ? await this.loadPackData(normalized.packId, redis)
          : null;
        const questionLink = `${this.baseUrl}/question/${normalized.id}`;

        return this.parseQuestionData(normalized, questionLink, packData);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load question ${questionId}: ${message}`);
      }
    }

    // The search Server Action ignores the difficulty filter server-side
    // (verified: toTrueDL=0.1 and toTrueDL=10 return the same pool), so the
    // range is enforced here, as a best-effort filter: sample a few random
    // pages and return the first question whose pack TrueDL fits the range.
    let lastError: Error | null = null;
    let fallback: { normalized: RawQuestion; packData: Pack | null } | null = null;
    let closest: {
      normalized: RawQuestion;
      packData: Pack | null;
      distance: number;
    } | null = null;
    const range = COMPLEXITY_RANGES[this.complexity] ?? COMPLEXITY_RANGES.medium;
    const maxPages = 6;
    const maxChecks = 30;
    let checks = 0;

    for (let attempt = 1; attempt <= maxPages; attempt++) {
      // Generate random page number between 1 and X
      const randomPage = Math.floor(Math.random() * this.pages) + 1;
      let questions: RawQuestion[];
      try {
        questions = await this._fetchSearchQuestions(randomPage, redis);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (this._isClientError(lastError)) {
          console.error(`Failed to load question: ${lastError.message}`);
          throw new Error(`Failed to load question: ${lastError.message}`);
        }
        const delay = this._getRetryDelay(attempt);
        console.warn(
          `Attempt ${attempt} failed: ${lastError.message}. Retrying in ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (questions.length === 0) {
        continue;
      }

      const normalized = questions.map((q) => this._normalizeQuestion(q));
      for (let i = normalized.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [normalized[i], normalized[j]] = [normalized[j], normalized[i]];
      }

      for (const questionData of normalized) {
        // The pack page is fetched anyway for TrueDL display, so checking the
        // range here costs nothing extra.
        const packData = questionData.packId
          ? await this.loadPackData(questionData.packId, redis)
          : null;
        if (!fallback) {
          fallback = { normalized: questionData, packData };
        }
        checks++;
        const trueDl = this._trueDlOf(packData);
        if (this._matchesComplexity(trueDl)) {
          const questionLink = `${this.baseUrl}/question/${questionData.id}`;

          return this.parseQuestionData(questionData, questionLink, packData);
        }
        // Track the candidate closest to the requested range so the fail-open
        // fallback at least returns the "least wrong" question.
        if (trueDl != null) {
          const distance =
            trueDl < range.min
              ? range.min - trueDl
              : trueDl > range.max
                ? trueDl - range.max
                : 0;
          if (!closest || distance < closest.distance) {
            closest = { normalized: questionData, packData, distance };
          }
        }
        if (checks >= maxChecks) {
          break;
        }
      }
      if (checks >= maxChecks) {
        break;
      }
    }

    // Budget exhausted without finding an in-range question — fail open with
    // the closest match (or the first candidate) instead of failing the request.
    const best = closest ?? fallback;
    if (best) {
      const questionLink = `${this.baseUrl}/question/${best.normalized.id}`;
      return this.parseQuestionData(best.normalized, questionLink, best.packData);
    }

    // Should be unreachable — the loop always returns or throws
    throw lastError ?? new Error("Failed to load question: unknown error");
  }
}