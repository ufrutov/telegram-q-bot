/**
 * Pack Question Callback Handler - Handle question selection from pack keyboard
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

export default async function packQuestionCallback(
  bot: TelegramBot,
  redis: RedisClientType | null,
  callbackQuery: TelegramCallbackQuery,
  parsed: Extract<CallbackAction, { action: "packQuestion" }>,
  threadId: number | undefined,
): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  const questionId = parsed.questionId;

  if (!chatId || questionId === undefined) {
    return;
  }

  try {
    await bot.answerCallbackQuery(callbackQuery.id);

    // 'random' complexity is irrelevant here because we load by specific ID
    await sendQuestionMessage(
      bot,
      redis ?? undefined,
      chatId,
      "random",
      String(questionId),
      threadId,
    );
  } catch (error) {
    console.error("Error handling pack question callback:", error);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: MESSAGES.ERROR_LOADING_QUESTION,
      show_alert: true,
    });
  }
}
