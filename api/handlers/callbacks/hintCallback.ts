/**
 * Hint Callback Handler - AI hint generation
 */

import type TelegramBot from "node-telegram-bot-api";
import type { RedisClientType } from "redis";

import { generateHint, formatErrorMessage } from "@/services/openrouter.js";
import { MESSAGES } from "@/bot/constants.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import type { ThreadOpts } from "@/types/telegram.js";

interface TelegramCallbackQuery {
  id: string;
  message?: {
    chat?: { id?: number | string };
    message_id: number;
    reply_markup?: {
      inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
    };
  };
}

interface HintCallbackAction {
  hintKey: string;
}

interface HintData {
  question: string;
  answer: string;
  description?: string;
  questionMessageId?: number;
  questionPreview?: string[];
}

export default async function hintCallback(
  bot: TelegramBot,
  redis: RedisClientType | null,
  callbackQuery: TelegramCallbackQuery,
  parsed: HintCallbackAction,
  threadId: number | undefined,
): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  const hintKey = parsed.hintKey;
  const threadOpts: ThreadOpts = threadId ? { message_thread_id: threadId } : {};

  if (!chatId || !hintKey) {
    return;
  }

  try {
    await bot.answerCallbackQuery(callbackQuery.id);

    const hintDataStr = redis ? await redis.get(hintKey) : null;

    if (!hintDataStr) {
      await bot.sendMessage(chatId, MESSAGES.HINT_EXPIRED, threadOpts);
      return;
    }

    const hintData = JSON.parse(hintDataStr) as HintData;
    const { question, answer, description, questionMessageId, questionPreview = [] } = hintData;

    // Remove hint button from keyboard (keep answer button)
    try {
      const answerKeyMatch = callbackQuery.message?.reply_markup?.inline_keyboard?.[0]?.find(
        (btn) => btn.text === MESSAGES.BUTTON_ANSWER,
      );
      const newKeyboard = answerKeyMatch
        ? { inline_keyboard: [[answerKeyMatch]] }
        : { inline_keyboard: [] };

      await bot.editMessageReplyMarkup(newKeyboard, {
        chat_id: chatId,
        message_id: callbackQuery.message?.message_id,
      });
    } catch (editError) {
      console.error("Error removing reply markup:", editError);
    }

    // Generate hint using AI
    let hint: string;
    try {
      const loadingMsg = await bot.sendMessage(chatId, MESSAGES.HINT_LOADING, threadOpts);
      hint = await generateHint(question, answer, description, questionPreview);
      try {
        await bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch {
        // ignore
      }
    } catch (genError) {
      console.error("Error generating hint:", (genError as Error).message);
      hint = formatErrorMessage(genError);
    }

    const messageToReply = questionMessageId ?? callbackQuery.message?.message_id ?? 0;
    await bot.sendMessage(chatId, `💡 *Подсказка:*\n${escapeMarkdownV2(hint)}`, {
      ...threadOpts,
      parse_mode: "MarkdownV2",
      reply_to_message_id: messageToReply,
      disable_web_page_preview: true,
    });

    if (redis) {
      await redis.del(hintKey);
    }
  } catch (error) {
    console.error("Error handling callback query (hint):", error);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: MESSAGES.ERROR_LOADING_HINT,
      show_alert: true,
    });
  }
}
