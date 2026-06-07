/**
 * Domain types — questions and packs
 */

export type Complexity = "random" | "easy" | "medium" | "hard";

export const COMPLEXITIES: readonly Complexity[] = ["random", "easy", "medium", "hard"] as const;

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
  questionPreview?: string[];
  answerPreview?: string[];
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
