/**
 * Callback Query Handler - Routes button presses
 */

import type TelegramBot from "node-telegram-bot-api";
import type { RedisClientType } from "redis";

import questionCallback from "./callbacks/questionCallback.js";
import answerCallback from "./callbacks/answerCallback.js";
import hintCallback from "./callbacks/hintCallback.js";
import packQuestionCallback from "./callbacks/packQuestionCallback.js";
import { sendPackMessage } from "@/services/packSender.js";
import type { CallbackAction } from "@/types/telegram.js";

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: {
    chat?: { id?: number | string };
    message_id: number;
    message_thread_id?: number;
  };
}

function isCallbackAction(value: unknown): value is CallbackAction {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.action === "question") return typeof v.complexity === "string";
  if (v.action === "packQuestion") return v.questionId !== undefined;
  if (v.action === "pack") return v.packId !== undefined;
  if (typeof v.answerKey === "string") return true;
  if (typeof v.hintKey === "string") return true;
  return false;
}

export default async function callbackHandler(
  bot: TelegramBot,
  redis: RedisClientType | null,
  callbackQuery: TelegramCallbackQuery,
): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  const threadId = callbackQuery.message?.message_thread_id;

  if (!chatId) {
    return;
  }

  let parsed: CallbackAction | null = null;
  if (callbackQuery.data) {
    try {
      const raw = JSON.parse(callbackQuery.data) as unknown;
      if (isCallbackAction(raw)) {
        parsed = raw;
      }
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    return;
  }

  if ("action" in parsed) {
    if (parsed.action === "question") {
      await questionCallback(bot, redis, callbackQuery, parsed, threadId);
    } else if (parsed.action === "packQuestion") {
      await packQuestionCallback(bot, redis, callbackQuery, parsed, threadId);
    } else if (parsed.action === "pack") {
      // Handle "Играть весь пакет" button - reuses /pack command infrastructure
      try {
        await bot.answerCallbackQuery(callbackQuery.id);

        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: callbackQuery.message?.message_id },
          );
        } catch {
          // Ignore "message is not modified" — button was already removed
        }

        await sendPackMessage(bot, redis ?? undefined, chatId, String(parsed.packId), threadId);
      } catch (error) {
        console.error("Error loading pack from answer button:", error);
      }
    }
  } else if ("answerKey" in parsed) {
    await answerCallback(bot, redis, callbackQuery, parsed, threadId);
  } else if ("hintKey" in parsed) {
    await hintCallback(bot, redis, callbackQuery, parsed, threadId);
  }
}
