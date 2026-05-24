/**
 * Telegram Bot Webhook Handler - Entry Point
 * Routes incoming updates to specialized handlers
 */
const { getBotClient, getRedisClient } = require('../src/bot/botClient');
const messageHandler = require('./handlers/messageHandler');
const callbackHandler = require('./handlers/callbackHandler');

/**
 * Main webhook handler - processes Telegram updates
 * @param {import('http').IncomingMessage} req - HTTP request
 * @param {import('http').ServerResponse} res - HTTP response
 */
module.exports = async (req, res) => {
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
		if (redis && !redis.isOpen) {
			await redis.connect();
		}

		const update = req.body;

		// Validate request body
		if (!update || typeof update !== 'object') {
			return res.status(400).json({ error: 'Invalid request body' });
		}

		// Route to appropriate handler
		if (update.message) {
			await messageHandler(bot, redis, update.message);
		} else if (update.callback_query) {
			await callbackHandler(bot, redis, update.callback_query);
		}

		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error('Error processing webhook:', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
};
