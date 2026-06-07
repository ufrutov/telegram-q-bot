/**
 * BaseQuestionLoader - Abstract base class for question loaders
 */

import type { RedisClientType } from "redis";

import { escapeMarkdownV2 } from "@/utils/markdown.js";
import { COMPLEXITY_EMOJI } from "@/bot/constants.js";
import type { Complexity, Question } from "@/types/question.js";

export default abstract class BaseQuestionLoader {
  /**
   * Format question for Telegram message
   *
   * @param questionData - Question data object
   * @param split - If true, returns question and answer/description separately
   * @param complexity - Complexity level used to pick the emoji
   * @returns Object with formatted question and answer texts
   */
  formatForTelegram(
    questionData: Question,
    split: boolean = false,
    complexity?: Complexity,
  ): { question: string; answer: string } {
    const parts: { question: string; answer: string } = {
      question: "",
      answer: "",
    };

    // Format question section
    if (questionData.question) {
      const prefix = questionData.link ? `[❓](${questionData.link})` : "❓";
      parts.question = `${prefix} *Вопрос ${questionData.number}*`;

      if (questionData.id) {
        parts.question += escapeMarkdownV2(` • #i${questionData.id}`);
      }

      if (questionData.trueDl != null) {
        const complexityEmoji = complexity ? COMPLEXITY_EMOJI[complexity] : "↗️";
        parts.question += ` • Cложность: *${escapeMarkdownV2(String(questionData.trueDl))}* ${complexityEmoji}`;
      }

      parts.question += `\n${escapeMarkdownV2(questionData.question)}`;
    }

    // Format answer and description
    const answerParts: string[] = [];

    if (questionData.answer) {
      answerParts.push(`✅ *Ответ:*\n${escapeMarkdownV2(questionData.answer)}`);
    }

    if (questionData.description) {
      answerParts.push(`💬 *Комментарий:*\n${escapeMarkdownV2(questionData.description)}`);
    }

    const answerText = answerParts.join("\n\n");

    // Combine or split based on split parameter
    if (split) {
      parts.answer = answerText;
    } else {
      if (parts.question && answerText) {
        parts.question += "\n\n" + answerText;
      } else if (answerText) {
        parts.question = answerText;
      }
    }

    return {
      question: parts.question.trim(),
      answer: parts.answer.trim(),
    };
  }

  /**
   * Load a question - must be implemented by subclasses
   */
  abstract loadQuestion(questionId?: string | number, redis?: RedisClientType): Promise<Question>;
}
