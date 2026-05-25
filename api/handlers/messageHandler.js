/**
 * Message Handler - Processes text commands
 */
const { sendQuestionMessage } = require('../../src/services/questionSender');
const { sendPackMessage } = require('../../src/services/packSender');
const { MESSAGES } = require('../../src/bot/constants');

// Command complexity mapping
const COMPLEXITY_MAP = {
	'/question': 'random',
	'/questioneasy': 'easy',
	'/questionmedium': 'medium',
	'/questionhard': 'hard',
};

/**
 * Handle /question commands with optional complexity and ID
 */
async function handleQuestionCommand(bot, redis, chatId, messageText, threadId) {
	const parts = messageText.split(/\s+/);
	const questionId = parts.length > 1 && /^\d+$/.test(parts[1]) ? parts[1] : null;
	const complexity = COMPLEXITY_MAP[parts[0]] || 'random';
	
	await sendQuestionMessage(bot, redis, chatId, complexity, questionId, threadId);
}

/**
 * Handle /menu command - show difficulty selection keyboard
 */
async function handleMenuCommand(bot, chatId, threadId) {
	const threadOpts = threadId ? { message_thread_id: threadId } : {};
	
	await bot.sendMessage(chatId, MESSAGES.MENU_TITLE, {
		...threadOpts,
		parse_mode: 'MarkdownV2',
		reply_markup: {
			inline_keyboard: [
				[{
					text: MESSAGES.DIFFICULTY_EASY,
					callback_data: JSON.stringify({ action: 'question', complexity: 'easy' })
				}],
				[{
					text: MESSAGES.DIFFICULTY_MEDIUM,
					callback_data: JSON.stringify({ action: 'question', complexity: 'medium' })
				}],
				[{
					text: MESSAGES.DIFFICULTY_HARD,
					callback_data: JSON.stringify({ action: 'question', complexity: 'hard' })
				}],
				[{
					text: MESSAGES.DIFFICULTY_RANDOM,
					callback_data: JSON.stringify({ action: 'question', complexity: 'random' })
				}],
			],
		},
	});
}

/**
 * Handle /pack command with optional pack ID
 */
async function handlePackCommand(bot, redis, chatId, messageText, threadId) {
	const parts = messageText.split(/\s+/);
	const packId = parts.length > 1 && /^\d+$/.test(parts[1]) ? parts[1] : null;
	
	await sendPackMessage(bot, redis, chatId, packId, threadId);
}

/**
 * Main message handler
 */
module.exports = async function messageHandler(bot, redis, message) {
	const chatId = message.chat?.id;
	const messageText = message.text;
	const threadId = message.message_thread_id;

	if (!chatId) {
		console.error('Invalid message structure: missing chat.id');
		return;
	}

	if (!messageText) return;

	try {
		if (messageText.startsWith('/question')) {
			await handleQuestionCommand(bot, redis, chatId, messageText, threadId);
		} else if (messageText.startsWith('/menu')) {
			await handleMenuCommand(bot, chatId, threadId);
		} else if (messageText.startsWith('/pack')) {
			await handlePackCommand(bot, redis, chatId, messageText, threadId);
		}
	} catch (error) {
		console.error('Error handling message:', error);
	}
};
