/**
 * Daily Question Cron Job
 * Sends a random question to configured Telegram chats on a schedule
 * Configured in vercel.json to run daily at 12:00 GMT+3
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import TelegramBot from 'node-telegram-bot-api';
import { createClient, RedisClientType } from 'redis';
import { sendQuestionMessage } from '@services/questionSender';
import { isValidTokenFormat } from '@bot/botClient';
import { ensureRedisConnected } from '@utils/redis';

/** Bot token from environment variables */
const token = process.env.TELEGRAM_BOT_TOKEN;

/** Optional secret for manual testing (set via CRON_SECRET env var) */
const cronSecret = process.env.CRON_SECRET;

/** Comma-separated list of chat IDs to send questions to */
const targetChats = process.env.CRON_TARGET_CHATS || '';

// Initialize Redis client
let redisClient: RedisClientType | null = null;
if (process.env.REDIS_URL) {
	redisClient = createClient({
		url: process.env.REDIS_URL,
	});
	redisClient.on('error', (err: Error) => console.error('Redis Client Error', err));
}

// Create bot instance
let bot: TelegramBot | null = null;
if (token && isValidTokenFormat(token)) {
	bot = new TelegramBot(token);
}

interface ChatEntry {
	chatId: string;
	threadId?: number;
}

/**
 * Cron job handler - sends questions to all configured chats
 */
export default async function handler(
	req: VercelRequest,
	res: VercelResponse,
): Promise<VercelResponse> {
	// Accept POST (from Vercel cron) and GET (for health checks)
	if (req.method !== 'POST' && req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	// Check bot configuration
	if (!token || !bot) {
		console.error('TELEGRAM_BOT_TOKEN is not configured');
		return res.status(500).json({ error: 'Bot not configured' });
	}

	// Verify request is from Vercel cron or has valid secret
	// Improve security: require either Vercel header OR secret (both are acceptable)
	const isVercelCron = req.headers['x-vercel-cron'] === 'true';
	const hasValidSecret = cronSecret && req.headers['x-cron-secret'] === cronSecret;

	if (!isVercelCron && !hasValidSecret) {
		console.warn('Unauthorized cron attempt');
		return res.status(403).json({ error: 'Unauthorized' });
	}

	try {
		// Connect Redis if configured
		if (redisClient) {
			await ensureRedisConnected(redisClient);
		}

		/**
		 * Parse CRON_TARGET_CHATS into an array of { chatId, threadId } entries.
		 * Each entry can be:
		 *   - `123456`           → plain chat ID (General topic)
		 *   - `123456_42`        → chat ID with forum topic thread ID
		 *   - `-100123456789`    → negative chat ID (supergroup) with optional thread
		 * Invalid entries are logged as warnings and filtered out.
		 */
		const entries = targetChats
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const chatEntries: ChatEntry[] = entries
			.map((entry): ChatEntry | null => {
				const m = entry.match(/^(-?\d+)(?:_(\d+))?$/);
				if (!m) {
					console.warn(`Invalid chat entry format: ${entry}`);
					return null;
				}
				return { chatId: m[1], threadId: m[2] ? Number(m[2]) : undefined };
			})
			.filter((entry): entry is ChatEntry => entry !== null);

		if (chatEntries.length === 0) {
			return res.status(400).json({ error: 'No target chats configured' });
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
				await sendQuestionMessage(bot, redisClient, chatId, 'random', undefined, threadId);
				successCount++;
			} catch (err) {
				const logChat = threadId ? `${chatId}_${threadId}` : chatId;
				const errorMessage = err instanceof Error ? err.message : 'Unknown error';
				console.error(`Failed to send to ${logChat}:`, errorMessage);
				failCount++;
			}
		}

		console.log(`Cron completed: ${successCount} sent, ${failCount} failed`);

		return res.status(200).json({ ok: true, success: successCount, failed: failCount });
	} catch (error) {
		console.error('Error processing cron:', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}
