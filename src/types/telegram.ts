/**
 * Telegram-related types
 */

import type { Complexity } from "./question.js";

/**
 * Forum topic thread id (optional). When set, outgoing messages include
 * `message_thread_id` so they appear inside the correct topic.
 */
export type ThreadId = number | undefined;

/**
 * `message_thread_id` option spread into Telegram API calls.
 */
export interface ThreadOpts {
  message_thread_id?: number;
}

/**
 * Discriminated union of all possible callback_data payloads produced by the bot.
 *
 * - `action: "question"` — user picked a difficulty in /menu
 * - `action: "packQuestion"` — user picked a numbered question from a pack keyboard
 * - `action: "pack"` — user clicked "Играть весь пакет" on an answer message
 * - `answerKey` (no action) — user clicked "📖 Ответ" on a question message
 * - `hintKey` (no action) — user clicked "✨ Подсказка" on a question message
 */
export type CallbackAction =
  | { action: "question"; complexity: Complexity }
  | { action: "packQuestion"; questionId: string | number }
  | { action: "pack"; packId: string | number }
  | { answerKey: string }
  | { hintKey: string };

/**
 * One entry parsed from `CRON_TARGET_CHATS` env var.
 * Format: `chatId` or `chatId_threadId` (e.g. `123456` or `123456_42`).
 */
export interface CronChatEntry {
  chatId: string;
  threadId: number | undefined;
}

/**
 * Minimal inline-keyboard button shape used by the bot.
 */
export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}
