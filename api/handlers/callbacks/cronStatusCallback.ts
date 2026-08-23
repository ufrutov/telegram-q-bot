/**
 * Cron Status Menu Callback - "⏰ Ежедневный вопрос" button in /menu
 *
 * Renders the same status card (with the on/off toggle) as /cron status,
 * then closes the menu message — same behavior as the difficulty buttons.
 */

import type TelegramBot from "node-telegram-bot-api";

import {
  buildCronKeyboard,
  buildCronStatusText,
  resolveCronState,
} from "../commands/cronCommand.js";
import type { ThreadOpts } from "@/types/telegram.js";

interface TelegramCallbackQuery {
  id: string;
  message?: {
    chat?: { id?: number | string };
    message_id: number;
  };
}

export default async function cronStatusCallback(
  bot: TelegramBot,
  callbackQuery: TelegramCallbackQuery,
  threadId: number | undefined,
): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  if (!chatId) return;

  const threadOpts: ThreadOpts = threadId ? { message_thread_id: threadId } : {};

  await bot.answerCallbackQuery(callbackQuery.id);

  try {
    const state = await resolveCronState(chatId, threadId);
    await bot.sendMessage(chatId, buildCronStatusText(state), {
      ...threadOpts,
      parse_mode: "MarkdownV2",
      reply_markup: buildCronKeyboard(state.enabled),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cronStatusCallback] error:", message);
    try {
      await bot.sendMessage(chatId, "❌ Ошибка при получении статуса", threadOpts);
    } catch {
      // ignore
    }
  }

  try {
    await bot.deleteMessage(chatId, callbackQuery.message?.message_id ?? 0);
  } catch {
    // Ignore deletion errors — menu may already be gone
  }
}
