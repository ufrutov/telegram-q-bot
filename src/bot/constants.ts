/**
 * Bot Constants - Centralized strings and configuration
 */

import type { Complexity } from "@/types/question.js";

export const TARGET_DOMAIN = "gotquestions.online";
export const PACK_MAX_QUESTIONS_TO_SHOW = 36;
export const PACK_QUESTIONS_PER_ROW = 6;

/** Emoji mapped to each complexity level. */
export const COMPLEXITY_EMOJI: Record<Complexity, string> = {
  random: "🌀",
  easy: "🎯",
  medium: "💡",
  hard: "🤯",
};

export const MESSAGES = {
  MENU_TITLE: "❓ Выбор категории вопроса:",
  DIFFICULTY_EASY: "🎯 Лёгкий вопрос",
  DIFFICULTY_MEDIUM: "💡 Стандартный вопрос",
  DIFFICULTY_HARD: "🤯 Сложный вопрос",
  DIFFICULTY_RANDOM: "🌀 Случайный вопрос",

  ANSWER_EXPIRED: "⏰ Время ответа истекло.\nУвидеть ответ можно по ссылке ниже ↗️",
  HINT_EXPIRED: "⏰ Время подсказки истекло.",
  HINT_LOADING: "✨ Загружаю подсказку...",

  ERROR_LOADING_QUESTION: "❌ Ошибка при загрузке вопроса",
  ERROR_LOADING_ANSWER: "❌ Ошибка при загрузке ответа",
  ERROR_LOADING_HINT: "❌ Ошибка при загрузке подсказки",
} as const;
