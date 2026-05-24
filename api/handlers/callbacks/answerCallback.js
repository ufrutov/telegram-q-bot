/**
 * Answer Callback Handler - Show answer button
 */
const { TARGET_DOMAIN } = require('../../../src/bot/constants');

module.exports = async function answerCallback(bot, redis, callbackQuery, parsed, threadId) {
	const chatId = callbackQuery.message?.chat?.id;
	const answerKey = parsed.answerKey;
	const threadOpts = threadId ? { message_thread_id: threadId } : {};

	// Validate answerKey
	if (!answerKey) {
		return;
	}

	try {
		// Get answer from Redis
		const answerDataStr = redis ? await redis.get(answerKey) : null;
		
		const questionId = answerKey.split(':').at(2);
		const logChat = threadId ? `${chatId}_${threadId}` : chatId;
		console.log(`[${logChat}] answer: https://${TARGET_DOMAIN}/question/${questionId}`);

		// Handle expired answer
		if (!answerDataStr) {
			await bot.sendMessage(
				chatId,
				'⏰ Время ответа истекло.\\nУвидеть ответ можно по ссылке ниже ↗️',
				{
					...threadOpts,
					parse_mode: 'MarkdownV2',
					reply_markup: {
						inline_keyboard: [[{
							text: `❓ Вопрос ${questionId}`,
							url: `https://${TARGET_DOMAIN}/question/${questionId}`,
						}]],
					},
				}
			);
			return;
		}

		const answerData = JSON.parse(answerDataStr);
		const { answer, answerPreview, questionMessageId = undefined } = answerData;

		// Determine which message to reply to
		const messageToReply = questionMessageId ?? callbackQuery.message.message_id;

		// Send answer with images or text
		if (answerPreview && answerPreview.length > 0) {
			const media = answerPreview.map((url, index) => ({
				type: 'photo',
				media: url,
				...(index === 0 && {
					caption: answer,
					parse_mode: 'MarkdownV2',
				}),
			}));
			
			try {
				await bot.sendMediaGroup(chatId, media, { 
					...threadOpts, 
					reply_to_message_id: messageToReply 
				});
			} catch (imgError) {
				console.error('Error sending answer media group:', imgError);
				await bot.sendMessage(chatId, answer, {
					...threadOpts,
					parse_mode: 'MarkdownV2',
					reply_to_message_id: messageToReply,
					disable_web_page_preview: true,
				});
			}
		} else {
			await bot.sendMessage(chatId, answer, {
				...threadOpts,
				parse_mode: 'MarkdownV2',
				reply_to_message_id: messageToReply,
				disable_web_page_preview: true,
			});
		}

		// Remove inline buttons from question message
		try {
			await bot.editMessageReplyMarkup(
				{ inline_keyboard: [] },
				{ chat_id: chatId, message_id: callbackQuery.message.message_id }
			);
		} catch (editError) {
			console.error('Error removing reply markup:', editError);
		}

		// Delete separate button message if question had images
		if (questionMessageId) {
			try {
				await bot.deleteMessage(chatId, callbackQuery.message.message_id);
			} catch (deleteError) {
				console.error(
					'Error deleting separated message after question with media group:',
					deleteError
				);
			}
		}

		// Delete answer data from Redis (one-time use)
		if (redis) {
			await redis.del(answerKey);
		}
	} catch (error) {
		console.error('Error handling callback query (answer):', error);
		await bot.answerCallbackQuery(callbackQuery.id, {
			text: '❌ Ошибка при загрузке ответа',
			show_alert: true,
		});
	}
};
