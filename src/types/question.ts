/**
 * Domain types — questions and packs
 */

export type Complexity = "random" | "easy" | "medium" | "hard";

export const COMPLEXITIES: readonly Complexity[] = ["random", "easy", "medium", "hard"] as const;

/**
 * One preview image available locally as bytes. Used when the source URL
 * cannot be fetched by the Telegram Bot API directly (e.g. the upstream
 * site returns 403 to non-browser User-Agents). The `filename` is passed to
 * the Telegram Upload API so the file is stored under a sensible name.
 */
export interface PreviewBuffer {
  filename: string;
  buffer: Buffer;
}

/**
 * Normalized question object produced by all loaders.
 * Loader-specific fields (e.g. ChgkInfo vs GotQuestions) are optional.
 */
export interface Question {
  id: string | number;
  packId?: string | number | null;
  number?: number;
  question: string | null;
  answer: string | null;
  description?: string;
  /**
   * Preview image URLs (razdatka / question attachments). Each entry MAY
   * also have a matching byte buffer in `questionPreviewBuffer` at the same
   * index — callers should prefer uploading the buffer when present, and
   * fall back to the URL only when the buffer is missing.
   */
  questionPreview?: string[];
  /**
   * Parallel array of locally-downloaded preview buffers. Same length and
   * order as `questionPreview`; entries may be missing when the download
   * failed (downstream code falls back to the URL).
   */
  questionPreviewBuffer?: Array<PreviewBuffer | undefined>;
  /**
   * Answer-side preview image URLs (answerPic / commentPic). Follows the
   * same URL-first, buffer-preferred convention as `questionPreview`.
   */
  answerPreview?: string[];
  answerPreviewBuffer?: Array<PreviewBuffer | undefined>;
  link: string;
  trueDl?: string | number;
}

/**
 * A minimal question shape used by the pack keyboard (only id is needed).
 * `additionalQuestions` carries extra loader-specific fields if needed.
 */
export interface PackQuestionRef {
  id: string | number;
  [key: string]: unknown;
}

export interface Pack {
  id: string | number;
  title: string;
  pubDate?: string;
  trueDl?: number[];
  total: number;
  questions: PackQuestionRef[];
}
