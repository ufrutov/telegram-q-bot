/**
 * Hourly Ticker
 *
 * Replaces /api/cron/daily-question. Vercel Hobby cron fires this once an
 * hour; we look up enabled cron_jobs, filter by the chat's local hour, and
 * send a question for each match. Idempotency: a job whose last_sent_at falls
 * in the current local day of the chat is skipped.
 *
 * Schedule: 0 * * * * (every hour, on the hour, UTC).
 * Concurrency: cron jobs for different chats run sequentially inside one
 * invocation; Vercel guarantees no overlap for the same cron entry.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import TelegramBot from "node-telegram-bot-api";
import { createClient, type RedisClientType } from "redis";

import { sendQuestionMessage } from "@/services/questionSender.js";
import { listEnabledJobs, markJobSent } from "@/services/cronConfig.js";
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
    const result = await listEnabledJobs();
    if (!result.ok) {
      console.error("[ticker] listEnabledJobs failed:", result.error);
      res.status(500).json({ error: result.error });
      return;
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const job of result.value) {
      const chat = job.chats;
      if (!chat) continue;

      const hourInTz = getHourInTz(now, chat.timezone);
      const jobHour = Number(job.send_at.split(":")[0]);
      if (hourInTz !== jobHour) continue;

      if (job.last_sent_at && isSameLocalDay(new Date(job.last_sent_at), now, chat.timezone)) {
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
          job.complexity,
          undefined,
          threadId,
        );
        await markJobSent(job.id);
        sent++;
        console.log(`[ticker] sent job ${job.id} to ${logChat} (${job.complexity})`);
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ticker] failed job ${job.id} for ${logChat}:`, message);
      }
    }

    console.log(`[ticker] done: sent=${sent} skipped=${skipped} failed=${failed}`);
    res.status(200).json({ ok: true, sent, skipped, failed });
  } catch (error) {
    console.error("[ticker] error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
