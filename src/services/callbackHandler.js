const { generateHint, formatErrorMessage } = require("../services/openrouter");

async function handleAnswerCallback(bot, redisClient, callbackQuery, res) {
	const { answerKey } = JSON.parse(callbackQuery.data);
	const chatId = callbackQuery.message.chat.id;
	const questionId = answerKey.split(":").at(2);
	console.log(`[${chatId}] answer: https://gotquestions.online/question/${questionId}`);

	const answerDataStr = redisClient ? await redisClient.get(answerKey) : null;

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
								url: `https://gotquestions.online/question/${questionId}`,
							},
						],
					],
				},
			},
		);
		return;
	}

	const answerData = JSON.parse(answerDataStr);
	const { answer, answerPreview, questionMessageId = undefined } = answerData;

	const messageToReply = questionMessageId ?? callbackQuery.message.message_id;

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

	try {
		await bot.editMessageReplyMarkup(
			{ inline_keyboard: [] },
			{ chat_id: chatId, message_id: callbackQuery.message.message_id },
		);
	} catch (editError) {
		console.error("Error removing reply markup:", editError);
	}

	if (questionMessageId) {
		try {
			await bot.deleteMessage(chatId, callbackQuery.message.message_id);
		} catch (deleteError) {
			console.error("Error deleting separated message:", deleteError);
		}
	}

	if (redisClient) {
		await redisClient.del(answerKey);
	}
}

async function handleHintCallback(bot, redisClient, callbackQuery, res) {
	const { hintKey } = JSON.parse(callbackQuery.data);
	const chatId = callbackQuery.message.chat.id;

	await bot.answerCallbackQuery(callbackQuery.id);

	const hintDataStr = redisClient ? await redisClient.get(hintKey) : null;

	if (!hintDataStr) {
		await bot.sendMessage(chatId, "⏰ Время подсказки истекло.");
		return;
	}

	const hintData = JSON.parse(hintDataStr);
	const { question, answer, description, questionMessageId, questionPreview = [] } = hintData;

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
}

module.exports = { handleAnswerCallback, handleHintCallback };