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

		/**
		 * Parse CRON_TARGET_CHATS into an array of { chatId, threadId } entries.
		 * Each entry can be:
		 *   - `123456`           → plain chat ID (General topic)
		 *   - `123456_42`        → chat ID with forum topic thread ID
		 *   - `-100123456789`    → negative chat ID (supergroup) with optional thread
		 * Invalid entries are silently filtered out.
		 * @type {Array<{chatId: string, threadId: string|undefined}>}
		 */
		const entries = targetChats.split(",").map((s) => s.trim()).filter(Boolean);
		const chatEntries = entries.map((entry) => {
			const m = entry.match(/^(-?\d+)(?:_(\d+))?$/);
			return m ? { chatId: m[1], threadId: m[2] || undefined } : null;
		}).filter(Boolean);

		if (chatEntries.length === 0) {
			return res.status(400).json({ error: "No target chats configured" });
		}

		console.log(`Starting cron job for ${chatEntries.length} chats`);

		let successCount = 0;
		let failCount = 0;

		/**
		 * Send a random question to every configured chat.
		 * Each chat receives the question independently — a failure for one
		 * does not affect the others. The counters are logged on completion.
		 */
		for (const { chatId, threadId } of chatEntries) {
			try {
				await sendQuestionMessage(bot, redisClient, chatId, "random", undefined, threadId);
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