/**
 * Bot and Redis Client Initialization
 * Provides singleton instances per serverless invocation
 */

import TelegramBot from "node-telegram-bot-api";
import { createClient, type RedisClientType } from "redis";

const token = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Validates Telegram bot token format
 * @param botToken - Token to validate
 * @returns True if valid format
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

let redisClient: RedisClientType | null = null;
if (process.env.REDIS_URL) {
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on("error", (err) => console.error("Redis Client Error", err));
}

export function getBotClient(): TelegramBot | null {
  return bot;
}

export function getRedisClient(): RedisClientType | null {
  return redisClient;
}
