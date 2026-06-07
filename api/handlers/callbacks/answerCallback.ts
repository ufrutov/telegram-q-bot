/**
 * Answer Callback Handler - Show answer button
 */

import type TelegramBot from "node-telegram-bot-api";
import type { RedisClientType } from "redis";

import { TARGET_DOMAIN, MESSAGES } from "@/bot/constants.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import type { ThreadOpts } from "@/types/telegram.js";

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

    if (answerPreview && answerPreview.length > 0) {
      const media = answerPreview.map((url, index) => ({
        type: "photo" as const,
        media: url,
        ...(index === 0 && {
          caption: answer,
          parse_mode: "MarkdownV2" as const,
        }),
      }));

      try {
        await bot.sendMediaGroup(chatId, media, {
          ...threadOpts,
          reply_to_message_id: messageToReply,
        });
      } catch (imgError) {
        console.error("Error sending answer media group:", imgError);
        await bot.sendMessage(chatId, answer, {
          ...threadOpts,
          parse_mode: "MarkdownV2",
          reply_to_message_id: messageToReply,
          disable_web_page_preview: true,
        });
      }
    } else {
      const replyMarkup = packId
        ? {
            inline_keyboard: [
              [
                {
                  text: MESSAGES.BUTTON_PLAY_PACK,
                  callback_data: JSON.stringify({ action: "pack", packId }),
                },
              ],
            ],
          }
        : undefined;

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
