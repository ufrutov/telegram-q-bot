/**
 * Daily Question Cron Job
 * Sends a random question to configured Telegram chats on a schedule
 * Configured in vercel.json to run daily at 12:00 GMT+3
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import TelegramBot from "node-telegram-bot-api";
import { createClient, type RedisClientType } from "redis";

import { sendQuestionMessage } from "@/services/questionSender.js";
import type { CronChatEntry } from "@/types/telegram.js";

/** Bot token from environment variables */
const token = process.env.TELEGRAM_BOT_TOKEN;

/** Optional secret for manual testing (set via CRON_SECRET env var) */
const cronSecret = process.env.CRON_SECRET;

/** Comma-separated list of chat IDs to send questions to */
const targetChats = process.env.CRON_TARGET_CHATS ?? "";

let redisClient: RedisClientType | null = null;
if (process.env.REDIS_URL) {
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on("error", (err: Error) => console.error("Redis Client Error", err));
}

/**
 * Validates Telegram bot token format
 */
function isValidTokenFormat(botToken: string | undefined): boolean {
  if (!botToken || typeof botToken !== "string") {
    return false;
  }
  const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
  return tokenPattern.test(botToken);
}

let bot: TelegramBot | null = null;
if (token && isValidTokenFormat(token)) {
  bot = new TelegramBot(token);
}

/**
 * Parse CRON_TARGET_CHATS into an array of { chatId, threadId } entries.
 *
 * Each entry can be:
 *   - `123456`           → plain chat ID (General topic)
 *   - `123456_42`        → chat ID with forum topic thread ID
 *   - `-100123456789`    → negative chat ID (supergroup) with optional thread
 *
 * Invalid entries are silently filtered out.
 */
function parseChats(raw: string): CronChatEntry[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(/^(-?\d+)(?:_(\d+))?$/);
      if (!m) return null;
      return {
        chatId: m[1] ?? "",
        threadId: m[2] ? Number(m[2]) : undefined,
      };
    })
    .filter((entry): entry is CronChatEntry => entry !== null);
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

  try {
    if (redisClient && !redisClient.isOpen) {
      await redisClient.connect();
    }

    const chatEntries = parseChats(targetChats);

    if (chatEntries.length === 0) {
      res.status(400).json({ error: "No target chats configured" });
      return;
    }

    console.log(`Starting cron job for ${chatEntries.length} chats`);

    let successCount = 0;
    let failCount = 0;

    for (const { chatId, threadId } of chatEntries) {
      try {
        await sendQuestionMessage(
          bot,
          redisClient ?? undefined,
          chatId,
          "random",
          undefined,
          threadId,
        );
        successCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const logChat = threadId ? `${chatId}_${threadId}` : chatId;
        console.error(`Failed to send to ${logChat}:`, message);
        failCount++;
      }
    }

    console.log(`Cron completed: ${successCount} sent, ${failCount} failed`);

    res.status(200).json({ ok: true, success: successCount, failed: failCount });
  } catch (error) {
    console.error("Error processing cron:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
