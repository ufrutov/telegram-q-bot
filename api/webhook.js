const { bot, redisClient, connectRedis } = require("../src/services/bot");
const { sendQuestionMessage } = require("../src/services/questionSender");
const { handleAnswerCallback, handleHintCallback } = require("../src/services/callbackHandler");

module.exports = async (req, res) => {
	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	if (!bot) {
		console.error("TELEGRAM_BOT_TOKEN is not configured");
		return res.status(500).json({ error: "Bot not configured" });
	}

	try {
		await connectRedis();

		const update = req.body;

		if (!update || typeof update !== "object") {
			return res.status(400).json({ error: "Invalid request body" });
		}

		if (update.message) {
			await handleMessage(bot, redisClient, update.message);
		}

		if (update.callback_query) {
			await handleCallbackQuery(bot, redisClient, update.callback_query, res);
			return res.status(200).json({ ok: true });
		}

		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error("Error processing webhook:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
};

async function handleMessage(bot, redisClient, message) {
	const chatId = message.chat?.id;
	const messageText = message.text;

	if (!chatId) {
		console.error("Invalid message structure: missing chat.id");
		return;
	}

	if (messageText) {
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

async function handleCallbackQuery(bot, redisClient, callbackQuery, res) {
	const dataStr = callbackQuery.data;
	let parsed = null;
	try {
		parsed = JSON.parse(dataStr);
	} catch (e) {
		parsed = null;
	}

	const chatId = callbackQuery.message?.chat?.id;
	if (!chatId) {
		return;
	}

	if (parsed && parsed.action === "question") {
		await bot.answerCallbackQuery(callbackQuery.id);
		await sendQuestionMessage(bot, redisClient, chatId, parsed.complexity || "random");
		try {
			await bot.deleteMessage(chatId, callbackQuery.message.message_id);
		} catch (e2) {
			// ignore
		}
		return;
	}

	if (parsed && parsed.answerKey) {
		await handleAnswerCallback(bot, redisClient, callbackQuery, res);
		return;
	}

	if (parsed && parsed.hintKey) {
		await handleHintCallback(bot, redisClient, callbackQuery, res);
	}
}