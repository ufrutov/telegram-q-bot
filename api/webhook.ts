/**
 * Telegram Bot Webhook Handler - Entry Point
 * Routes incoming updates to specialized handlers
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import type TelegramBot from "node-telegram-bot-api";
import type { RedisClientType } from "redis";

import { getBotClient, getRedisClient } from "@/bot/botClient.js";
import messageHandler from "./handlers/messageHandler.js";
import callbackHandler from "./handlers/callbackHandler.js";

/**
 * Main webhook handler - processes Telegram updates
 */
export default async (req: VercelRequest, res: VercelResponse): Promise<void> => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const bot: TelegramBot | null = getBotClient();
  if (!bot) {
    console.error("TELEGRAM_BOT_TOKEN is not configured");
    res.status(500).json({ error: "Bot not configured" });
    return;
  }

  try {
    const redis: RedisClientType | null = getRedisClient();
    if (redis && !redis.isOpen) {
      await redis.connect();
    }

    const update = req.body as { message?: unknown; callback_query?: unknown } | undefined;

    if (!update || typeof update !== "object") {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    if (update.message) {
      await messageHandler(bot, redis, update.message as never);
    } else if (update.callback_query) {
      await callbackHandler(bot, redis, update.callback_query as never);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
