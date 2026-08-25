/**
 * Answer Callback Handler - Show answer button
 */

import type TelegramBot from "node-telegram-bot-api";
import type { RedisClientType } from "redis";

import { TARGET_DOMAIN, MESSAGES } from "@/bot/constants.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import type { InlineButton, InlineKeyboardMarkup, ThreadOpts } from "@/types/telegram.js";

interface TelegramCallbackQuery {
  id: string;
  message?: {
    chat?: { id?: number | string };
    message_id: number;
  };
}

interface AnswerCallbackAction {
  answerKey: string;
}

interface AnswerData {
  answer: string;
  answerPreview?: string[];
  questionMessageId?: number;
  packId?: string | number | null;
}

export default async function answerCallback(
  bot: TelegramBot,
  redis: RedisClientType | null,
  callbackQuery: TelegramCallbackQuery,
  parsed: AnswerCallbackAction,
  threadId: number | undefined,
): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  const answerKey = parsed.answerKey;
  const threadOpts: ThreadOpts = threadId ? { message_thread_id: threadId } : {};

  if (!chatId || !answerKey) {
    return;
  }

  try {
    await bot.answerCallbackQuery(callbackQuery.id);

    const answerDataStr = redis ? await redis.get(answerKey) : null;
    const messageId = callbackQuery.message?.message_id;
    if (messageId === undefined) return;

    const questionId = answerKey.split(":").at(2);
    const logChat = threadId ? `${chatId}_${threadId}` : chatId;
    console.log(`[${logChat}] answer: https://${TARGET_DOMAIN}/question/${questionId}`);

    if (!answerDataStr) {
      await bot.sendMessage(chatId, escapeMarkdownV2(MESSAGES.ANSWER_EXPIRED), {
        ...threadOpts,
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `${MESSAGES.BUTTON_QUESTION_PREFIX} ${questionId}`,
                url: `https://${TARGET_DOMAIN}/question/${questionId}`,
              },
            ],
          ],
        },
      });
      return;
    }

    const answerData = JSON.parse(answerDataStr) as AnswerData;
    const { answer, answerPreview, questionMessageId, packId } = answerData;
    const messageToReply = questionMessageId ?? messageId;

    // Shared action row: 📦 Играть весь пакет when the answer belongs to a
    // pack, ✅ Засчитать ответ always.
    //
    // `messageId` is the message that carried the 📖/✨ buttons — the same
    // telegram_message_id stored in tq-bot-question_sends. Embedding it in
    // the callback lets answeredCallback flag the right row, because these
    // buttons live on a NEW message with a different id.
    const actionsRow: InlineButton[] = [];
    if (packId) {
      actionsRow.push({
        text: MESSAGES.BUTTON_PLAY_PACK,
        callback_data: JSON.stringify({ action: "pack", packId }),
      });
    }
    actionsRow.push({
      text: MESSAGES.BUTTON_ANSWERED,
      callback_data: JSON.stringify({ action: "answered", mid: messageId }),
    });
    const replyMarkup: InlineKeyboardMarkup = { inline_keyboard: [actionsRow] };

    if (answerPreview && answerPreview.length > 0) {
      // Telegram API constraint: sendMediaGroup cannot carry an inline
      // keyboard, so the buttons ride on a small carrier message after the
      // photo group (same pattern as the question flow).
      const media = answerPreview.map((url, index) => ({
        type: "photo" as const,
        media: url,
        ...(index === 0 && {
          caption: answer,
          parse_mode: "MarkdownV2" as const,
        }),
      }));

      let mediaSent = false;
      try {
        await bot.sendMediaGroup(chatId, media, {
          ...threadOpts,
          reply_to_message_id: messageToReply,
        });
        mediaSent = true;
      } catch (imgError) {
        console.error("Error sending answer media group:", imgError);
      }

      if (!mediaSent) {
        // Degraded path: deliver the answer as text, still with the buttons.
        await bot.sendMessage(chatId, answer, {
          ...threadOpts,
          parse_mode: "MarkdownV2",
          reply_to_message_id: messageToReply,
          disable_web_page_preview: true,
          reply_markup: replyMarkup,
        });
      } else {
        try {
          await bot.sendMessage(chatId, escapeMarkdownV2(MESSAGES.ANSWER_TITLE), {
            ...threadOpts,
            parse_mode: "MarkdownV2",
            reply_to_message_id: messageToReply,
            disable_web_page_preview: true,
            reply_markup: replyMarkup,
          });
        } catch (carrierError) {
          console.error("Error sending answer actions carrier:", carrierError);
        }
      }
    } else {
      await bot.sendMessage(chatId, answer, {
        ...threadOpts,
        parse_mode: "MarkdownV2",
        reply_to_message_id: messageToReply,
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      });
    }

    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: chatId, message_id: messageId },
      );
    } catch (editError) {
      console.error("Error removing reply markup:", editError);
    }

    if (questionMessageId) {
      try {
        await bot.deleteMessage(chatId, messageId);
      } catch (deleteError) {
        console.error(
          "Error deleting separated message after question with media group:",
          deleteError,
        );
      }
    }

    if (redis) {
      await redis.del(answerKey);
    }
  } catch (error) {
    console.error("Error handling callback query (answer):", error);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: MESSAGES.ERROR_LOADING_ANSWER,
      show_alert: true,
    });
  }
}
