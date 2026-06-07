/**
 * Question Callback Handler - Menu selection
 */

import type TelegramBot from "node-telegram-bot-api";
import type { RedisClientType } from "redis";

import { sendQuestionMessage } from "@/services/questionSender.js";
import { MESSAGES } from "@/bot/constants.js";
import type { CallbackAction } from "@/types/telegram.js";

interface TelegramCallbackQuery {
  id: string;
  message?: {
    chat?: { id?: number | string };
    message_id: number;
  };
}

export default async function questionCallback(
  bot: TelegramBot,
  redis: RedisClientType | null,
  callbackQuery: TelegramCallbackQuery,
  parsed: Extract<CallbackAction, { action: "question" }>,
  threadId: number | undefined,
): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  const complexity = parsed.complexity;

  if (!chatId) return;

  try {
    await bot.answerCallbackQuery(callbackQuery.id);
    await sendQuestionMessage(bot, redis ?? undefined, chatId, complexity, undefined, threadId);

    try {
      await bot.deleteMessage(chatId, callbackQuery.message?.message_id ?? 0);
    } catch {
      // Ignore deletion errors
    }
  } catch (error) {
    console.error("Error handling question callback:", error);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: MESSAGES.ERROR_LOADING_QUESTION,
      show_alert: true,
    });
  }
}
