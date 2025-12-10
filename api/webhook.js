const TelegramBot = require("node-telegram-bot-api");
const QuestionLoader = require("../lib/QuestionLoader");

// Get the bot token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;

// Initialize question loader
const questionLoader = new QuestionLoader();

// In-memory cache for storing answers (key: chatId_messageId, value: answer text)
const answerCache = new Map();

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

					const questionData = await questionLoader.loadQuestion();
					const { question, answer } = questionLoader.formatForTelegram(questionData, true);

					// Delete the loading message
					await bot.deleteMessage(chatId, loadingMsg.message_id);

					// Question message reference for answer reply
					let questionMessage;

					// Send images as media group or regular message
					if (questionData.preview && questionData.preview.length > 0) {
						// Send images as media group with caption
						const media = questionData.preview.map((url, index) => ({
							type: "photo",
							media: url,
							// Only add caption to the first image
							...(index === 0 && {
								caption: question,
								parse_mode: "MarkdownV2",
							}),
						}));

						try {
							questionMessage = await bot.sendMediaGroup(chatId, media);
							// Store answer for the first message in the group
							if (answer && questionMessage[0]) {
								const cacheKey = `${chatId}_${questionMessage[0].message_id}`;
								answerCache.set(cacheKey, answer);

								// Send a separate message with the button
								await bot.sendMessage(chatId, "👆 Нажмите кнопку, чтобы увидеть ответ:", {
									reply_to_message_id: questionMessage[0].message_id,
									reply_markup: {
										inline_keyboard: [
											[
												{
													text: "Показать ответ",
													callback_data: `answer_${questionMessage[0].message_id}`,
												},
											],
										],
									},
								});
							}
						} catch (imgError) {
							console.error("Error sending media group:", imgError);
							// Fallback: send message without images
							questionMessage = await bot.sendMessage(chatId, question, {
								parse_mode: "MarkdownV2",
								reply_markup: {
									inline_keyboard: [
										[{ text: "Показать ответ", callback_data: `answer_${Date.now()}` }],
									],
								},
							});

							if (answer) {
								const cacheKey = `${chatId}_${questionMessage.message_id}`;
								answerCache.set(cacheKey, answer);
							}
						}
					} else {
						// No images, send regular message
						questionMessage = await bot.sendMessage(chatId, question, {
							parse_mode: "MarkdownV2",
							reply_markup: {
								inline_keyboard: [
									[{ text: "Показать ответ", callback_data: `answer_${Date.now()}` }],
								],
							},
						});

						if (answer) {
							const cacheKey = `${chatId}_${questionMessage.message_id}`;
							answerCache.set(cacheKey, answer);
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

		// Handle callback queries (button clicks)
		if (update.callback_query) {
			const callbackQuery = update.callback_query;
			const chatId = callbackQuery.message.chat.id;
			const data = callbackQuery.data;

			if (data.startsWith("answer_")) {
				const messageId = data.replace("answer_", "");
				const cacheKey = `${chatId}_${messageId}`;
				const answer = answerCache.get(cacheKey);

				if (answer) {
					// Send the answer as a reply
					await bot.sendMessage(chatId, answer, {
						parse_mode: "MarkdownV2",
						reply_to_message_id: callbackQuery.message.message_id,
					});

					// Remove the button after showing answer
					await bot.editMessageReplyMarkup(
						{ inline_keyboard: [] },
						{ chat_id: chatId, message_id: callbackQuery.message.message_id }
					);

					// Clean up cache
					answerCache.delete(cacheKey);
				} else {
					// Answer not found in cache
					await bot.answerCallbackQuery(callbackQuery.id, {
						text: "Ответ не найден. Попробуйте загрузить вопрос снова.",
						show_alert: true,
					});
				}
			}

			// Acknowledge the callback
			await bot.answerCallbackQuery(callbackQuery.id);
		}

		// Respond with 200 OK to acknowledge receipt
		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error("Error processing webhook:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
};
