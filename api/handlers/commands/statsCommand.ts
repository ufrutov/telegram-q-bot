/**
 * Stats Command Handler - /stats
 *
 * Reads lifetime aggregates from tq-bot-question_sends and
 * tq-bot-load_failures via the stats service and renders a MarkdownV2
 * report. Falls back to a friendly message if the chat has no data yet.
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

export default async function statsCommand(
  bot: TelegramBot,
  message: TelegramMessage,
  threadId: number | undefined,
): Promise<void> {
  const chatId = message.chat?.id;
  if (!chatId) return;

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
