import { createHash } from "node:crypto";
import type TelegramBot from "node-telegram-bot-api";
import type { RedisClientType } from "redis";
import { getRedisClient } from "@/bot/botClient.js";
import QuestionLoader from "@/lib/QuestionLoader/QuestionLoader.js";
import { sendLoadedQuestionMessage } from "./questionSender.js";
import type { Question, Complexity } from "@/types/question.js";
import type { DashboardChat, QuestionDelivery } from "@/types/dashboard.js";

const TTL = 3600;
const memory = new Map<string, { expires: number; result: QuestionDelivery }>();
let connecting: Promise<unknown> | null = null;

export async function dashboardRedis(): Promise<RedisClientType | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  if (connecting) await connecting;
  else if (!redis.isOpen) {
    connecting = redis.connect();
    try {
      await connecting;
    } finally {
      connecting = null;
    }
  }
  return redis;
}
export async function loadDashboardQuestion(
  questionId: string | undefined,
  complexity: Complexity,
  redis: RedisClientType | null,
): Promise<Question> {
  const question = await QuestionLoader("gotquestions.online", complexity).loadQuestion(
    questionId,
    redis ?? undefined,
  );
  if (!question.question || !/^\d{1,15}$/.test(String(question.id)))
    throw new Error("The source returned an invalid question");
  if (questionId && String(question.id) !== questionId)
    throw new Error("The source returned a different question ID");
  return question;
}

/** A per-recipient claim protects repeated requests. Redis shares claims between
 * Vercel instances; without Redis, the fallback covers the current warm process.
 */
async function claim(
  key: string,
  chatRowId: string,
  redis: RedisClientType | null,
): Promise<QuestionDelivery | null> {
  const pending: QuestionDelivery = { chatRowId, status: "pending" };
  if (redis) {
    const acquired = await redis.set(key, JSON.stringify(pending), { NX: true, EX: TTL });
    return acquired ? null : JSON.parse((await redis.get(key)) ?? JSON.stringify(pending));
  }
  for (const [item, value] of memory) if (value.expires < Date.now()) memory.delete(item);
  const previous = memory.get(key);
  if (previous) return previous.result;
  if (memory.size >= 2000) throw new Error("Delivery queue is busy. Try again later.");
  memory.set(key, { expires: Date.now() + TTL * 1000, result: pending });
  return null;
}
async function save(key: string, result: QuestionDelivery, redis: RedisClientType | null) {
  if (redis) await redis.set(key, JSON.stringify(result), { EX: TTL });
  else memory.set(key, { expires: Date.now() + TTL * 1000, result });
}

export interface DeliveryDependencies {
  load: () => Promise<Question>;
  send: (question: Question, chat: DashboardChat) => Promise<{ questionMessageId: number }>;
}
/** Side effects are explicit and injectable for local smoke checks without Telegram. */
async function deliverBatch<T>(
  userId: string,
  draftId: string,
  payloadKey: string[],
  chats: DashboardChat[],
  redis: RedisClientType | null,
  dependencies: {
    load: () => Promise<T>;
    send: (value: T, chat: DashboardChat) => Promise<{ messageId: number }>;
  },
): Promise<QuestionDelivery[]> {
  const keys = chats.map(
    (chat) =>
      `dashboard:${payloadKey[0]}:${createHash("sha256")
        .update(JSON.stringify([userId, draftId, ...payloadKey.slice(1), chat.id]))
        .digest("hex")}`,
  );
  const results: QuestionDelivery[] = [];
  let value: T | undefined;
  for (const [index, chat] of chats.entries()) {
    const key = keys[index];
    const previous = await claim(key, chat.id, redis);
    if (previous) {
      results.push(previous);
      continue;
    }
    try {
      value ??= await dependencies.load();
    } catch (error) {
      // No Telegram request has started, so a failed source load can be retried.
      if (redis) await redis.del(key);
      else memory.delete(key);
      throw error;
    }
    let result: QuestionDelivery;
    try {
      const sent = await dependencies.send(value, chat);
      result = { chatRowId: chat.id, status: "sent", messageId: sent.messageId };
    } catch (error) {
      const body = (
        error as { response?: { body?: { description?: string; error_code?: number } } }
      )?.response?.body;
      result = {
        chatRowId: chat.id,
        status: body?.error_code ? "failed" : "unknown",
        error:
          body?.description?.slice(0, 200) ??
          "Delivery could not be confirmed. Check Telegram before sending again.",
      };
      console.error(`[dashboard] delivery ${result.status} for chat row ${chat.id}`);
    }
    // Retain the pending claim if persisting a result fails; do not resend blindly.
    await save(key, result, redis);
    results.push(result);
  }
  return results;
}
export function deliverDashboardQuestion(
  userId: string,
  draftId: string,
  questionId: string,
  complexity: Complexity,
  chats: DashboardChat[],
  redis: RedisClientType | null,
  dependencies: DeliveryDependencies,
): Promise<QuestionDelivery[]> {
  return deliverBatch(userId, draftId, ["question", questionId, complexity], chats, redis, {
    load: dependencies.load,
    send: async (question, chat) => ({
      messageId: (await dependencies.send(question, chat)).questionMessageId,
    }),
  });
}

/** Plain announcements have no question buttons or question-history rows. */
export function deliverDashboardMessage(
  userId: string,
  draftId: string,
  text: string,
  chats: DashboardChat[],
  redis: RedisClientType | null,
  bot: Pick<TelegramBot, "sendMessage">,
): Promise<QuestionDelivery[]> {
  return deliverBatch(userId, draftId, ["message", text], chats, redis, {
    load: async () => text,
    send: async (message, chat) => {
      const sent = await bot.sendMessage(chat.chat_id, message, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        ...(chat.thread_id == null ? {} : { message_thread_id: chat.thread_id }),
      });
      return { messageId: sent.message_id };
    },
  });
}

export function dashboardDeliveryDependencies(
  bot: TelegramBot,
  questionId: string,
  complexity: Complexity,
  redis: RedisClientType | null,
): DeliveryDependencies {
  return {
    load: () => loadDashboardQuestion(questionId, complexity, redis),
    send: (question, chat) =>
      sendLoadedQuestionMessage(
        bot,
        question,
        chat.chat_id,
        complexity,
        chat.thread_id ?? undefined,
        chat.title ?? undefined,
      ),
  };
}
