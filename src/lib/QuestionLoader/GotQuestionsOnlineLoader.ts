import type { RedisClientType } from "redis";

import BaseQuestionLoader from "./BaseQuestionLoader.js";
import { formatDate } from "@/utils/date.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import { COMPLEXITY_EMOJI, PACK_MAX_QUESTIONS_TO_SHOW } from "@/bot/constants.js";
import * as gotQuestionsAuth from "@/services/gotQuestionsAuth.js";
import type { Complexity, Pack, PackQuestionRef, Question } from "@/types/question.js";

/**
 * Max pack id used for random pack sampling. Current newest pack id is ~7030;
 * ids above the real max return 404 and are simply resampled.
 */
const PACK_ID_MAX = 7400;

/**
 * TrueDL complexity ranges (pack difficulty index).
 * The site's /search ignores difficulty filters server-side and caps its
 * results at 10 000 questions, so the range is enforced here, on the pack's
 * TrueDL (legacyTournaments[].truedl).
 */
const COMPLEXITY_RANGES: Record<Complexity, { min: number; max: number }> = {
  random: { min: 0.1, max: 4.5 },
  easy: { min: 0.1, max: 3.5 },
  medium: { min: 3.5, max: 6.5 },
  hard: { min: 6.5, max: 10 },
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
 * `/api/question`, `/api/pack`) is gone — those paths now serve HTML pages with
 * the data embedded in the page's RSC payload (`self.__next_f.push([1, ...])`).
 *
 * Random questions are selected by sampling a random pack id in `1..PACK_ID_MAX`
 * and loading `/pack/<id>` (which embeds every question of the pack plus the
 * pack TrueDL in `legacyTournaments[].truedl`). This reaches the whole DB in a
 * single request per question, unlike `/search`, which is capped at 10 000
 * results and ignores the difficulty filters.
 */
export default class GotQuestionsOnlineLoader extends BaseQuestionLoader {
  readonly baseUrl: string;
  readonly complexity: Complexity;
  readonly maxRetries: number = 3;

  /**
   * In-memory pack cache (per invocation). Packs are reused across questions
   * of the same pack, so avoid re-fetching the same pack page.
   */
  private packCache = new Map<string | number, { pack: Pack | null; questions: RawQuestion[] }>();

  constructor(target: string = "gotquestions.online", complexity: Complexity = "random") {
    super();
    this.baseUrl = `https://${target}`;
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
   * Fetch a full pack page: parsed pack object + every question of the pack
   * (the page RSC payload embeds all questions with full fields).
   */
  private async _fetchPack(
    packId: string | number,
    redis?: RedisClientType,
  ): Promise<{ pack: Pack | null; questions: RawQuestion[] }> {
    const cached = this.packCache.get(packId);
    if (cached !== undefined) {
      return cached;
    }

    const empty = { pack: null, questions: [] as RawQuestion[] };
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
        this.packCache.set(packId, empty);
        return empty;
      }

      const questions: RawQuestion[] = [];
      if (Array.isArray(packRaw.tours)) {
        for (const tour of packRaw.tours) {
          if (tour.questions) {
            questions.push(...tour.questions);
          }
        }
      }
      const result = { pack: this._packFromRaw(packRaw), questions };
      this.packCache.set(packId, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to load pack ${packId}: ${message}`);
      this.packCache.set(packId, empty);
      return empty;
    }
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
   * `random` accepts anything; an unknown TrueDL is rejected for the other
   * ranges so a question isn't labeled by a difficulty we can't verify.
   */
  private _matchesComplexity(trueDl: number | null): boolean {
    if (this.complexity === "random") return true;
    if (trueDl == null) return false;
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
    const result = await this._fetchPack(packId, redis);
    return result.pack;
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

    // A random question is selected by sampling a random pack id and loading
    // `/pack/<id>`, which embeds every question plus the pack TrueDL. This
    // covers the whole DB in one request per question (unlike /search, which
    // is capped at 10 000 results and ignores difficulty filters).
    let lastError: Error | null = null;
    let fallback: { q: RawQuestion; pack: Pack | null } | null = null;
    let closest: { q: RawQuestion; pack: Pack | null; distance: number } | null = null;
    const range = COMPLEXITY_RANGES[this.complexity] ?? COMPLEXITY_RANGES.medium;
    // `random` accepts the first valid pack; difficulty ranges may need more
    // samples, so budget accordingly (hard is the rarest range).
    const maxSamples =
      this.complexity === "random" ? 1 : this.complexity === "hard" ? 10 : 15;

    for (let attempt = 1; attempt <= maxSamples; attempt++) {
      // Sample a random pack id (gaps above the real max return 404 → resample)
      const packId = Math.floor(Math.random() * PACK_ID_MAX) + 1;
      let result: { pack: Pack | null; questions: RawQuestion[] };
      try {
        result = await this._fetchPack(packId, redis);
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

      const { pack } = result;
      if (!pack || result.questions.length === 0) {
        continue; // nonexistent pack id or empty pack
      }

      const questionData = result.questions[Math.floor(Math.random() * result.questions.length)];
      if (!questionData) {
        continue;
      }
      const normalized: RawQuestion = { ...questionData, packId: pack.id ?? packId };

      if (!fallback) {
        fallback = { q: normalized, pack };
      }

      const trueDl = this._trueDlOf(pack);
      if (this._matchesComplexity(trueDl)) {
        const questionLink = `${this.baseUrl}/question/${normalized.id}`;

        return this.parseQuestionData(normalized, questionLink, pack);
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
          closest = { q: normalized, pack, distance };
        }
      }

      // Pace requests to stay under the site's rate limits
      await new Promise((r) => setTimeout(r, 150));
    }

    // Budget exhausted without finding an in-range question — fail open with
    // the closest match (or the first candidate) instead of failing the request.
    const best = closest ?? fallback;
    if (best) {
      const questionLink = `${this.baseUrl}/question/${best.q.id}`;
      return this.parseQuestionData(best.q, questionLink, best.pack);
    }

    // Should be unreachable — the loop usually samples a valid pack quickly
    throw lastError ?? new Error("Failed to load question: unknown error");
  }
}