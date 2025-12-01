const TelegramBot = require("node-telegram-bot-api");
const QuestionLoader = require("../lib/QuestionLoader");

// Get the bot token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;

// Initialize question loader
const questionLoader = new QuestionLoader();

/**
 * Validates the Telegram bot token format
 * Telegram bot tokens follow the format: <bot_id>:<hash>
 * @param {string} botToken - The token to validate
 * @returns {boolean} - True if valid format, false otherwise
 */
function isValidTokenFormat(botToken) {
	if (!botToken || typeof botToken !== "string") {
		return false;
	}
	// Telegram bot token format: digits:alphanumeric string
	const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
	return tokenPattern.test(botToken);
}

// Create a bot instance (without polling since we're using webhooks)
let bot;
if (token && isValidTokenFormat(token)) {
	bot = new TelegramBot(token);
}

/**
 * Vercel Serverless Function for Telegram Bot Webhook
 *
 * This API route handles incoming webhook requests from Telegram.
 * Configure your Telegram bot webhook URL to point to:
 * https://your-vercel-domain.vercel.app/api/webhook
 *
 * @param {import('http').IncomingMessage} req - The HTTP request object
 * @param {import('http').ServerResponse} res - The HTTP response object
 */
module.exports = async (req, res) => {
	// Only accept POST requests from Telegram
	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	// Check if bot token is configured
	if (!token || !bot) {
		console.error("TELEGRAM_BOT_TOKEN is not configured");
		return res.status(500).json({ error: "Bot not configured" });
	}

	try {
		const update = req.body;

		// Validate request body structure
		if (!update || typeof update !== "object") {
			return res.status(400).json({ error: "Invalid request body" });
		}

		// Process the incoming update from Telegram
		// Only handle /question command
		if (update.message) {
			const chatId = update.message.chat?.id;
			const messageText = update.message.text;

			// Validate chat ID exists
			if (!chatId) {
				console.error("Invalid message structure: missing chat.id");
				return res.status(200).json({ ok: true });
			}

			// Handle /question command
			if (messageText && messageText.startsWith("/question")) {
				try {
					// Load a random question from chgk.info
					await bot.sendMessage(chatId, "🔄 Загружаю вопрос...");

					const questionData = await questionLoader.loadQuestion();
					const formattedMessage = questionLoader.formatForTelegram(questionData);

					// Send the question
					await bot.sendMessage(chatId, formattedMessage, {
						parse_mode: "MarkdownV2",
					});

					// Send images if available
					if (questionData.preview && questionData.preview.length > 0) {
						for (const imageUrl of questionData.preview) {
							try {
								await bot.sendPhoto(chatId, imageUrl);
							} catch (imgError) {
								console.error("Error sending image:", imgError);
							}
						}
					}
				} catch (error) {
					console.error("Error loading question:", error);
					await bot.sendMessage(
						chatId,
						"❌ Произошла ошибка при загрузке вопроса. Попробуйте еще раз."
					);
				}
			}
		}

		// Respond with 200 OK to acknowledge receipt
		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error("Error processing webhook:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
};
