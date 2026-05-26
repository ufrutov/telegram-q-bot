/**
 * Bot and Redis Client Initialization
 * Provides singleton instances with proper typing
 */

import TelegramBot from 'node-telegram-bot-api';
import { createClient, RedisClientType } from 'redis';

const token = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Validates Telegram bot token format
 */
export function isValidTokenFormat(botToken: string | undefined): botToken is string {
	if (!botToken || typeof botToken !== 'string') {
		return false;
	}
	// Telegram bot token format: digits:alphanumeric string
	const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
	return tokenPattern.test(botToken);
}

// Initialize bot instance
let bot: TelegramBot | null = null;
if (token && isValidTokenFormat(token)) {
	bot = new TelegramBot(token);
}

// Initialize Redis client
let redisClient: RedisClientType | null = null;
if (process.env.REDIS_URL) {
	redisClient = createClient({ url: process.env.REDIS_URL });
	redisClient.on('error', (err: Error) => console.error('Redis Client Error', err));
}

export function getBotClient(): TelegramBot | null {
	return bot;
}

export function getRedisClient(): RedisClientType | null {
	return redisClient;
}
