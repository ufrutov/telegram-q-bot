/**
 * Bot and Redis Client Initialization
 * Provides singleton instances per serverless invocation
 */

// Opt in to node-telegram-bot-api's post-NTBA_FIX_350 content-type default
// (see https://github.com/yagop/node-telegram-bot-api/blob/master/doc/usage.md#sending-files)
// before the bot is constructed. Without this the lib emits a
// DeprecationWarning once per process every time we send a Buffer as media,
// even though we already pass an explicit contentType in fileOptions — the
// `deprecate(...)` call inside `_formatSendData` is unconditional when this
// flag is unset. Setting it to any truthy value (`"1"`) accepts the
// library's upcoming octet-stream default; we still pass our own
// contentType where it matters, so behavior is unchanged.
//
// Falls back to "1" by default — operators can override (e.g. set it to
// "0" in Vercel env) by exporting NTBA_FIX_350 before this module loads.
process.env.NTBA_FIX_350 ??= "1";

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
