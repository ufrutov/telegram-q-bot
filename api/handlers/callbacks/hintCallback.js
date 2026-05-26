/**
 * Hint Callback Handler - AI hint generation
 */
const { generateHint, formatErrorMessage } = require('../../../src/services/openrouter');
const { escapeMarkdownV2 } = require('../../../src/utils/markdown');

module.exports = async function hintCallback(bot, redis, callbackQuery, parsed, threadId) {
	const chatId = callbackQuery.message?.chat?.id;
	const hintKey = parsed.hintKey;
	const threadOpts = threadId ? { message_thread_id: threadId } : {};

	// Validate hintKey
	if (!hintKey) {
		return;
	}

	try {
		// Answer callback query
		await bot.answerCallbackQuery(callbackQuery.id);

		// Get hint data from Redis
		const hintDataStr = redis ? await redis.get(hintKey) : null;

		// Handle expired hint
		if (!hintDataStr) {
			await bot.sendMessage(chatId, '⏰ Время подсказки истекло.', threadOpts);
			return;
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
				(btn) => btn.text === '📖 Ответ'
			);
			const newKeyboard = answerKeyMatch
				? { inline_keyboard: [[answerKeyMatch]] }
				: { inline_keyboard: [] };

			await bot.editMessageReplyMarkup(newKeyboard, {
				chat_id: chatId,
				message_id: callbackQuery.message.message_id,
			});
		} catch (editError) {
			console.error('Error removing reply markup:', editError);
		}

		// Generate hint using AI
		let hint;
		try {
			const loadingMsg = await bot.sendMessage(chatId, '✨ Загружаю подсказку...', threadOpts);
			hint = await generateHint(question, answer, description, questionPreview);
			try {
				await bot.deleteMessage(chatId, loadingMsg.message_id);
			} catch (dErr) {
				// ignore
			}
		} catch (genError) {
			console.error('Error generating hint:', genError.message);
			hint = formatErrorMessage(genError);
		}

		// Send hint message
		const messageToReply = questionMessageId ?? callbackQuery.message.message_id;
		await bot.sendMessage(chatId, `💡 *Подсказка:*\n${escapeMarkdownV2(hint)}`, {
			...threadOpts,
			parse_mode: 'MarkdownV2',
			reply_to_message_id: messageToReply,
			disable_web_page_preview: true,
		});

		// Delete hint data from Redis
		if (redis) {
			await redis.del(hintKey);
		}
	} catch (error) {
		console.error('Error handling callback query (hint):', error);
		await bot.answerCallbackQuery(callbackQuery.id, {
			text: '❌ Ошибка при загрузке подсказки',
			show_alert: true,
		});
	}
};
