/**
 * Stats Command Handler - /stats
 *
 * Renders the lifetime stats report. The send logic lives in the exported
 * sendStatsReport() helper so both this command and the "📊 Статистика"
 * menu callback share one code path.
 */

import type TelegramBot from "node-telegram-bot-api";

import { formatStats, getStats } from "@/services/stats.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import type { ThreadOpts } from "@/types/telegram.js";

interface TelegramMessage {
  chat?: { id?: number | string };
  text?: string;
  message_thread_id?: number;
}

/**
 * Fetch, render, and deliver the stats report for a chat/topic.
 * Handles unregistered chats, empty data, and all error paths internally.
 */
export async function sendStatsReport(
  bot: TelegramBot,
  chatId: number | string,
  threadId: number | undefined,
): Promise<void> {
  const threadOpts: ThreadOpts = threadId ? { message_thread_id: threadId } : {};

  try {
    const result = await getStats(chatId, threadId);
    if (!result.ok) {
      await bot.sendMessage(chatId, `❌ ${escapeMarkdownV2(result.error)}`, {
        ...threadOpts,
        parse_mode: "MarkdownV2",
      });
      return;
    }

    const report = result.value;
    const totalLoaded = report.sends.reduce((sum, b) => sum + b.loaded, 0);
    if (totalLoaded === 0 && report.failures === 0) {
      await bot.sendMessage(
        chatId,
        "📊 *Статистика*\n\nПока нет данных\\. Задайте вопрос: /question",
        { ...threadOpts, parse_mode: "MarkdownV2" },
      );
      return;
    }

    await bot.sendMessage(chatId, formatStats(report), {
      ...threadOpts,
      parse_mode: "MarkdownV2",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[statsCommand] error:", message);
    try {
      await bot.sendMessage(chatId, "❌ Ошибка при получении статистики", threadOpts);
    } catch {
      // ignore
    }
  }
}

export default async function statsCommand(
  bot: TelegramBot,
  message: TelegramMessage,
  threadId: number | undefined,
): Promise<void> {
  const chatId = message.chat?.id;
  if (!chatId) return;

  await sendStatsReport(bot, chatId, threadId);
}
