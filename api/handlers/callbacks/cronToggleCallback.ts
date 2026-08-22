/**
 * Cron Toggle Callback - on/off button on the cron status card
 *
 * Flips cron_enabled via setCronEnabled (upserts the chats row if absent),
 * then edits the status message in place with the new state and the flipped
 * toggle. "message is not modified" races are swallowed.
 */

import type TelegramBot from "node-telegram-bot-api";

import { buildCronKeyboard, buildCronStatusText } from "../commands/cronCommand.js";
import { setCronEnabled } from "@/services/chatStore.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import type { CallbackAction, ThreadOpts } from "@/types/telegram.js";

interface TelegramCallbackQuery {
  id: string;
  message?: {
    chat?: { id?: number | string };
    message_id: number;
  };
}

export default async function cronToggleCallback(
  bot: TelegramBot,
  callbackQuery: TelegramCallbackQuery,
  parsed: Extract<CallbackAction, { action: "cronToggle" }>,
  threadId: number | undefined,
): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  if (!chatId || messageId === undefined) return;

  const threadOpts: ThreadOpts = threadId ? { message_thread_id: threadId } : {};

  await bot.answerCallbackQuery(callbackQuery.id);

  try {
    const result = await setCronEnabled(chatId, threadId, parsed.enable);
    if (!result.ok) {
      await bot.sendMessage(chatId, `❌ ${escapeMarkdownV2(result.error)}`, {
        ...threadOpts,
        parse_mode: "MarkdownV2",
      });
      return;
    }

    // Rebuild the card from the upsert result — reflects actual DB state.
    const state = {
      enabled: result.value.cron_enabled,
      time: result.value.cron_time.slice(0, 5),
      lastSentAt: result.value.cron_last_sent_at,
    };
    const text = buildCronStatusText(state);
    const replyMarkup = buildCronKeyboard(state.enabled);

    try {
      await bot.editMessageText(text, {
        ...threadOpts,
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "MarkdownV2",
        reply_markup: replyMarkup,
      });
    } catch (editError) {
      const editMessage = editError instanceof Error ? editError.message : String(editError);
      // Rapid double-clicks can produce an identical card; that's fine.
      if (editMessage.includes("message is not modified")) return;
      console.error("[cronToggleCallback] edit failed:", editMessage);
      // Fall back to a fresh message so the user still sees the outcome.
      await bot.sendMessage(chatId, text, {
        ...threadOpts,
        parse_mode: "MarkdownV2",
        reply_markup: replyMarkup,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cronToggleCallback] error:", message);
    try {
      await bot.sendMessage(chatId, "❌ Ошибка при переключении", threadOpts);
    } catch {
      // ignore
    }
  }
}
