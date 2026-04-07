/**
 * Daily Question Cron Job
 * Sends a random question to configured Telegram chats on a schedule
 * Configured in vercel.json to run daily at 12:00 GMT+3
 */

const TelegramBot = require("node-telegram-bot-api");
const { createClient } = require("redis");
const { sendQuestionMessage } = require("../../src/services/questionSender");

/** Bot token from environment variables */
const token = process.env.TELEGRAM_BOT_TOKEN;

/** Optional secret for manual testing (set via CRON_SECRET env var) */
const cronSecret = process.env.CRON_SECRET;

/** Comma-separated list of chat IDs to send questions to */
const targetChats = process.env.CRON_TARGET_CHATS || "";

// Initialize Redis client
let redisClient;
if (process.env.REDIS_URL) {
	redisClient = createClient({
		url: process.env.REDIS_URL,
	});
	redisClient.on("error", (err) => console.error("Redis Client Error", err));
}

/**
 * Validates Telegram bot token format
 * @param {string} botToken - Token to validate
 * @returns {boolean} - True if valid format
 */
function isValidTokenFormat(botToken) {
	if (!botToken || typeof botToken !== "string") {
		return false;
	}
	const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
	return tokenPattern.test(botToken);
}

// Create bot instance
let bot;
if (token && isValidTokenFormat(token)) {
	bot = new TelegramBot(token);
}

/**
 * Cron job handler - sends questions to all configured chats
 * @param {import('http').IncomingMessage} req - HTTP request
 * @param {import('http').ServerResponse} res - HTTP response
 */
module.exports = async (req, res) => {
	// Accept POST (from Vercel cron) and GET (for health checks)
	if (req.method !== "POST" && req.method !== "GET") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	// Check bot configuration
	if (!token || !bot) {
		console.error("TELEGRAM_BOT_TOKEN is not configured");
		return res.status(500).json({ error: "Bot not configured" });
	}

	// Verify request is from Vercel cron or has valid secret
	if (req.headers["x-vercel-cron"] !== "true") {
		if (cronSecret && req.headers["x-cron-secret"] !== cronSecret) {
			return res.status(403).json({ error: "Unauthorized" });
		}
	}

	try {
		// Connect Redis if configured
		if (redisClient && !redisClient.isOpen) {
			await redisClient.connect();
		}

		// Parse chat IDs from environment variable
		// Accepts both positive (users) and negative (groups) IDs
		const chatIds = targetChats.split(",").map((id) => id.trim()).filter((id) => /^-?\d+$/.test(id));

		if (chatIds.length === 0) {
			return res.status(400).json({ error: "No target chats configured" });
		}

		console.log(`Starting cron job for ${chatIds.length} chats`);

		let successCount = 0;
		let failCount = 0;

		// Send question to each configured chat
		for (const chatId of chatIds) {
			try {
				await sendQuestionMessage(bot, redisClient, chatId, "random");
				successCount++;
			} catch (err) {
				console.error(`Failed to send to ${chatId}:`, err.message);
				failCount++;
			}
		}

		console.log(`Cron completed: ${successCount} sent, ${failCount} failed`);

		return res.status(200).json({ ok: true, success: successCount, failed: failCount });
	} catch (error) {
		console.error("Error processing cron:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
};