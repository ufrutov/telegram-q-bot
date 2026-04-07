const QuestionLoader = require("../lib/QuestionLoader/QuestionLoader");
const { escapeMarkdownV2 } = require("../utils/markdown");

const target = "gotquestions.online";

async function sendQuestionMessage(bot, redisClient, chatId, complexity, questionId = undefined) {
	const loadingMsg = await bot.sendMessage(chatId, "🔄 Загружаю вопрос...");

	const questionLoader = QuestionLoader(target, complexity);

	const questionData = await questionLoader.loadQuestion(questionId);
	const { question, answer } = questionLoader.formatForTelegram(questionData, true, false);

	console.log(`[${chatId}] ${complexity} question: ${questionData.link}`);

	try {
		await bot.deleteMessage(chatId, loadingMsg.message_id);
	} catch (dErr) {
		// ignore
	}

	const answerKey = `answer:${chatId}:${questionData.id}`;
	const hintKey = `hint:${chatId}:${questionData.id}`;

	if (questionData.questionPreview && questionData.questionPreview.length > 0) {
		return sendQuestionWithImages(bot, redisClient, chatId, question, questionData, answerKey, hintKey);
	} else {
		return sendQuestionWithoutImages(bot, redisClient, chatId, question, questionData, answerKey, hintKey);
	}
}

async function sendQuestionWithImages(bot, redisClient, chatId, question, questionData, answerKey, hintKey) {
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

		const separate = await bot.sendMessage(chatId, "Ответ на вопрос", {
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
		}

		return { answerKey, questionMessageId: separate.message_id };
	} catch (imgError) {
		console.error("Error sending question media group:", imgError);
		return sendQuestionWithoutImages(bot, redisClient, chatId, question, questionData, answerKey, hintKey);
	}
}

async function sendQuestionWithoutImages(bot, redisClient, chatId, question, questionData, answerKey, hintKey) {
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
				questionPreview: questionData.questionPreview || [],
			}),
		);
	}

	return { answerKey, questionMessageId: questionMessage.message_id };
}

module.exports = { sendQuestionMessage };