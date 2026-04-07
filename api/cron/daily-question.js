const TelegramBot = require("node-telegram-bot-api");
const QuestionLoader = require("../src/lib/QuestionLoader/QuestionLoader");
const { createClient } = require("redis");

const token = process.env.TELEGRAM_BOT_TOKEN;
const cronSecret = process.env.CRON_SECRET;
const target = "gotquestions.online";
const targetChats = process.env.CRON_TARGET_CHATS || "";

let redisClient;
if (process.env.REDIS_URL) {
	redisClient = createClient({
		url: process.env.REDIS_URL,
	});
	redisClient.on("error", (err) => console.error("Redis Client Error", err));
}

function isValidTokenFormat(botToken) {
	if (!botToken || typeof botToken !== "string") {
		return false;
	}
	const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
	return tokenPattern.test(botToken);
}

let bot;
if (token && isValidTokenFormat(token)) {
	bot = new TelegramBot(token);
}

async function sendQuestionMessage(chatId, complexity = "random", questionId = undefined) {
	try {
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
					await redisClient.setEx(answerKey, 3600 * 24, JSON.stringify({ answer: questionData.answer, answerPreview }));
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
			}
		}

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
			await redisClient.setEx(answerKey, 3600 * 24, JSON.stringify({ answer: questionData.answer, answerPreview }));
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
	} catch (error) {
		console.error(`Error sending question to ${chatId}:`, error);
		try {
			await bot.sendMessage(chatId, "❌ Произошла ошибка при загрузке вопроса.");
		} catch (e) {
			// ignore
		}
		return null;
	}
}

module.exports = async (req, res) => {
	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	if (!token || !bot) {
		console.error("TELEGRAM_BOT_TOKEN is not configured");
		return res.status(500).json({ error: "Bot not configured" });
	}

	if (req.headers["x-vercel-cron"] !== "true") {
		if (cronSecret && req.headers["x-cron-secret"] !== cronSecret) {
			return res.status(403).json({ error: "Unauthorized" });
		}
	}

	try {
		if (redisClient && !redisClient.isOpen) {
			await redisClient.connect();
		}

		const chatIds = targetChats.split(",").map((id) => id.trim()).filter((id) => /^\d+$/.test(id));

		if (chatIds.length === 0) {
			return res.status(400).json({ error: "No target chats configured" });
		}

		console.log(`Starting cron job for ${chatIds.length} chats`);

		let successCount = 0;
		let failCount = 0;

		for (const chatId of chatIds) {
			try {
				await sendQuestionMessage(chatId, "random");
				successCount++;
			} catch (err) {
				console.error(`Failed to send to ${chatId}:`, err.message);
				failCount++;
			}
		}

		console.log(`Cron completed: ${successCount} sent, ${failCount} failed`);

		return res.status(200).json({ ok: true, success: successCount, failed: failCount });
	} catch (error) {
		console.error("Error processing cron:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
};