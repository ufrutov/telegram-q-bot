import type { RedisClientType } from "redis";

import BaseQuestionLoader from "./BaseQuestionLoader.js";
import { formatDate } from "@/utils/date.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import { COMPLEXITY_EMOJI, PACK_MAX_QUESTIONS_TO_SHOW } from "@/bot/constants.js";
import * as gotQuestionsAuth from "@/services/gotQuestionsAuth.js";
import type { Complexity, Pack, PackQuestionRef, Question } from "@/types/question.js";

/**
 * TrueDL complexity ranges mapping
 * Based on https://pecheny.me/blog/truedl/
 */
const COMPLEXITY_RANGES: Record<Complexity, { min: number; max: number; pages: number }> = {
  random: { min: 0.1, max: 4.5, pages: 500 },
  easy: { min: 0.1, max: 3.5, pages: 500 },
  medium: { min: 3.5, max: 6.5, pages: 500 },
  hard: { min: 6.5, max: 10, pages: 200 },
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
  complexity?: number[];
}

interface RawPack {
  id: string | number;
  pubDate?: string;
  title: string;
  trueDl?: number[];
  tours?: Array<{ questions?: RawQuestion[] }>;
}

interface RawPackResponse extends RawPack {
  tours?: Array<{ questions?: RawQuestion[] }>;
}

/**
 * GotQuestionsOnlineLoader - Loads questions from gotquestions.online
 */
export default class GotQuestionsOnlineLoader extends BaseQuestionLoader {
  readonly baseUrl: string;
  readonly apiUrl: string;
  readonly pages: number;
  readonly complexity: Complexity;
  readonly maxRetries: number = 3;

