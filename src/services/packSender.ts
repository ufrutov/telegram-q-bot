/**
 * Pack Sender Service - Handles pack loading, formatting, and message sending
 */

import TelegramBot from 'node-telegram-bot-api';
import { RedisClientType } from 'redis';
import { createQuestionLoader } from '@lib/QuestionLoader/QuestionLoader';
import { escapeMarkdownV2 } from '@utils/markdown';
import { formatDate } from '@utils/date';
import { getThreadOptions } from '@utils/redis';
import { TARGET_DOMAIN, PACK_QUESTIONS_PER_ROW } from '@bot/constants';

interface PackData {
	id: string;
	title: string;
	pubDate?: string;
	trueDl?: number[];
	total: number;
	questions: Array<{ id: string; number: number }>;
}

/**
 * Sends a pack info message with inline keyboard for question selection
 */
export async function sendPackMessage(
	bot: TelegramBot,
	_redis: RedisClientType | null,
	chatId: number | string,
	packId: string | null = null,
	threadId?: number,
): Promise<void> {
	const threadOpts = getThreadOptions(threadId);

	// Send loading message
	const loadingMsg = await bot.sendMessage(chatId, '🔄 Загружаю пакет...', threadOpts);

	try {
		// Load pack data
		let packData: PackData;

		if (packId) {
			// Load specific pack by ID
			const questionLoader = createQuestionLoader(TARGET_DOMAIN, 'random') as any;
			const loadedPack = await questionLoader.loadPackData(packId);

			if (!loadedPack || !loadedPack.questions || loadedPack.questions.length === 0) {
				throw new Error('Pack not found or has no questions');
			}
			packData = loadedPack as PackData;
		} else {
			// Load random question first, then get its pack
			const questionLoader = createQuestionLoader(TARGET_DOMAIN, 'random') as any;
			const questionData = await questionLoader.loadQuestion();

			if (!questionData || !questionData.pack?.id) {
				throw new Error('Failed to load random question or pack ID not found');
			}

			// Load the full pack
			const loadedPack = await questionLoader.loadPackData(questionData.pack.id);

			if (!loadedPack || !loadedPack.questions || loadedPack.questions.length === 0) {
				throw new Error('Failed to load pack data');
			}
			packData = loadedPack as PackData;
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
		await bot.sendMessage(chatId, '❌ Ошибка при загрузке пакета\\. Попробуйте позже\\.', {
			...threadOpts,
			parse_mode: 'MarkdownV2',
		});

		throw error;
	}
}

/**
 * Format pack information message with MarkdownV2
 */
function formatPackInfo(packData: PackData): string {
	const { id, title, pubDate, trueDl, total, questions } = packData;
	const baseUrl = TARGET_DOMAIN;

	// Calculate average complexity from trueDl array
	let avgComplexity = '—';
	if (Array.isArray(trueDl) && trueDl.length > 0) {
		const sum = trueDl.reduce((a, b) => a + b, 0);
		avgComplexity = (sum / trueDl.length).toFixed(1);
	}

	// Escape title for MarkdownV2
	const escapedTitle = escapeMarkdownV2(title);

	// Escape complexity value (contains decimal point that must be escaped)
	const escapedComplexity = escapeMarkdownV2(avgComplexity);

	// Format date
	const formattedDate = formatDate(pubDate || '');

	// Build message with pack info
	let message = `Пакет: [*${escapedTitle}*](https://${baseUrl}/pack/${id}/)\n`;

	if (formattedDate) {
		message += `📅 ${escapeMarkdownV2(formattedDate)}\n`;
	}

	message += `⚡ Сложность: *${escapedComplexity}*\n`;
	const totalQuestions = total || questions.length;
	const questionCountText =
		totalQuestions > questions.length
			? `${questions.length}/${totalQuestions}`
			: String(questions.length);
	message += `📊 Вопросов: *${escapeMarkdownV2(questionCountText)}*\n\n`;
	message += `**Выберите вопрос:**`;

	return message;
}

/**
 * Build inline keyboard with question numbers (6 per row)
 */
function buildPackKeyboard(
	questions: Array<{ id: string; number: number }>,
): TelegramBot.InlineKeyboardMarkup {
	const buttons: TelegramBot.InlineKeyboardButton[] = [];
	const questionsPerRow = PACK_QUESTIONS_PER_ROW;

	// Create button for each question
	for (let i = 0; i < questions.length; i++) {
		const questionNum = i + 1;
		const questionId = questions[i].id;

		buttons.push({
			text: questionNum.toString(),
			callback_data: JSON.stringify({
				action: 'packQuestion',
				questionId: questionId,
			}),
		});
	}

	// Group buttons into rows of 6
	const rows: TelegramBot.InlineKeyboardButton[][] = [];
	for (let i = 0; i < buttons.length; i += questionsPerRow) {
		rows.push(buttons.slice(i, i + questionsPerRow));
	}

	return { inline_keyboard: rows };
}
