/**
 * Question Sender Service
 * Shared logic for sending questions to Telegram chats
 * Used by both webhook and cron endpoints
 */

import type TelegramBot from "node-telegram-bot-api";
import type { RedisClientType } from "redis";

import QuestionLoader from "@/lib/QuestionLoader/QuestionLoader.js";
import { MESSAGES } from "@/bot/constants.js";
import {
  recordQuestionSent,
  type AnswerPayload,
  type HintPayload,
} from "@/services/questionSendStore.js";
import { recordLoadFailure } from "@/services/loadFailureStore.js";
import type { Complexity, Question } from "@/types/question.js";
import type { ThreadOpts } from "@/types/telegram.js";

interface SendQuestionResult {
  answerKey: string;
  questionMessageId: number;
}

const DEFAULT_TARGET = "gotquestions.online";

/**
 * Sends a question message to a Telegram chat with answer/hint inline buttons.
 *
 * Delivery strategy:
 *   - If the question has preview images → sends as a media group, then a
 *     separate "Ответ на вопрос" message with inline buttons (reply to media).
 *   - If no images → single text message with inline buttons attached.
 *
 * Supabase persistence:
 *   - Stores the answer and hint context on the matching question-send row.
 *   - The existing answer/hint callback keys are retained for Telegram UI
 *     compatibility, but no question interaction state is stored in Redis.
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
  title?: string,
): Promise<SendQuestionResult> {
  const threadOpts: ThreadOpts = threadId ? { message_thread_id: threadId } : {};

  // Send loading message
  const loadingMsg = await bot.sendMessage(chatId, MESSAGES.LOADING_QUESTION, threadOpts);

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
    await recordLoadFailure({
      chatId,
      threadId,
      complexity,
      error: message.slice(0, 1000),
      title,
    });
    await bot.sendMessage(chatId, `${MESSAGES.ERROR_LOADING_QUESTION}${statusCode}`, threadOpts);
    throw loadError;
  }

  // Format question and answer for Telegram (MarkdownV2)
  const { question, answer } = questionLoader.formatForTelegram(questionData, true, complexity);

  if (questionId) {
    console.log(
      `[${chatId}${threadId ? `_${threadId}` : ""}][sendQuestionMessage] Load question by id: ${questionId} (${questionData.link})`,
    );
  } else {
    console.log(
      `[${chatId}${threadId ? `_${threadId}` : ""}][sendQuestionMessage] ${complexity} question: ${questionData.link}`,
    );
  }

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

      const separate = await bot.sendMessage(chatId, MESSAGES.ANSWER_TITLE, {
        ...threadOpts,
        reply_to_message_id: questionMessage.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              { text: MESSAGES.BUTTON_ANSWER, callback_data: JSON.stringify({ answerKey }) },
              { text: MESSAGES.BUTTON_HINT, callback_data: JSON.stringify({ hintKey }) },
            ],
          ],
        },
      });

      await recordQuestionSent({
        chatId,
        threadId,
        telegramMessageId: separate.message_id,
        questionId: questionData.id,
        complexity,
        answerPayload: createAnswerPayload(answer, questionData, questionMessage.message_id),
        hintPayload: createHintPayload(questionData, questionMessage.message_id),
        title,
      });
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
          { text: MESSAGES.BUTTON_ANSWER, callback_data: JSON.stringify({ answerKey }) },
          { text: MESSAGES.BUTTON_HINT, callback_data: JSON.stringify({ hintKey }) },
        ],
      ],
    },
  });

  await recordQuestionSent({
    chatId,
    threadId,
    telegramMessageId: questionMessage.message_id,
    questionId: questionData.id,
    complexity,
    answerPayload: createAnswerPayload(answer, questionData),
    hintPayload: createHintPayload(questionData, questionMessage.message_id),
    title,
  });
  return { answerKey, questionMessageId: questionMessage.message_id };
}

function createAnswerPayload(
  answer: string,
  questionData: Question,
  questionMessageId?: number,
): AnswerPayload {
  return {
    answer,
    answerPreview: questionData.answerPreview ?? [],
    packId: questionData.packId ?? null,
    ...(questionMessageId ? { questionMessageId } : {}),
  };
}

function createHintPayload(questionData: Question, questionMessageId: number): HintPayload {
  return {
    question: questionData.question ?? "",
    answer: questionData.answer ?? "",
    description: questionData.description,
    questionMessageId,
    questionPreview: questionData.questionPreview,
  };
}

export default sendQuestionMessage;