  constructor(target: string = "gotquestions.online", complexity: Complexity = "random") {
    super();
    const range = COMPLEXITY_RANGES[complexity] ?? COMPLEXITY_RANGES.medium;
    const params = new URLSearchParams({
      type: "questions",
      limit: "1",
      fromD: "50",
      toD: "100", // Процент взятия
      fromTrueDL: range.min.toString(),
      toTrueDL: range.max.toString(), // Сложность турнира `TrueDL`
    });
    this.baseUrl = `https://${target}`;
    this.apiUrl = `${this.baseUrl}/api/search/?${params}`;
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
   * Get authentication headers for API requests
   */
  private async _getAuthHeaders(redis?: RedisClientType): Promise<Record<string, string>> {
    const token = await gotQuestionsAuth.getAccessToken(redis);
    return { Authorization: `JWT ${token}` };
  }

  /**
   * Fetch URL with JWT authentication and automatic token refresh on 401.
   * On 401: clears cached token, re-authenticates, retries once.
   */
  private async _fetchWithAuth(url: string, redis?: RedisClientType): Promise<Response> {
    const headers = await this._getAuthHeaders(redis);
    const response = await fetch(url, { headers });

    if (response.status === 401) {
      console.warn("[Auth] 401 received, clearing cache and retrying...");
      await gotQuestionsAuth.clearCachedToken(redis);
      const newHeaders = await this._getAuthHeaders(redis);
      const retryResponse = await fetch(url, { headers: newHeaders });
      if (!retryResponse.ok) {
        throw new Error(`HTTP error! status: ${retryResponse.status}`);
      }
      return retryResponse;
    }

    return response;
  }

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
   * Extract question id from tag
   * `#i12345` -> `12345`
   */
  extractQuestionId(tag: string | number): string {
    if (tag.toString().startsWith("#")) {
      const match = tag.toString().match(/#[a-zA-Z]*(\d+)/);

      if (match && match.length > 1) {
        return match[1];
      } else {
        console.error(
          `[E][GotQuestionsOnlineLoader] Failed to extract Question ID from tag ${tag}`,
        );
      }

      return tag.toString();
    }

    return tag.toString();
  }

  /**
   * Load Questions Pack data from API
   *
   * @param packId - Pack ID to load
   * @param redis - Optional Redis client for token caching
   * @returns Pack data object, or null if not found
   */
  async loadPackData(packId: string | number, redis?: RedisClientType): Promise<Pack | null> {
    if (!packId) {
      return null;
    }

    try {
      const url = `${this.baseUrl}/api/pack/${packId}/`;
      const response = await this._fetchWithAuth(url, redis);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const packData = (await response.json()) as RawPackResponse;

      // Collect all questions from all tours
      const questions: RawQuestion[] = [];
      if (packData.tours && Array.isArray(packData.tours)) {
        for (const tour of packData.tours) {
          if (tour.questions && Array.isArray(tour.questions)) {
            questions.push(...tour.questions);
          }
        }
      }

      const total = questions.length;

      return {
        id: packData.id,
        pubDate: packData.pubDate,
        title: packData.title,
        trueDl: packData.trueDl,
        total,
        questions: questions.slice(0, PACK_MAX_QUESTIONS_TO_SHOW) as unknown as PackQuestionRef[],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to load pack ${packId}: ${message}`);
      return null;
    }
  }

  /**
   * Parse question data from API response
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
    if (questionData.complexity && questionData.complexity.length > 0) {
      const complexityEmoji = COMPLEXITY_EMOJI[this.complexity] ?? "↗️";
      let complexityText = `[${complexityEmoji}](${this.baseUrl}/question/${questionData.id})`;

      // Add pack complexity if available
      if (Array.isArray(packData?.trueDl) && packData.trueDl.length > 0) {
        const packComplexity = (
          packData.trueDl.reduce((a, b) => a + b, 0) / packData.trueDl.length
        ).toFixed(1);
        complexityText += ` Cложность *${escapeMarkdownV2(packComplexity)}*`;
        result.trueDl = packComplexity;
      }

      const questionComplexity = (
        questionData.complexity.reduce((a, b) => a + b, 0) / questionData.complexity.length
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
   * If `questionId` is provided, loads that specific question directly.
   * Otherwise loads a random question from the search API.
   *
   * Retry Logic:
   * - Client errors (4xx, except 401): No retry, fails immediately
   * - Server errors (5xx) or network errors: Retries up to 3 times with exponential backoff
   * - Delay between retries: 1s, 2s, 4s (max)
   * - 401 handled: Token refresh + single retry (before the retry loop)
   */
  async loadQuestion(questionId?: string | number, redis?: RedisClientType): Promise<Question> {
    // If a specific question id is provided, fetch it directly and return
    if (questionId != null) {
      try {
        questionId = this.extractQuestionId(questionId);
        const url = `${this.baseUrl}/api/question/${questionId}/`;
        const response = await this._fetchWithAuth(url, redis);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const questionData = (await response.json()) as RawQuestion;
        const questionLink = `${this.baseUrl}/question/${questionData.id}`;

        let packData: Pack | null = null;
        if (questionData.packId) {
          packData = await this.loadPackData(questionData.packId, redis);
        }

        return this.parseQuestionData(questionData, questionLink, packData);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load question ${questionId}: ${message}`);
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      // Generate random page number between 1 and X
      const randomPage = Math.floor(Math.random() * this.pages) + 1;
      const url = `${this.apiUrl}&page=${randomPage}`;
      try {
        const response = await this._fetchWithAuth(url, redis);
        const data = (await response.json()) as { questions?: RawQuestion[] };

        if (!data.questions || data.questions.length === 0) {
          throw new Error("No questions found in response");
        }

        const randomIndex = Math.floor(Math.random() * data.questions.length);
        const questionData = data.questions[randomIndex];
        if (!questionData) {
          throw new Error("Selected question is undefined");
        }
        const questionLink = `${this.baseUrl}/question/${questionData.id}`;

        let packData: Pack | null = null;
        if (questionData.packId) {
          packData = await this.loadPackData(questionData.packId, redis);
        }

        return this.parseQuestionData(questionData, questionLink, packData);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (this._isClientError(lastError) || attempt >= this.maxRetries) {
          console.error(
            `Failed to load question after ${attempt} attempt(s): ${lastError.message} | URL: ${url}`,
          );
          throw new Error(
            `Failed to load question after ${attempt} attempt(s): ${lastError.message}`,
          );
        }
        const delay = this._getRetryDelay(attempt);
        console.warn(
          `Attempt ${attempt} failed: ${lastError.message} | URL: ${url}. Retrying in ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    // Should be unreachable — the loop always returns or throws
    throw lastError ?? new Error("Failed to load question: unknown error");
  }
}
