/**
 * Question Callback Handler - Menu selection
 */
const { sendQuestionMessage } = require('../../../src/services/questionSender');
const { MESSAGES } = require('../../../src/bot/constants');

module.exports = async function questionCallback(bot, redis, callbackQuery, parsed, threadId) {
	const chatId = callbackQuery.message?.chat?.id;
	const complexity = parsed.complexity || 'random';

	try {
		await bot.answerCallbackQuery(callbackQuery.id);
		await sendQuestionMessage(bot, redis, chatId, complexity, undefined, threadId);
		
		// Delete the menu message after selection
		try {
			await bot.deleteMessage(chatId, callbackQuery.message.message_id);
		} catch {
			// Ignore deletion errors
		}
	} catch (error) {
		console.error('Error handling question callback:', error);
		await bot.answerCallbackQuery(callbackQuery.id, {
			text: MESSAGES.ERROR_LOADING_QUESTION,
			show_alert: true,
		});
	}
};
