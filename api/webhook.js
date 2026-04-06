const TelegramBot = require("node-telegram-bot-api");
const QuestionLoader = require("../src/lib/QuestionLoader/QuestionLoader");
const { generateHint, formatErrorMessage } = require("../src/services/openrouter");
const { escapeMarkdownV2 } = require("../src/utils/markdown");
const { createClient } = require("redis");

// Get the bot token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;

// Default target questions service
const target = "gotquestions.online";

// Initialize Redis client
let redisClient;
if (process.env.REDIS_URL) {
	redisClient = createClient({
		url: process.env.REDIS_URL,
	});
	redisClient.on("error", (err) => console.error("Redis Client Error", err));
}

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

// Helper to send a question message (media group or regular message) and return keys/message ids
async function sendQuestionMessage(chatId, complexity, questionId = undefined) {
	try {
		const loadingMsg = await bot.sendMessage(chatId, "🔄 Загружаю вопрос...");

		const questionLoader = QuestionLoader(target, complexity);

		const questionData = await questionLoader.loadQuestion(questionId);
		const { question, answer } = questionLoader.formatForTelegram(questionData, true, false);

		console.log(`[${chatId}] ${complexity} question: ${questionData.link}`);

		// Delete the loading message
		try {
			await bot.deleteMessage(chatId, loadingMsg.message_id);
		} catch (dErr) {
			// ignore
		}

		// Prepare answer key for inline button
		const answerKey = `answer:${chatId}:${questionData.id}`;
		const hintKey = `hint:${chatId}:${questionData.id}`;

		// Send question with images as media group or regular message
		if (questionData.questionPreview && questionData.questionPreview.length > 0) {
			const media = questionData.questionPreview.map((url, index) => ({
				type: "photo",
				media: url,
				...(index === 0 && {
					caption: question,
					parse_mode: "MarkdownV2",
				}),
			}));

			try {
				const messages = await bot.sendMediaGroup(chatId, media);
				const questionMessage = messages[0];

				// Send inline button as separate message after media group
				const separate = await bot.sendMessage(chatId, "Ответ на вопрос", {
					reply_to_message_id: questionMessage.message_id,
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: "📖 Показать ответ",
									callback_data: JSON.stringify({
										answerKey,
									}),
								},
								{
									text: "✨ Подсказка",
									callback_data: JSON.stringify({
										hintKey,
									}),
								},
							],
						],
					},
				});

				// Store answer data in Redis (24h) if available
				if (redisClient) {
					const answerPreview = questionData.answerPreview || [];
					await redisClient.setEx(
						answerKey,
						3600 * 24,
						JSON.stringify({
							answer,
							answerPreview,
							questionMessageId: questionMessage.message_id,
						}),
					);
					// Store hint data
					await redisClient.setEx(
						hintKey,
						3600 * 24,
						JSON.stringify({
							question: questionData.question,
							answer: questionData.answer,
							description: questionData.description,
							questionMessageId: questionMessage.message_id,
						}),
					);
				}

				return { answerKey, questionMessageId: separate.message_id };
			} catch (imgError) {
				console.error("Error sending question media group:", imgError);
				// Fallback: send message without images
				const questionMessage = await bot.sendMessage(chatId, question, {
					parse_mode: "MarkdownV2",
					disable_web_page_preview: true,
					reply_markup: {
						inline_keyboard: [
							[
								{
									text: "📖 Показать ответ",
									callback_data: JSON.stringify({
										answerKey,
									}),
								},
								{
									text: "✨ Подсказка",
									callback_data: JSON.stringify({
										hintKey,
									}),
								},
							],
						],
					},
				});

				if (redisClient) {
					const answerPreview = questionData.answerPreview || [];
					await redisClient.setEx(answerKey, 3600 * 24, JSON.stringify({ answer, answerPreview }));
					await redisClient.setEx(
						hintKey,
						3600 * 24,
						JSON.stringify({
							question: questionData.question,
							answer: questionData.answer,
							description: questionData.description,
							questionMessageId: questionMessage.message_id,
						}),
					);
				}

				return { answerKey, questionMessageId: questionMessage.message_id };
			}
		} else {
			// No images, send regular message with inline button
			const questionMessage = await bot.sendMessage(chatId, question, {
				parse_mode: "MarkdownV2",
				disable_web_page_preview: true,
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: "📖 Показать ответ",
								callback_data: JSON.stringify({ answerKey }),
							},
							{
								text: "✨ Подсказка",
								callback_data: JSON.stringify({ hintKey }),
							},
						],
					],
				},
			});

			if (redisClient) {
				const answerPreview = questionData.answerPreview || [];
				await redisClient.setEx(answerKey, 3600 * 24, JSON.stringify({ answer, answerPreview }));
				await redisClient.setEx(
					hintKey,
					3600 * 24,
					JSON.stringify({
						question: questionData.question,
						answer: questionData.answer,
						description: questionData.description,
						questionMessageId: questionMessage.message_id,
					}),
				);
			}

			return { answerKey, questionMessageId: questionMessage.message_id };
		}
	} catch (error) {
		console.error("Error loading question:", error);
		try {
			await bot.sendMessage(
				chatId,
				"❌ Произошла ошибка при загрузке вопроса. Попробуйте еще раз.",
			);
		} catch (e) {
			// ignore
		}
		return null;
	}
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
		// Connect Redis client if not already connected
		if (redisClient && !redisClient.isOpen) {
			await redisClient.connect();
		}

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

			if (messageText) {
				// Handle /question command
				if (messageText.startsWith("/question")) {
					// Extract question ID if provided (e.g., /question 353991)
					const parts = messageText.split(/\s+/);
					const questionId = parts.length > 1 && /^\d+$/.test(parts[1]) ? parts[1] : null;

					const complexityMap = {
						"/question": "random",
						"/questioneasy": "easy",
						"/questionmedium": "medium",
						"/questionhard": "hard",
					};
					const complexity = complexityMap[parts[0]] || "random";
					await sendQuestionMessage(chatId, complexity, questionId);
				}

				// Handle /menu command
				if (messageText.startsWith("/menu")) {
					await bot.sendMessage(chatId, "❓ Выбор категории вопроса:", {
						parse_mode: "MarkdownV2",
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: "Лёгкий вопрос",
										callback_data: JSON.stringify({ action: "question", complexity: "easy" }),
									},
								],
								[
									{
										text: "Стандартный вопрос",
										callback_data: JSON.stringify({ action: "question", complexity: "medium" }),
									},
								],
								[
									{
										text: "Сложный вопрос",
										callback_data: JSON.stringify({ action: "question", complexity: "hard" }),
									},
								],
								[
									{
										text: "Случайный вопрос",
										callback_data: JSON.stringify({ action: "question", complexity: "random" }),
									},
								],
							],
						},
					});
				}
			}
		}

		// Handle callback queries (inline button clicks)
		if (update.callback_query) {
			const callbackQuery = update.callback_query;
			const chatId = callbackQuery.message?.chat?.id;

			// Expect callback_data as JSON with an `action` field
			const dataStr = callbackQuery.data;
			let parsed = null;
			try {
				parsed = JSON.parse(dataStr);
			} catch (e) {
				parsed = null;
			}

			if (!chatId) {
				return res.status(200).json({ ok: true });
			}

			if (parsed && parsed.action === "question") {
				// Menu -> request a question of given complexity
				const complexity = parsed.complexity || "random";
				try {
					await bot.answerCallbackQuery(callbackQuery.id);
					await sendQuestionMessage(chatId, complexity);
					// remove the menu message
					try {
						await bot.deleteMessage(chatId, callbackQuery.message.message_id);
					} catch (e2) {
						// ignore
					}
					return res.status(200).json({ ok: true });
				} catch (err) {
					console.error("Error handling question callback:", err);
					await bot.answerCallbackQuery(callbackQuery.id, {
						text: "❌ Ошибка при загрузке вопроса",
						show_alert: true,
					});
					return res.status(200).json({ ok: true });
				}
			}

			if (parsed && parsed.answerKey) {
				const answerKey = parsed.answerKey;

				if (!answerKey) {
					return res.status(200).json({ ok: true });
				}

				try {
					// Retrieve answer data from Redis
					const answerDataStr = redisClient ? await redisClient.get(answerKey) : null;

					const questionId = answerKey.split(":").at(2);
					console.log(`[${chatId}] answer: https://${target}/question/${questionId}`);

					if (!answerDataStr) {
						// Answer expired or not found
						await bot.sendMessage(
							chatId,
							"⏰ Время ответа истекло.\nУвидеть ответ можно по ссылке ниже ↗️",
							{
								parse_mode: "MarkdownV2",
								reply_markup: {
									inline_keyboard: [
										[
											{
												text: `❓ Вопрос ${questionId}`,
												url: `https://${target}/question/${questionId}`,
											},
										],
									],
								},
							},
						);

						return res.status(200).json({ ok: true });
					}

					const answerData = JSON.parse(answerDataStr);
					const { answer, answerPreview, questionMessageId = undefined } = answerData;

					// Reply to question message
					const messageToReply = questionMessageId ?? callbackQuery.message.message_id;

					// Send answer with images or as regular message
					if (answerPreview && answerPreview.length > 0) {
						const media = answerPreview.map((url, index) => ({
							type: "photo",
							media: url,
							...(index === 0 && {
								caption: answer,
								parse_mode: "MarkdownV2",
							}),
						}));

						try {
							await bot.sendMediaGroup(chatId, media, { reply_to_message_id: messageToReply });
						} catch (imgError) {
							console.error("Error sending answer media group:", imgError);
							await bot.sendMessage(chatId, answer, {
								parse_mode: "MarkdownV2",
								reply_to_message_id: messageToReply,
								disable_web_page_preview: true,
							});
						}
					} else {
						await bot.sendMessage(chatId, answer, {
							parse_mode: "MarkdownV2",
							reply_to_message_id: messageToReply,
							disable_web_page_preview: true,
						});
					}

					// Remove inline button from question message
					try {
						await bot.editMessageReplyMarkup(
							{ inline_keyboard: [] },
							{ chat_id: chatId, message_id: callbackQuery.message.message_id },
						);
					} catch (editError) {
						console.error("Error removing reply markup:", editError);
					}

					// Remove separated message after question with media group
					if (questionMessageId) {
						try {
							await bot.deleteMessage(chatId, callbackQuery.message.message_id);
						} catch (deleteError) {
							console.error(
								"Error deleteing separated message after question with media group:",
								deleteError,
							);
						}
					}

					// Delete the answer from Redis (one-time use)
					if (redisClient) {
						await redisClient.del(answerKey);
					}
					return res.status(200).json({ ok: true });
				} catch (error) {
					console.error("Error handling callback query (answer):", error);
					await bot.answerCallbackQuery(callbackQuery.id, {
						text: "❌ Ошибка при загрузке ответа",
						show_alert: true,
					});
					return res.status(200).json({ ok: true });
				}
			}

			if (parsed && parsed.hintKey) {
				const hintKey = parsed.hintKey;

				if (!hintKey) {
					return res.status(200).json({ ok: true });
				}

				try {
					await bot.answerCallbackQuery(callbackQuery.id);

					const hintDataStr = redisClient ? await redisClient.get(hintKey) : null;

					if (!hintDataStr) {
						await bot.sendMessage(chatId, "⏰ Время подсказки истекло.");
						return res.status(200).json({ ok: true });
					}

					const hintData = JSON.parse(hintDataStr);
					const { question, answer, description, questionMessageId } = hintData;

					// Remove hint button immediately
					try {
						const answerKeyMatch = callbackQuery.message.reply_markup?.inline_keyboard?.[0]?.find(
							(btn) => btn.text === "📖 Показать ответ"
						);
						const newKeyboard = answerKeyMatch
							? { inline_keyboard: [[answerKeyMatch]] }
							: { inline_keyboard: [] };

						await bot.editMessageReplyMarkup(newKeyboard, {
							chat_id: chatId,
							message_id: callbackQuery.message.message_id,
						});
					} catch (editError) {
						console.error("Error removing reply markup:", editError);
					}

					let hint;
					try {
						const loadingMsg = await bot.sendMessage(chatId, "✨ Загружаю подсказку...");
						hint = await generateHint(question, answer, description);
						try {
							await bot.deleteMessage(chatId, loadingMsg.message_id);
						} catch (dErr) {
							// ignore
						}
					} catch (genError) {
						console.error("Error generating hint:", genError.message);
						hint = formatErrorMessage(genError);
					}

					const messageToReply = questionMessageId ?? callbackQuery.message.message_id;
					await bot.sendMessage(
						chatId,
						`💡 *Подсказка:*\n${escapeMarkdownV2(hint)}`,
						{
							parse_mode: "MarkdownV2",
							reply_to_message_id: messageToReply,
							disable_web_page_preview: true,
						}
					);

					if (redisClient) {
						await redisClient.del(hintKey);
					}

					return res.status(200).json({ ok: true });
				} catch (error) {
					console.error("Error handling callback query (hint):", error);
					await bot.answerCallbackQuery(callbackQuery.id, {
						text: "❌ Ошибка при загрузке подсказки",
						show_alert: true,
					});
					return res.status(200).json({ ok: true });
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
