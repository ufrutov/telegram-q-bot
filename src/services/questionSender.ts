/**
 * Question Sender Service
 * Shared logic for sending questions to Telegram chats
 * Used by both webhook and cron endpoints
 */

import type TelegramBot from "node-telegram-bot-api";
import type { RedisClientType } from "redis";

import QuestionLoader from "@/lib/QuestionLoader/QuestionLoader.js";
import { MESSAGES } from "@/bot/constants.js";
import type { Complexity, Question } from "@/types/question.js";
import type { ThreadOpts } from "@/types/telegram.js";

interface SendQuestionResult {
  answerKey: string;
  questionMessageId: number;
}

interface AnswerPayload {
  answer: string;
  answerPreview: string[];
  packId: string | number | null;
}

interface HintPayload {
  question: string;
  answer: string;
  description: string | undefined;
  questionMessageId: number;
  questionPreview?: string[];
}

const DEFAULT_TARGET = "gotquestions.online";
const REDIS_TTL_SECONDS = 3600 * 24; // 24 hours

/**
 * Sends a question message to a Telegram chat with answer/hint inline buttons.
 *
 * Delivery strategy:
 *   - If the question has preview images → sends as a media group, then a
 *     separate "Ответ на вопрос" message with inline buttons (reply to media).
 *   - If no images → single text message with inline buttons attached.
 *
 * Redis persistence:
 *   - Stores the answer (with optional answerPreview images) under `answer:{chatId}:{id}`
 *   - Stores hint context (question, answer, description, previews) under `hint:{chatId}:{id}`
 *   - Both keys expire after 24 hours.
 *
 * Forum topics:
 *   - When `threadId` is provided and the chat is a forum supergroup, all outgoing
 *     messages include `message_thread_id` so they appear inside the correct topic.
 *   - Non-forum chats ignore this field — `threadOpts` resolves to `{}`.
 */
export async function sendQuestionMessage(
  bot: TelegramBot,
  redisClient: RedisClientType | undefined,
  chatId: string | number,
  complexity: Complexity = "random",
  questionId: string | undefined = undefined,
  threadId: number | undefined = undefined,
): Promise<SendQuestionResult> {
  const threadOpts: ThreadOpts = threadId ? { message_thread_id: threadId } : {};

  // Send loading message
  const loadingMsg = await bot.sendMessage(chatId, "🔄 Загружаю вопрос...", threadOpts);

  // Load question from the question service
  const questionLoader = QuestionLoader(DEFAULT_TARGET, complexity);
  let questionData: Question;
  try {
    questionData = await questionLoader.loadQuestion(questionId, redisClient ?? undefined);
  } catch (loadError) {
    try {
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    } catch {
      /* ignore */
    }
    const message = loadError instanceof Error ? loadError.message : String(loadError);
    const statusMatch = message.match(/HTTP error! status: (\d+)/);
    const statusCode = statusMatch ? ` (${statusMatch[1]})` : "";
    await bot.sendMessage(chatId, `${MESSAGES.ERROR_LOADING_QUESTION}${statusCode}`, threadOpts);
    throw loadError;
  }

  // Format question and answer for Telegram (MarkdownV2)
  const { question, answer } = questionLoader.formatForTelegram(questionData, true, complexity);

  console.log(
    `[${chatId}${threadId ? `_${threadId}` : ""}] ${complexity} question: ${questionData.link}`,
  );

  try {
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch {
    /* ignore */
  }

  // Generate Redis keys for answer and hint storage
  const answerKey = `answer:${chatId}:${questionData.id}`;
  const hintKey = `hint:${chatId}:${questionData.id}`;

  // If question has preview images, send as media group
  if (questionData.questionPreview && questionData.questionPreview.length > 0) {
    const media = questionData.questionPreview.map((url, index) => ({
      type: "photo" as const,
      media: url,
      ...(index === 0 && {
        caption: question,
        parse_mode: "MarkdownV2" as const,
      }),
    }));

    try {
      const messages = await bot.sendMediaGroup(chatId, media, { ...threadOpts });
      const questionMessage = messages[0];
      if (!questionMessage) {
        throw new Error("sendMediaGroup returned empty messages array");
      }

      const separate = await bot.sendMessage(chatId, "Ответ на вопрос", {
        ...threadOpts,
        reply_to_message_id: questionMessage.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📖 Ответ", callback_data: JSON.stringify({ answerKey }) },
              { text: "✨ Подсказка", callback_data: JSON.stringify({ hintKey }) },
            ],
          ],
        },
      });

      if (redisClient) {
        const answerPreview = questionData.answerPreview ?? [];
        const answerPayload: AnswerPayload = {
          answer,
          answerPreview,
          packId: questionData.packId ?? null,
        };
        await redisClient.setEx(answerKey, REDIS_TTL_SECONDS, JSON.stringify(answerPayload));

        const hintPayload: HintPayload = {
          question: questionData.question ?? "",
          answer: questionData.answer ?? "",
          description: questionData.description,
          questionMessageId: questionMessage.message_id,
          questionPreview: questionData.questionPreview,
        };
        await redisClient.setEx(hintKey, REDIS_TTL_SECONDS, JSON.stringify(hintPayload));
      }

      return { answerKey, questionMessageId: separate.message_id };
    } catch (imgError) {
      console.error("Error sending question media group:", imgError);
      // Fall through to send without images
    }
  }

  // Send question as regular text message with inline buttons
  const questionMessage = await bot.sendMessage(chatId, question, {
    ...threadOpts,
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📖 Ответ", callback_data: JSON.stringify({ answerKey }) },
          { text: "✨ Подсказка", callback_data: JSON.stringify({ hintKey }) },
        ],
      ],
    },
  });

  if (redisClient) {
    const answerPreview = questionData.answerPreview ?? [];
    const answerPayload: AnswerPayload = {
      answer,
      answerPreview,
      packId: questionData.packId ?? null,
    };
    await redisClient.setEx(answerKey, REDIS_TTL_SECONDS, JSON.stringify(answerPayload));

    const hintPayload: HintPayload = {
      question: questionData.question ?? "",
      answer: questionData.answer ?? "",
      description: questionData.description,
      questionMessageId: questionMessage.message_id,
    };
    await redisClient.setEx(hintKey, REDIS_TTL_SECONDS, JSON.stringify(hintPayload));
  }

  return { answerKey, questionMessageId: questionMessage.message_id };
}

export default sendQuestionMessage;
