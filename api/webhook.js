/**
 * Telegram Bot Webhook Handler
 * Processes incoming updates from Telegram (messages and callback queries)
 */

const TelegramBot = require("node-telegram-bot-api");
const { generateHint, formatErrorMessage } = require("../src/services/openrouter");
const { escapeMarkdownV2 } = require("../src/utils/markdown");
const { createClient } = require("redis");
const { sendQuestionMessage } = require("../src/services/questionSender");

/** Bot token from environment variables */
const token = process.env.TELEGRAM_BOT_TOKEN;

/** Target questions service domain */
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
 * Validates Telegram bot token format
 * @param {string} botToken - Token to validate
 * @returns {boolean} - True if valid format
 */
function isValidTokenFormat(botToken) {
	if (!botToken || typeof botToken !== "string") {
		return false;
	}
	// Telegram bot token format: digits:alphanumeric string
	const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
	return tokenPattern.test(botToken);
}

// Create bot instance
let bot;
if (token && isValidTokenFormat(token)) {
	bot = new TelegramBot(token);
}

/**
 * Main webhook handler - processes Telegram updates
 * @param {import('http').IncomingMessage} req - HTTP request
 * @param {import('http').ServerResponse} res - HTTP response
 */
module.exports = async (req, res) => {
	// Only accept POST requests
	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	// Check bot configuration
	if (!token || !bot) {
		console.error("TELEGRAM_BOT_TOKEN is not configured");
		return res.status(500).json({ error: "Bot not configured" });
	}

	try {
		// Connect Redis if configured
		if (redisClient && !redisClient.isOpen) {
			await redisClient.connect();
		}

		const update = req.body;

		// Validate request body
		if (!update || typeof update !== "object") {
			return res.status(400).json({ error: "Invalid request body" });
		}

		// Handle incoming messages
		if (update.message) {
			const chatId = update.message.chat?.id;
			const messageText = update.message.text;

			if (!chatId) {
				console.error("Invalid message structure: missing chat.id");
				return res.status(200).json({ ok: true });
			}

			if (messageText) {
				// Handle /question command with optional complexity
				if (messageText.startsWith("/question")) {
					const parts = messageText.split(/\s+/);
					const questionId = parts.length > 1 && /^\d+$/.test(parts[1]) ? parts[1] : null;

					const complexityMap = {
						"/question": "random",
						"/questioneasy": "easy",
						"/questionmedium": "medium",
						"/questionhard": "hard",
					};
					const complexity = complexityMap[parts[0]] || "random";
					await sendQuestionMessage(bot, redisClient, chatId, complexity, questionId);
				}

				// Handle /menu command - shows complexity selection keyboard
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

			// Parse callback data
			let parsed = null;
			try {
				parsed = JSON.parse(callbackQuery.data);
			} catch (e) {
				parsed = null;
			}

			// Backwards compatibility: if payload uses { action, q } form, reconstruct older keys
			if (parsed && parsed.action && parsed.q) {
				const qid = String(parsed.q);
				if (parsed.action === "answer") {
					parsed.answerKey = `answer:${callbackQuery.message.chat.id}:${qid}`;
					parsed.hintKey = `hint:${callbackQuery.message.chat.id}:${qid}`;
					parsed.packKey = `pack:${callbackQuery.message.chat.id}:${qid}`;
				}
				if (parsed.action === "hint") {
					parsed.hintKey = `hint:${callbackQuery.message.chat.id}:${qid}`;
					parsed.answerKey = `answer:${callbackQuery.message.chat.id}:${qid}`;
					parsed.packKey = `pack:${callbackQuery.message.chat.id}:${qid}`;
				}
				if (parsed.action === "pack") {
					parsed.packKey = `pack:${callbackQuery.message.chat.id}:${qid}`;
				}
			}

			if (!chatId) {
				return res.status(200).json({ ok: true });
			}

			// Handle menu selection - send question with selected complexity
			if (parsed && parsed.action === "question") {
				const complexity = parsed.complexity || "random";
				try {
					await bot.answerCallbackQuery(callbackQuery.id);
					await sendQuestionMessage(bot, redisClient, chatId, complexity);
					// Delete the menu message after selection
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

			// Handle "Show Answer" button click
			if (parsed && parsed.answerKey) {
				// acknowledge callback so UI doesn't spin
				try {
					await bot.answerCallbackQuery(callbackQuery.id);
				} catch (ansErr) {
					// ignore
				}

				const answerKey = parsed.answerKey;

				if (!answerKey) {
					return res.status(200).json({ ok: true });
				}

				try {
					// Get answer data from Redis
					const answerDataStr = redisClient ? await redisClient.get(answerKey) : null;

					const questionId = answerKey.split(":").at(2);
					console.log(`[${chatId}] answer: https://${target}/question/${questionId}`);

					// If answer expired, show link to question
					if (!answerDataStr) {
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

					// Determine which message to reply to
					const messageToReply = questionMessageId ?? callbackQuery.message.message_id;

					// Send answer with images or text
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

					// Remove inline buttons from question message
					try {
						await bot.editMessageReplyMarkup(
							{ inline_keyboard: [] },
							{ chat_id: chatId, message_id: callbackQuery.message.message_id },
						);
					} catch (editError) {
						console.error("Error removing reply markup:", editError);
					}

					// Delete separate button message if question had images
					if (questionMessageId) {
						try {
							await bot.deleteMessage(chatId, callbackQuery.message.message_id);
						} catch (deleteError) {
							console.error(
								"Error deleting separated message after question with media group:",
								deleteError,
							);
						}
					}

					// Delete answer data from Redis (one-time use)
					if (redisClient) {
						await redisClient.del(answerKey);
					}

					// If this question belonged to a pack, offer other pack questions
					if (parsed.packKey && redisClient) {
						try {
							const packStr = await redisClient.get(parsed.packKey);
							if (packStr) {
								const packArr = JSON.parse(packStr);
								if (Array.isArray(packArr) && packArr.length > 0) {
									// Send a small message with a button to get another question from the pack
									await bot.sendMessage(chatId, `Другой вопрос из пакета (${packArr.length})`, {
										reply_to_message_id: messageToReply,
										reply_markup: {
											inline_keyboard: [
												[
													{
														text: `Другой вопрос из пакета (${packArr.length})`,
														callback_data: JSON.stringify({
															action: "pack",
															q: String(questionId),
														}),
													},
												],
											],
										},
									});
								}
							}
						} catch (packErr) {
							console.error("Error offering pack button:", packErr);
						}
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

			// Handle "Pack: another question" button click
			if (parsed && parsed.packKey && !parsed.answerKey && !parsed.hintKey) {
				const pKey = parsed.packKey;
				if (!pKey) {
					return res.status(200).json({ ok: true });
				}

				try {
					await bot.answerCallbackQuery(callbackQuery.id);

					const arrStr = redisClient ? await redisClient.get(pKey) : null;
					if (!arrStr) {
						await bot.answerCallbackQuery(callbackQuery.id, {
							text: "📚 Пакет пуст",
							show_alert: false,
						});
						return res.status(200).json({ ok: true });
					}

					let arr = JSON.parse(arrStr || "[]");
					if (!Array.isArray(arr) || arr.length === 0) {
						if (redisClient) await redisClient.del(pKey);
						await bot.answerCallbackQuery(callbackQuery.id, {
							text: "📚 Пакет пуст",
							show_alert: false,
						});
						return res.status(200).json({ ok: true });
					}

					// Pick random question id from pack
					const idx = Math.floor(Math.random() * arr.length);
					const pickedId = arr.splice(idx, 1)[0];

					// Persist updated pack array or delete if empty
					if (redisClient) {
						if (arr.length === 0) {
							await redisClient.del(pKey);
						} else {
							await redisClient.setEx(pKey, 3600 * 24, JSON.stringify(arr));
						}
					}

					// Optionally remove or update the original pack-button message
					try {
						if (arr.length === 0) {
							await bot.editMessageReplyMarkup(
								{ inline_keyboard: [] },
								{ chat_id: chatId, message_id: callbackQuery.message.message_id },
							);
						} else {
							await bot.editMessageReplyMarkup(
								{
									inline_keyboard: [
										[
											{
												text: `📚 Другой вопрос из пакета (${arr.length})`,
												callback_data: JSON.stringify({ packKey: pKey }),
											},
										],
									],
								},
								{ chat_id: chatId, message_id: callbackQuery.message.message_id },
							);
						}
					} catch (editErr) {
						// ignore
					}

					// Send the selected question
					await sendQuestionMessage(bot, redisClient, chatId, "random", String(pickedId));

					return res.status(200).json({ ok: true });
				} catch (err) {
					console.error("Error handling pack callback:", err);
					await bot.answerCallbackQuery(callbackQuery.id, {
						text: "❌ Ошибка при обработке пакета",
						show_alert: true,
					});
					return res.status(200).json({ ok: true });
				}
			}

			// Handle "Show Hint" button click
			if (parsed && parsed.hintKey) {
				const hintKey = parsed.hintKey;

				if (!hintKey) {
					return res.status(200).json({ ok: true });
				}

				try {
					await bot.answerCallbackQuery(callbackQuery.id);

					// Get hint data from Redis
					const hintDataStr = redisClient ? await redisClient.get(hintKey) : null;

					if (!hintDataStr) {
						await bot.sendMessage(chatId, "⏰ Время подсказки истекло.");
						return res.status(200).json({ ok: true });
					}

					const hintData = JSON.parse(hintDataStr);
					const {
						question,
						answer,
						description,
						questionMessageId,
						questionPreview = [],
					} = hintData;

					// Remove hint button from keyboard (keep answer button)
					try {
						const answerKeyMatch = callbackQuery.message.reply_markup?.inline_keyboard?.[0]?.find(
							(btn) => btn.text === "📖 Показать ответ",
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

					// Generate hint using AI
					let hint;
					try {
						const loadingMsg = await bot.sendMessage(chatId, "✨ Загружаю подсказку...");
						hint = await generateHint(question, answer, description, questionPreview);
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
					await bot.sendMessage(chatId, `💡 *Подсказка:*\n${escapeMarkdownV2(hint)}`, {
						parse_mode: "MarkdownV2",
						reply_to_message_id: messageToReply,
						disable_web_page_preview: true,
					});

					// Delete hint data from Redis
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

		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error("Error processing webhook:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
};
