/**
 * Question Sender Service
 * Shared logic for sending questions to Telegram chats
 * Used by both webhook and cron endpoints
							{
								text: "📖 Показать ответ",
								callback_data: JSON.stringify({ action: "answer", q: String(questionData.id) }),
							},
							{
								text: "✨ Подсказка",
								callback_data: JSON.stringify({ action: "hint", q: String(questionData.id) }),
							},
 * Sends a question message to a Telegram chat
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {RedisClient} redisClient - Redis client for storing answer/hint data
 * @param {string|number} chatId - Target chat ID
 * @param {string} complexity - Question complexity (random, easy, medium, hard)
 * @param {string} [questionId] - Optional specific question ID
 * @returns {Promise<{answerKey: string, questionMessageId: number}>}
 */
async function sendQuestionMessage(
	bot,
	redisClient,
	chatId,
	complexity = "random",
	questionId = undefined,
) {
	// Send loading message
	const loadingMsg = await bot.sendMessage(chatId, "🔄 Загружаю вопрос...");

	// Load question from the question service
	const questionLoader = QuestionLoader(target, complexity);
	const questionData = await questionLoader.loadQuestion(questionId);

	// Format question and answer for Telegram (MarkdownV2)
	const { question, answer } = questionLoader.formatForTelegram(questionData, true, false);

	console.log(`[${chatId}] ${complexity} question: ${questionData.link}`);

	// Delete loading message
	try {
		await bot.deleteMessage(chatId, loadingMsg.message_id);
	} catch (dErr) {
		// ignore if already deleted
	}

	// Generate Redis keys for answer and hint storage
	const answerKey = `answer:${chatId}:${questionData.id}`;
	const hintKey = `hint:${chatId}:${questionData.id}`;
	const packKey = `pack:${chatId}:${questionData.id}`;

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
			const messages = await bot.sendMediaGroup(chatId, media);
			const questionMessage = messages[0];

			// Send inline buttons as separate message
			const separate = await bot.sendMessage(chatId, "Ответ на вопрос", {
				reply_to_message_id: questionMessage.message_id,
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: "📖 Показать ответ",
								callback_data: JSON.stringify({ action: "answer", q: String(questionData.id) }),
							},
							{
								text: "✨ Подсказка",
								callback_data: JSON.stringify({ action: "hint", q: String(questionData.id) }),
							},
						],
					],
				},
			});

			// Store answer and hint data in Redis (24h TTL)
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
						questionPreview: questionData.questionPreview || [],
					}),
				);

				// Store pack question IDs for pack flow (24h TTL)
				if (Array.isArray(questionData.packQuestions) && questionData.packQuestions.length > 0) {
					await redisClient.setEx(
						packKey,
						3600 * 24,
						JSON.stringify(questionData.packQuestions.map(String)),
					);
				}
			}

			return { answerKey, questionMessageId: separate.message_id };
		} catch (imgError) {
			console.error("Error sending question media group:", imgError);
			// Fall through to send without images
		}
	}

	// Send question as regular text message with inline buttons
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
							packKey:
								questionData.packQuestions && questionData.packQuestions.length
									? packKey
									: undefined,
						}),
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

module.exports = { sendQuestionMessage };
