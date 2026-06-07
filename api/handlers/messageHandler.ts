/**
 * Message Handler - Processes text commands
 */

import type TelegramBot from "node-telegram-bot-api";
import type { RedisClientType } from "redis";

import { sendQuestionMessage } from "@/services/questionSender.js";
import { sendPackMessage } from "@/services/packSender.js";
import { MESSAGES } from "@/bot/constants.js";
import type { Complexity } from "@/types/question.js";

interface TelegramMessage {
  chat?: { id?: number | string };
  text?: string;
  message_thread_id?: number;
}

const COMPLEXITY_MAP: Record<string, Complexity> = {
  "/question": "random",
  "/questioneasy": "easy",
  "/questionmedium": "medium",
  "/questionhard": "hard",
};

async function handleQuestionCommand(
  bot: TelegramBot,
  redis: RedisClientType | null,
  chatId: number | string,
  messageText: string,
  threadId: number | undefined,
): Promise<void> {
  const parts = messageText.split(/\s+/);
  const questionId = parts.length > 1 && /^\d+$/.test(parts[1] ?? "") ? parts[1] : null;
  const complexity = COMPLEXITY_MAP[parts[0] ?? ""] ?? "random";

  await sendQuestionMessage(
    bot,
    redis ?? undefined,
    chatId,
    complexity,
    questionId ?? undefined,
    threadId,
  );
}

async function handleMenuCommand(
  bot: TelegramBot,
  chatId: number | string,
  threadId: number | undefined,
): Promise<void> {
  const threadOpts = threadId ? { message_thread_id: threadId } : {};

  await bot.sendMessage(chatId, MESSAGES.MENU_TITLE, {
    ...threadOpts,
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: MESSAGES.DIFFICULTY_EASY,
            callback_data: JSON.stringify({
              action: "question",
              complexity: "easy",
            }),
          },
        ],
        [
          {
            text: MESSAGES.DIFFICULTY_MEDIUM,
            callback_data: JSON.stringify({
              action: "question",
              complexity: "medium",
            }),
          },
        ],
        [
          {
            text: MESSAGES.DIFFICULTY_HARD,
            callback_data: JSON.stringify({
              action: "question",
              complexity: "hard",
            }),
          },
        ],
        [
          {
            text: MESSAGES.DIFFICULTY_RANDOM,
            callback_data: JSON.stringify({
              action: "question",
              complexity: "random",
            }),
          },
        ],
      ],
    },
  });
}

async function handlePackCommand(
  bot: TelegramBot,
  redis: RedisClientType | null,
  chatId: number | string,
  messageText: string,
  threadId: number | undefined,
): Promise<void> {
  const parts = messageText.split(/\s+/);
  const packId = parts.length > 1 && /^\d+$/.test(parts[1] ?? "") ? parts[1] : null;

  await sendPackMessage(bot, redis ?? undefined, chatId, packId, threadId);
}

/**
 * Main message handler
 */
export default async function messageHandler(
  bot: TelegramBot,
  redis: RedisClientType | null,
  message: TelegramMessage,
): Promise<void> {
  const chatId = message.chat?.id;
  const messageText = message.text;
  const threadId = message.message_thread_id;

  if (!chatId) {
    console.error("Invalid message structure: missing chat.id");
    return;
  }

  if (!messageText) return;

  try {
    if (messageText.startsWith("/question")) {
      await handleQuestionCommand(bot, redis, chatId, messageText, threadId);
    } else if (messageText.startsWith("/menu")) {
      await handleMenuCommand(bot, chatId, threadId);
    } else if (messageText.startsWith("/pack")) {
      await handlePackCommand(bot, redis, chatId, messageText, threadId);
    }
  } catch (error) {
    console.error("Error handling message:", error);
  }
}
