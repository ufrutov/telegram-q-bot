/**
 * Stats Menu Callback - "📊 Статистика" button in /menu
 *
 * Reuses the same report pipeline as the /stats command via sendStatsReport,
 * then closes the menu message — same behavior as the difficulty buttons.
 */

import type TelegramBot from "node-telegram-bot-api";

import { sendStatsReport } from "../commands/statsCommand.js";

interface TelegramCallbackQuery {
  id: string;
  message?: {
    chat?: { id?: number | string };
    message_id: number;
  };
}

export default async function menuStatsCallback(
  bot: TelegramBot,
  callbackQuery: TelegramCallbackQuery,
  threadId: number | undefined,
): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  if (!chatId) return;

  await bot.answerCallbackQuery(callbackQuery.id);
  await sendStatsReport(bot, chatId, threadId);

  try {
    await bot.deleteMessage(chatId, callbackQuery.message?.message_id ?? 0);
  } catch {
    // Ignore deletion errors — menu may already be gone
  }
}
