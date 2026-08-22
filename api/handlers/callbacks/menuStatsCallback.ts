/**
 * Stats Menu Callback - "📊 Статистика" button in /menu
 *
 * Reuses the same report pipeline as the /stats command via sendStatsReport.
 */

import type TelegramBot from "node-telegram-bot-api";

import { sendStatsReport } from "../commands/statsCommand.js";

interface TelegramCallbackQuery {
  id: string;
  message?: {
    chat?: { id?: number | string };
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
}
