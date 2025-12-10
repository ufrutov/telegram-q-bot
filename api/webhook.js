const TelegramBot = require("node-telegram-bot-api");
const QuestionLoader = require("../lib/QuestionLoader/QuestionLoader");
const { kv } = require("@vercel/kv");

// Get the bot token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;

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
					const loadingMsg = await bot.sendMessage(chatId, "🔄 Загружаю вопрос...");

					// Initialize question loader (using questions.chgk.info by default)
					const target = {
						"/question": "questions.chgk.info",
						"/question2": "gotquestions.online",
					};
					const questionLoader = QuestionLoader(target[messageText]);

					const questionData = await questionLoader.loadQuestion();
					const { question, answer } = questionLoader.formatForTelegram(questionData, true);

					// Delete the loading message
					await bot.deleteMessage(chatId, loadingMsg.message_id);

					// Question message reference for answer reply
					let questionMessage;

					// Send question with images as media group or regular message
					if (questionData.questionPreview && questionData.questionPreview.length > 0) {
						// Send images as media group with caption
						const media = questionData.questionPreview.map((url, index) => ({
							type: "photo",
							media: url,
							// Only add caption to the first image
							...(index === 0 && {
								caption: question,
								parse_mode: "MarkdownV2",
							}),
						}));

						try {
							const messages = await bot.sendMediaGroup(chatId, media);
							questionMessage = messages[0]; // Use first message for reply reference
						} catch (imgError) {
							console.error("Error sending question media group:", imgError);
							// Fallback: send message without images
							questionMessage = await bot.sendMessage(chatId, question, {
								parse_mode: "MarkdownV2",
							});
						}
					} else {
						// No images, send regular message
						questionMessage = await bot.sendMessage(chatId, question, {
							parse_mode: "MarkdownV2",
						});
					}

					// Store answer data in Redis with 1 hour TTL
					const answerKey = `answer:${chatId}:${questionMessage.message_id}`;
					await kv.set(
						answerKey,
						JSON.stringify({
							answer,
							answerPreview: questionData.answerPreview || [],
						}),
						{ ex: 3600 } // Expires in 1 hour
					);

					// Send inline button to show answer
					await bot.sendMessage(chatId, "👇 Нажмите кнопку, чтобы увидеть ответ:", {
						reply_to_message_id: questionMessage.message_id,
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: "📖 Показать ответ",
										callback_data: answerKey,
									},
								],
							],
						},
					});
				} catch (error) {
					console.error("Error loading question:", error);
					await bot.sendMessage(
						chatId,
						"❌ Произошла ошибка при загрузке вопроса. Попробуйте еще раз."
					);
				}
			}
		}

		// Handle callback queries (inline button clicks)
		if (update.callback_query) {
			const callbackQuery = update.callback_query;
			const chatId = callbackQuery.message?.chat?.id;
			const answerKey = callbackQuery.data;

			if (!chatId || !answerKey) {
				return res.status(200).json({ ok: true });
			}

			try {
				// Retrieve answer data from Redis
				const answerDataStr = await kv.get(answerKey);

				if (!answerDataStr) {
					// Answer expired or not found
					await bot.answerCallbackQuery(callbackQuery.id, {
						text: "⏰ Ответ истёк. Запросите новый вопрос.",
						show_alert: true,
					});
					return res.status(200).json({ ok: true });
				}

				const answerData = JSON.parse(answerDataStr);
				const { answer, answerPreview } = answerData;

				// Send answer with images or as regular message
				if (answerPreview && answerPreview.length > 0) {
					// Send answer images as media group with caption
					const media = answerPreview.map((url, index) => ({
						type: "photo",
						media: url,
						// Only add caption to the first image
						...(index === 0 && {
							caption: answer,
							parse_mode: "MarkdownV2",
						}),
					}));

					try {
						await bot.sendMediaGroup(chatId, media, {
							reply_to_message_id: callbackQuery.message.message_id,
						});
					} catch (imgError) {
						console.error("Error sending answer media group:", imgError);
						// Fallback: send answer without images
						await bot.sendMessage(chatId, answer, {
							parse_mode: "MarkdownV2",
							reply_to_message_id: callbackQuery.message.message_id,
						});
					}
				} else {
					// No answer images, send regular message
					await bot.sendMessage(chatId, answer, {
						parse_mode: "MarkdownV2",
						reply_to_message_id: callbackQuery.message.message_id,
					});
				}

				// Answer the callback query to remove loading state
				await bot.answerCallbackQuery(callbackQuery.id, {
					text: "✅ Ответ отправлен",
				});

				// Delete the answer from Redis (one-time use)
				await kv.del(answerKey);
			} catch (error) {
				console.error("Error handling callback query:", error);
				await bot.answerCallbackQuery(callbackQuery.id, {
					text: "❌ Ошибка при загрузке ответа",
					show_alert: true,
				});
			}
		}

		// Respond with 200 OK to acknowledge receipt
		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error("Error processing webhook:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
};
