/**
 * Question Sender Service
 * Shared logic for sending questions to Telegram chats
 * Used by both webhook and cron endpoints
 */

const QuestionLoader = require("../lib/QuestionLoader/QuestionLoader");

/** Default target questions service */
const target = "gotquestions.online";

/**
 * Sends a question message to a Telegram chat with answer/hint inline buttons.
 *
 * Delivery strategy:
 *   - If the question has preview images → sends as a media group, then a
 *     separate "Ответ на вопрос" message with inline buttons (reply to media).
 *   - If no images → single text message with inline buttons attached.
 *
 * Redis persistence:
 *   - Stores the answer (with optional answerPreview images) under `answer:{chatId}:{id}`
 *   - Stores hint context (question, answer, description, previews) under `hint:{chatId}:{id}`
 *   - Both keys expire after 24 hours (3600 × 24 sec).
 *
 * Forum topics:
 *   - When `threadId` is provided and the chat is a forum supergroup, all outgoing
 *     messages include `message_thread_id` so they appear inside the correct topic.
 *   - Non-forum chats ignore this field — `threadOpts` resolves to `{}`.
 *
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {import('redis').RedisClientType | undefined} redisClient - Redis client for answer/hint storage
 * @param {string|number} chatId - Target chat ID
 * @param {'random'|'easy'|'medium'|'hard'} complexity - Question difficulty level
 * @param {string} [questionId] - Specific question ID to load (random if omitted)
 * @param {number} [threadId] - Telegram forum topic thread ID (undefined for non-forum chats)
 * @returns {Promise<{answerKey: string, questionMessageId: number}>} Redis key for answer retrieval and the message ID of the question message (used for reply context)
 */
async function sendQuestionMessage(bot, redisClient, chatId, complexity = "random", questionId = undefined, threadId = undefined) {
	const threadOpts = threadId ? { message_thread_id: threadId } : {};

	// Send loading message
	const loadingMsg = await bot.sendMessage(chatId, "🔄 Загружаю вопрос...", threadOpts);

	// Load question from the question service
	const questionLoader = QuestionLoader(target, complexity);
	const questionData = await questionLoader.loadQuestion(questionId);
	
	// Format question and answer for Telegram (MarkdownV2)
	const { question, answer } = questionLoader.formatForTelegram(questionData, true, complexity);

	console.log(`[${chatId}${threadId ? `_${threadId}` : ''}] ${complexity} question: ${questionData.link}`);

	// Delete loading message
	try {
		await bot.deleteMessage(chatId, loadingMsg.message_id);
	} catch (dErr) {
		// ignore if already deleted
	}

	// Generate Redis keys for answer and hint storage
	const answerKey = `answer:${chatId}:${questionData.id}`;
	const hintKey = `hint:${chatId}:${questionData.id}`;

	// If question has preview images, send as media group
	if (questionData.questionPreview && questionData.questionPreview.length > 0) {
		const media = questionData.questionPreview.map((url, index) => ({
			type: "photo",
			media: url,
			// Add caption with question text to the first image
			...(index === 0 && {
				caption: question,
				parse_mode: "MarkdownV2",
			}),
		}));

		try {
			// Send images as media group
			const messages = await bot.sendMediaGroup(chatId, media, threadOpts);
			const questionMessage = messages[0];

			// Send inline buttons as separate message
			const separate = await bot.sendMessage(chatId, "Ответ на вопрос", {
				...threadOpts,
				reply_to_message_id: questionMessage.message_id,
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

			// Store answer and hint data in Redis (24h TTL)
			if (redisClient) {
				const answerPreview = questionData.answerPreview || [];
				await redisClient.setEx(answerKey, 3600 * 24, JSON.stringify({ 
					answer, 
					answerPreview,
					packId: questionData.packId || null 
				}));
				await redisClient.setEx(
					hintKey,
					3600 * 24,
					JSON.stringify({
						question: questionData.question,
						answer: questionData.answer,
						description: questionData.description,
						questionMessageId: questionMessage.message_id,
						questionPreview: questionData.questionPreview || [],
					}),
				);
			}

			return { answerKey, questionMessageId: separate.message_id };
		} catch (imgError) {
			console.error("Error sending question media group:", imgError);
			// Fall through to send without images
		}
	}

	// Send question as regular text message with inline buttons
	const questionMessage = await bot.sendMessage(chatId, question, {
		...threadOpts,
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

	// Store answer and hint data in Redis (24h TTL)
	if (redisClient) {
		const answerPreview = questionData.answerPreview || [];
		await redisClient.setEx(answerKey, 3600 * 24, JSON.stringify({ 
			answer, 
			answerPreview,
			packId: questionData.packId || null 
		}));
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

module.exports = { sendQuestionMessage };