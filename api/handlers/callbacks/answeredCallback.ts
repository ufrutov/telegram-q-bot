/**
 * Answered Callback Handler - "✅ Ответ найден" button on an answer message
 *
 * Flow:
 *   1. Flag tq-bot-question_sends.question_answered = TRUE for the row
 *      identified by (chat_id, mid) — `mid` is the telegram_message_id of
 *      the original question message, embedded in callback_data.
 *   2. On success: remove this button from the keyboard (Играть весь пакет
 *      and anything else stays) and send the confirmation message.
 *   3. On DB failure: alert and keep the button so the user can retry.
 */

import type TelegramBot from "node-telegram-bot-api";

import { recordQuestionAnswered } from "@/services/questionSendStore.js";
import { MESSAGES } from "@/bot/constants.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import type {
  CallbackAction,
  InlineButton,
  InlineKeyboardMarkup,
  ThreadOpts,
} from "@/types/telegram.js";

interface TelegramCallbackQuery {
  id: string;
  message?: {
    chat?: { id?: number | string };
    message_id: number;
    reply_markup?: InlineKeyboardMarkup & {
      inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
    };
  };
}

/**
 * Copy of the current keyboard minus every ✅ Ответ найден button.
 * Empty rows are dropped; other buttons (e.g. Играть весь пакет) survive.
 */
function stripAnsweredButton(markup: TelegramCallbackQuery["message"]): InlineKeyboardMarkup {
  const rows = markup?.reply_markup?.inline_keyboard ?? [];
  const filtered = rows
    .map((row) => row.filter((btn) => btn.text !== MESSAGES.BUTTON_ANSWERED))
    .filter((row): row is InlineButton[] => row.length > 0);
  return { inline_keyboard: filtered };
}

export default async function answeredCallback(
  bot: TelegramBot,
  callbackQuery: TelegramCallbackQuery,
  parsed: Extract<CallbackAction, { action: "answered" }>,
  threadId: number | undefined,
): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  if (!chatId || messageId === undefined) return;

  const threadOpts: ThreadOpts = threadId ? { message_thread_id: threadId } : {};

  // DB write first — the UI changes only after a successful update.
  const result = await recordQuestionAnswered({
    chatId,
    threadId,
    telegramMessageId: parsed.mid,
  });

  if (!result.ok) {
    console.error("[answeredCallback] db update failed:", result.error);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: "❌ Не удалось сохранить. Попробуйте ещё раз.",
      show_alert: true,
    });
    return;
  }

  await bot.answerCallbackQuery(callbackQuery.id);

  try {
    await bot.editMessageReplyMarkup(stripAnsweredButton(callbackQuery.message), {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (editError) {
    const editMessage = editError instanceof Error ? editError.message : String(editError);
    if (!editMessage.includes("message is not modified")) {
      console.error("Error removing answered button:", editMessage);
    }
  }

  try {
    await bot.sendMessage(chatId, escapeMarkdownV2(MESSAGES.ANSWER_COUNTED), {
      ...threadOpts,
      parse_mode: "MarkdownV2",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[answeredCallback] confirmation send failed:", message);
  }
}
