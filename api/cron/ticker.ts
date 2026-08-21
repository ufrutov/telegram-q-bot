/**
 * Daily Cron Ticker
 *
 * Vercel Hobby plan fires this twice per day (see vercel.json) — at
 * 09:00 UTC and 10:00 UTC — so we cover Moldova's DST shift (EEST in
 * summer, EET in winter). Each tick walks every chat whose
 * `cron_enabled` is true and sends a question when:
 *   - the chat's local hour matches `cron_time::hour`, AND
 *   - `cron_last_sent_at` is not today in the chat's timezone
 *     (idempotency).
 *
 * Chats in timezones that don't match either tick simply get one send
 * per day — only the matching tick fires the question.
 *
 * Concurrency: Vercel guarantees no overlap for the same cron entry, so
 * we run sequentially inside one invocation.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import TelegramBot from "node-telegram-bot-api";
import { createClient, type RedisClientType } from "redis";

import { sendQuestionMessage } from "@/services/questionSender.js";
import { listChatsWithCronEnabled, markChatCronSent } from "@/services/chatStore.js";
import { getSupabaseClient } from "@/services/supabase.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const cronSecret = process.env.CRON_SECRET;

function isValidTokenFormat(botToken: string | undefined): boolean {
  if (!botToken || typeof botToken !== "string") return false;
  return /^\d+:[A-Za-z0-9_-]+$/.test(botToken);
}

let bot: TelegramBot | null = null;
if (token && isValidTokenFormat(token)) {
  bot = new TelegramBot(token);
}

let redisClient: RedisClientType | null = null;
if (process.env.REDIS_URL) {
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on("error", (err: Error) => console.error("Redis Client Error", err));
}

function getHourInTz(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour");
  return hourPart ? Number(hourPart.value) : 0;
}

function isSameLocalDay(a: Date, b: Date, timezone: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(a) === fmt.format(b);
}

export default async (req: VercelRequest, res: VercelResponse): Promise<void> => {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!token || !bot) {
    console.error("TELEGRAM_BOT_TOKEN is not configured");
    res.status(500).json({ error: "Bot not configured" });
    return;
  }

  if (req.headers["x-vercel-cron"] !== "true") {
    if (cronSecret && req.headers["x-cron-secret"] !== cronSecret) {
      res.status(403).json({ error: "Unauthorized" });
      return;
    }
  }

  if (!getSupabaseClient()) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }

  try {
    if (redisClient && !redisClient.isOpen) {
      await redisClient.connect();
    }

    const now = new Date();
    const result = await listChatsWithCronEnabled();
    if (!result.ok) {
      console.error("[ticker] listChatsWithCronEnabled failed:", result.error);
      res.status(500).json({ error: result.error });
      return;
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const chat of result.value) {
      const hourInTz = getHourInTz(now, chat.timezone);
      const cronHour = Number(chat.cron_time.split(":")[0]);
      if (hourInTz !== cronHour) continue;

      if (
        chat.cron_last_sent_at &&
        isSameLocalDay(new Date(chat.cron_last_sent_at), now, chat.timezone)
      ) {
        skipped++;
        continue;
      }

      const threadId = chat.thread_id ?? undefined;
      const logChat = threadId ? `${chat.chat_id}_${threadId}` : chat.chat_id;
      try {
        await sendQuestionMessage(
          bot,
          redisClient ?? undefined,
          chat.chat_id,
          "random",
          undefined,
          threadId,
        );
        await markChatCronSent(chat.id);
        sent++;
        console.log(`[ticker] sent to ${logChat} at local ${hourInTz}:00`);
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ticker] failed for ${logChat}:`, message);
      }
    }

    console.log(`[ticker] done: sent=${sent} skipped=${skipped} failed=${failed}`);
    res.status(200).json({ ok: true, sent, skipped, failed });
  } catch (error) {
    console.error("[ticker] error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
