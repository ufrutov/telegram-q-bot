/**
 * Bot and Redis Client Initialization
 * Provides singleton instances
 */
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('redis');

const token = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Validates Telegram bot token format
 * @param {string} botToken - Token to validate
 * @returns {boolean} - True if valid format
 */
function isValidTokenFormat(botToken) {
	if (!botToken || typeof botToken !== 'string') {
		return false;
	}
	// Telegram bot token format: digits:alphanumeric string
	const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
	return tokenPattern.test(botToken);
}

// Initialize bot instance
let bot = null;
if (token && isValidTokenFormat(token)) {
	bot = new TelegramBot(token);
}

// Initialize Redis client
let redisClient = null;
if (process.env.REDIS_URL) {
	redisClient = createClient({ url: process.env.REDIS_URL });
	redisClient.on('error', (err) => console.error('Redis Client Error', err));
}

module.exports = {
	getBotClient: () => bot,
	getRedisClient: () => redisClient,
};
