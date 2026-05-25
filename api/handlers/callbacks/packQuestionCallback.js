/**
 * Pack Question Callback Handler - Handle question selection from pack keyboard
 */
const { sendQuestionMessage } = require('../../../src/services/questionSender');

/**
 * Handle pack question button clicks
 * 
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {RedisClientType} redis - Redis client
 * @param {Object} callbackQuery - Telegram callback query object
 * @param {Object} parsed - Parsed callback data
 * @param {number} [threadId] - Telegram forum topic thread ID
 */
module.exports = async function packQuestionCallback(bot, redis, callbackQuery, parsed, threadId) {
	const chatId = callbackQuery.message?.chat?.id;
	const questionId = parsed.questionId;
	
	if (!questionId) {
		return;
	}
	
	try {
		// Answer callback query to remove loading indicator
		await bot.answerCallbackQuery(callbackQuery.id);
		
		// Load specific question by ID using existing sendQuestionMessage
		// Use 'random' complexity since we're loading by specific ID
		await sendQuestionMessage(bot, redis, chatId, 'random', questionId.toString(), threadId);
		
	} catch (error) {
		console.error('Error handling pack question callback:', error);
		await bot.answerCallbackQuery(callbackQuery.id, {
			text: '❌ Ошибка при загрузке вопроса',
			show_alert: true,
		});
	}
};
