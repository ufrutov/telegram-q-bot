/**
 * Callback Query Handler - Routes button presses
 */
const questionCallback = require('./callbacks/questionCallback');
const answerCallback = require('./callbacks/answerCallback');
const hintCallback = require('./callbacks/hintCallback');
const packQuestionCallback = require('./callbacks/packQuestionCallback');
const { sendPackMessage } = require('../../src/services/packSender');

/**
 * Parse and validate callback data
 */
function parseCallbackData(data) {
	try {
		return JSON.parse(data);
	} catch {
		return null;
	}
}

/**
 * Main callback handler
 */
module.exports = async function callbackHandler(bot, redis, callbackQuery) {
	const chatId = callbackQuery.message?.chat?.id;
	const threadId = callbackQuery.message?.message_thread_id;

	// Validate chatId
	if (!chatId) {
		return;
	}

	// Parse callback data
	const parsed = parseCallbackData(callbackQuery.data);
	if (!parsed) {
		return;
	}

	// Route to specific callback handler
	// Each handler has its own try-catch for error handling
	if (parsed.action === 'question') {
		await questionCallback(bot, redis, callbackQuery, parsed, threadId);
	} else if (parsed.action === 'packQuestion') {
		await packQuestionCallback(bot, redis, callbackQuery, parsed, threadId);
	} else if (parsed.action === 'pack') {
		// Handle "Играть весь пакет" button - reuses /pack command infrastructure
		try {
			// Acknowledge callback first to prevent "query too old" errors
			await bot.answerCallbackQuery(callbackQuery.id);

			// Remove button from answer message (one-time use)
			try {
				await bot.editMessageReplyMarkup(
					{ inline_keyboard: [] },
					{ chat_id: chatId, message_id: callbackQuery.message.message_id },
				);
			} catch (editError) {
				// Ignore "message is not modified" — button was already removed
			}

			// Load and send pack using existing service
			await sendPackMessage(bot, redis, chatId, parsed.packId, threadId);
		} catch (error) {
			console.error('Error loading pack from answer button:', error);
		}
	} else if (parsed.answerKey) {
		await answerCallback(bot, redis, callbackQuery, parsed, threadId);
	} else if (parsed.hintKey) {
		await hintCallback(bot, redis, callbackQuery, parsed, threadId);
	}
};
