/**
 * Pack Sender Service - Handles pack loading, formatting, and message sending
 */
const QuestionLoader = require('../lib/QuestionLoader/QuestionLoader');
const { escapeMarkdownV2 } = require('../utils/markdown');
const { formatDate } = require('../utils/date');

/**
 * Sends a pack info message with inline keyboard for question selection
 * 
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {RedisClientType} redis - Redis client
 * @param {string|number} chatId - Target chat ID
 * @param {string} [packId] - Specific pack ID, or null to load random
 * @param {number} [threadId] - Telegram forum topic thread ID
 */
async function sendPackMessage(bot, redis, chatId, packId = null, threadId = undefined) {
	const threadOpts = threadId ? { message_thread_id: threadId } : {};
	
	// Send loading message
	const loadingMsg = await bot.sendMessage(chatId, '🔄 Загружаю пакет...', threadOpts);
	
	try {
		// Load pack data
		let packData;
		
		if (packId) {
			// Load specific pack by ID
			const questionLoader = QuestionLoader('gotquestions.online', 'random');
			packData = await questionLoader.loadPackData(packId);
			
			if (!packData || !packData.questions || packData.questions.length === 0) {
				throw new Error('Pack not found or has no questions');
			}
		} else {
			// Load random question first, then get its pack
			const questionLoader = QuestionLoader('gotquestions.online', 'random');
			const questionData = await questionLoader.loadQuestion();
			
			if (!questionData || !questionData.packId) {
				throw new Error('Failed to load random question or pack ID not found');
			}
			
			// Load the full pack
			packData = await questionLoader.loadPackData(questionData.packId);
			
			if (!packData || !packData.questions || packData.questions.length === 0) {
				throw new Error('Failed to load pack data');
			}
		}
		
		// Format pack info message
		const packInfoText = formatPackInfo(packData);
		
		// Build inline keyboard (6 questions per row)
		const keyboard = buildPackKeyboard(packData.questions);
		
		// Delete loading message
		try {
			await bot.deleteMessage(chatId, loadingMsg.message_id);
		} catch (deleteError) {
			// Ignore deletion errors
		}
		
		// Send pack info with keyboard
		await bot.sendMessage(chatId, packInfoText, {
			...threadOpts,
			parse_mode: 'MarkdownV2',
			reply_markup: keyboard,
			disable_web_page_preview: true,
		});
		
		const logChat = threadId ? `${chatId}_${threadId}` : chatId;
		console.log(`[${logChat}] pack: https://gotquestions.online/pack/${packData.id}/`);
		
	} catch (error) {
		console.error('Error sending pack message:', error);
		
		// Delete loading message on error
		try {
			await bot.deleteMessage(chatId, loadingMsg.message_id);
		} catch {
			// Ignore
		}
		
		// Send error message
		await bot.sendMessage(
			chatId,
			'❌ Ошибка при загрузке пакета\\. Попробуйте позже\\.',
			{ ...threadOpts, parse_mode: 'MarkdownV2' }
		);
		
		throw error;
	}
}

/**
 * Format pack information message with MarkdownV2
 */
function formatPackInfo(packData) {
	const { id, title, pubDate, trueDl, questions } = packData;
	const baseUrl = 'gotquestions.online';
	
	// Calculate average complexity from trueDl array
	let avgComplexity = '—';
	if (Array.isArray(trueDl) && trueDl.length > 0) {
		const sum = trueDl.reduce((a, b) => a + b, 0);
		avgComplexity = (sum / trueDl.length).toFixed(1);
	}
	
	// Escape title for MarkdownV2
	const escapedTitle = escapeMarkdownV2(title);
	
	// Format date
	const formattedDate = formatDate(pubDate);
	
	// Build message with pack info
	let message = `[*${escapedTitle}*](https://${baseUrl}/pack/${id}/)\n`;
	
	if (formattedDate) {
		message += `📅 ${escapeMarkdownV2(formattedDate)}\n`;
	}
	
	message += `⚡ Сложность: *${avgComplexity}*\n`;
	message += `📊 Вопросов: *${questions.length}*\n\n`;
	message += `Выберите вопрос:`;
	
	return message;
}

/**
 * Build inline keyboard with question numbers (6 per row)
 */
function buildPackKeyboard(questions) {
	const buttons = [];
	const questionsPerRow = 6;
	
	// Create button for each question
	for (let i = 0; i < questions.length; i++) {
		const questionNum = i + 1;  // Absolute numbering: 1-36
		const questionId = questions[i].id;
		
		buttons.push({
			text: questionNum.toString(),
			callback_data: JSON.stringify({
				action: 'packQuestion',
				questionId: questionId
			})
		});
	}
	
	// Group buttons into rows of 6
	const rows = [];
	for (let i = 0; i < buttons.length; i += questionsPerRow) {
		rows.push(buttons.slice(i, i + questionsPerRow));
	}
	
	return { inline_keyboard: rows };
}

module.exports = { sendPackMessage };
