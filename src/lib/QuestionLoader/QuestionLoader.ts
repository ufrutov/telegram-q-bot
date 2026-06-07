import ChgkInfoQuestionLoader from "./ChgkInfoQuestionLoader.js";
import GotQuestionsOnlineLoader from "./GotQuestionsOnlineLoader.js";
import type { Complexity } from "@/types/question.js";

export type Target = "gotquestions.online" | "questions.chgk.info";

const LOADER_MAP: Record<Target, typeof GotQuestionsOnlineLoader | typeof ChgkInfoQuestionLoader> =
  {
    "questions.chgk.info": ChgkInfoQuestionLoader,
    "gotquestions.online": GotQuestionsOnlineLoader,
  };

/**
 * QuestionLoader - Factory function for creating question loaders based on target
 *
 * @param target - The target source for questions
 * @param complexity - The complexity level (random, easy, medium, hard)
 * @returns An instance of the appropriate question loader
 */
export default function QuestionLoader(
  target: Target = "gotquestions.online",
  complexity: Complexity = "random",
): GotQuestionsOnlineLoader | ChgkInfoQuestionLoader {
  const LoaderClass = LOADER_MAP[target];

  if (!LoaderClass) {
    throw new Error(
      `Unknown target: ${target}. Available targets: ${Object.keys(LOADER_MAP).join(", ")}`,
    );
  }

  return new LoaderClass(target, complexity);
}
