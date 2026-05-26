/**
 * Telegram Bot Webhook Handler - Entry Point
 * Routes incoming updates to specialized handlers
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { getBotClient, getRedisClient } from '@bot/botClient';
import { ensureRedisConnected } from '@utils/redis';
import { handleMessage } from './handlers/messageHandler';
import { callbackHandler } from './handlers/callbackHandler';

export default async function handler(
	req: VercelRequest,
	res: VercelResponse,
): Promise<VercelResponse> {
	// Only accept POST requests
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	// Get bot instance
	const bot = getBotClient();
	if (!bot) {
		console.error('TELEGRAM_BOT_TOKEN is not configured');
		return res.status(500).json({ error: 'Bot not configured' });
	}

	try {
		// Connect Redis if configured
		const redis = getRedisClient();
		if (redis) {
			await ensureRedisConnected(redis);
		}

		const update = req.body as any;

		// Validate request body
		if (!update || typeof update !== 'object') {
			return res.status(400).json({ error: 'Invalid request body' });
		}

		// Route to appropriate handler
		if (update.message) {
			await handleMessage(bot, redis, update.message);
		} else if (update.callback_query) {
			await callbackHandler(bot, redis, update.callback_query);
		}

		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error('Error processing webhook:', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}
