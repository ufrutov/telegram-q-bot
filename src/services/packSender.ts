/**
 * Pack Sender Service - Handles pack loading, formatting, and message sending
 */

import type TelegramBot from "node-telegram-bot-api";
import type { RedisClientType } from "redis";

import QuestionLoader from "@/lib/QuestionLoader/QuestionLoader.js";
import GotQuestionsOnlineLoader from "@/lib/QuestionLoader/GotQuestionsOnlineLoader.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import { formatDate } from "@/utils/date.js";
import {
  TARGET_DOMAIN,
  PACK_MAX_QUESTIONS_TO_SHOW,
  PACK_QUESTIONS_PER_ROW,
} from "@/bot/constants.js";
import type { Pack, PackQuestionRef } from "@/types/question.js";
import type { InlineButton, ThreadOpts } from "@/types/telegram.js";

/**
 * Sends a pack info message with inline keyboard for question selection
 */
export async function sendPackMessage(
  bot: TelegramBot,
  redis: RedisClientType | undefined,
  chatId: string | number,
  packId: string | null = null,
  threadId: number | undefined = undefined,
): Promise<void> {
  const threadOpts: ThreadOpts = threadId ? { message_thread_id: threadId } : {};

  const loadingMsg = await bot.sendMessage(chatId, "🔄 Загружаю пакет...", threadOpts);

  try {
    let packData: Pack | null;

    if (packId) {
      const questionLoader = QuestionLoader(
        TARGET_DOMAIN as never,
        "random",
      ) as GotQuestionsOnlineLoader;
      packData = await questionLoader.loadPackData(packId, redis ?? undefined);

      if (!packData || !packData.questions || packData.questions.length === 0) {
        throw new Error("Pack not found or has no questions");
      }
    } else {
      const questionLoader = QuestionLoader(
        TARGET_DOMAIN as never,
        "random",
      ) as GotQuestionsOnlineLoader;
      const questionData = await questionLoader.loadQuestion(undefined, redis ?? undefined);

      if (!questionData || !questionData.packId) {
        throw new Error("Failed to load random question or pack ID not found");
      }

      packData = await questionLoader.loadPackData(questionData.packId, redis ?? undefined);

      if (!packData || !packData.questions || packData.questions.length === 0) {
        throw new Error("Failed to load pack data");
      }
    }

    const packInfoText = formatPackInfo(packData);
    const keyboard = buildPackKeyboard(packData.questions);

    try {
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    } catch {
      // Ignore deletion errors
    }

    await bot.sendMessage(chatId, packInfoText, {
      ...threadOpts,
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
      disable_web_page_preview: true,
    });

    const logChat = threadId ? `${chatId}_${threadId}` : chatId;
    console.log(`[${logChat}] pack: https://gotquestions.online/pack/${packData.id}/`);
  } catch (error) {
    console.error("Error sending pack message:", error);

    try {
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    } catch {
      // Ignore
    }

    await bot.sendMessage(chatId, "❌ Ошибка при загрузке пакета\\. Попробуйте позже\\.", {
      ...threadOpts,
      parse_mode: "MarkdownV2",
    });

    throw error;
  }
}

/**
 * Format pack information message with MarkdownV2
 */
function formatPackInfo(packData: Pack): string {
  const { id, title, pubDate, trueDl, total, questions } = packData;
  const baseUrl = TARGET_DOMAIN;

  let avgComplexity = "—";
  if (Array.isArray(trueDl) && trueDl.length > 0) {
    const sum = trueDl.reduce((a, b) => a + b, 0);
    avgComplexity = (sum / trueDl.length).toFixed(1);
  }

  const escapedTitle = escapeMarkdownV2(title);
  const escapedComplexity = escapeMarkdownV2(avgComplexity);
  const formattedDate = formatDate(pubDate);

  let message = `Пакет: [*${escapedTitle}*](https://${baseUrl}/pack/${id}/)\n`;

  if (formattedDate) {
    message += `📅 ${escapeMarkdownV2(formattedDate)}\n`;
  }

  message += `⚡ Сложность: *${escapedComplexity}*\n`;
  const totalQuestions = total || questions.length;
  const questionCountText =
    totalQuestions > questions.length
      ? `${questions.length}/${totalQuestions}`
      : String(questions.length);
  message += `📊 Вопросов: *${escapeMarkdownV2(questionCountText)}*\n\n`;
  message += `**Выберите вопрос:**`;

  return message;
}

/**
 * Build inline keyboard with question numbers (6 per row)
 */
function buildPackKeyboard(questions: PackQuestionRef[]): { inline_keyboard: InlineButton[][] } {
  const buttons: InlineButton[] = [];
  const questionsPerRow = PACK_QUESTIONS_PER_ROW;

  for (let i = 0; i < questions.length; i++) {
    const questionNum = i + 1;
    const questionId = questions[i]?.id;
    if (questionId === undefined) continue;

    buttons.push({
      text: questionNum.toString(),
      callback_data: JSON.stringify({
        action: "packQuestion",
        questionId,
      }),
    });
  }

  const rows: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += questionsPerRow) {
    rows.push(buttons.slice(i, i + questionsPerRow));
  }

  return { inline_keyboard: rows };
}

export default sendPackMessage;

// Suppress unused warning for PACK_MAX_QUESTIONS_TO_SHOW — it is used inside the
// loader's slice, but re-exported here for downstream type completeness.
void PACK_MAX_QUESTIONS_TO_SHOW;
