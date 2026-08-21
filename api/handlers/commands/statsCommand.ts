/**
 * Stats Command Handler - /stats [7d|30d|all]
 *
 * Reads tq-bot-question_sends and tq-bot-load_failures and renders a
 * MarkdownV2 report. Falls back to a friendly message if the DB is empty.
 */

import type TelegramBot from "node-telegram-bot-api";

import { formatStats, getStats, type StatsWindow } from "@/services/stats.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import type { ThreadOpts } from "@/types/telegram.js";

interface TelegramMessage {
  chat?: { id?: number | string };
  text?: string;
  message_thread_id?: number;
}

const VALID_WINDOWS = new Set<StatsWindow>(["7d", "30d", "all"]);

function parseWindow(text: string): StatsWindow {
  const parts = text.split(/\s+/).slice(1);
  const arg = (parts[0] ?? "7d").toLowerCase();
  if (VALID_WINDOWS.has(arg as StatsWindow)) {
    return arg as StatsWindow;
  }
  return "7d";
}

export default async function statsCommand(
  bot: TelegramBot,
  message: TelegramMessage,
  threadId: number | undefined,
): Promise<void> {
  const chatId = message.chat?.id;
  if (!chatId) return;

  const threadOpts: ThreadOpts = threadId ? { message_thread_id: threadId } : {};
  const window = parseWindow(message.text ?? "");

  try {
    const result = await getStats(chatId, threadId, window);
    if (!result.ok) {
      await bot.sendMessage(chatId, `❌ ${escapeMarkdownV2(result.error)}`, {
        ...threadOpts,
        parse_mode: "MarkdownV2",
      });
      return;
    }

    const report = result.value;
    if (report.totalLoaded === 0 && report.failures === 0) {
      await bot.sendMessage(
        chatId,
        `📊 *Статистика* \\(${escapeMarkdownV2(window)}\\)\n\nПока нет данных. Задайте вопрос: /question`,
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
