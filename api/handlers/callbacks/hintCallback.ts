/**
 * Hint Callback Handler - AI-generated hints
 */
import TelegramBot from 'node-telegram-bot-api';
import { RedisClientType } from 'redis';
import { generateHint, formatErrorMessage } from '@services/openrouter';
import { getThreadOptions } from '@utils/redis';
import { escapeMarkdownV2 } from '@utils/markdown';
import { MESSAGES } from '@bot/constants';

interface HintCallbackData {
	hintKey: string;
}

interface StoredHintData {
	question: string;
	answer: string;
	description?: string;
	questionMessageId?: number;
	questionPreview?: string[];
}

/**
 * Handle hint button callbacks
 */
export async function hintCallback(
	bot: TelegramBot,
	redis: RedisClientType | null,
	callbackQuery: TelegramBot.CallbackQuery,
	parsed: HintCallbackData,
	threadId?: number,
): Promise<void> {
	const chatId = callbackQuery.message?.chat?.id;
	const hintKey = parsed.hintKey;

	if (!chatId || !hintKey) {
		return;
	}

	const threadOpts = getThreadOptions(threadId);

	try {
		// Answer callback query
		await bot.answerCallbackQuery(callbackQuery.id);

		// Get hint data from Redis
		const hintDataStr = redis ? await redis.get(hintKey) : null;

		// Handle expired hint
		if (!hintDataStr) {
			await bot.sendMessage(chatId, MESSAGES.HINT_EXPIRED, threadOpts);
			return;
		}

		const hintData: StoredHintData = JSON.parse(hintDataStr);
		const { question, answer, description, questionMessageId, questionPreview = [] } = hintData;

		// Remove hint button from keyboard (keep answer button)
		if (callbackQuery.message?.message_id) {
			try {
				const answerKeyMatch = callbackQuery.message.reply_markup?.inline_keyboard?.[0]?.find(
					(btn) => btn.text === '📖 Ответ',
				);
				const newKeyboard = answerKeyMatch
					? { inline_keyboard: [[answerKeyMatch]] }
					: { inline_keyboard: [] };

				await bot.editMessageReplyMarkup(newKeyboard, {
					chat_id: chatId,
					message_id: callbackQuery.message.message_id,
				});
			} catch (editError) {
				const errorMessage = editError instanceof Error ? editError.message : 'Unknown error';
				console.error('Error removing reply markup:', errorMessage);
			}
		}

		// Generate hint using AI
		let hint: string;
		try {
			const loadingMsg = await bot.sendMessage(chatId, MESSAGES.HINT_LOADING, threadOpts);
			hint = await generateHint(question, answer, description, questionPreview);
			try {
				await bot.deleteMessage(chatId, loadingMsg.message_id);
			} catch {
				// Ignore deletion errors
			}
		} catch (genError) {
			const errorMessage = genError instanceof Error ? genError.message : 'Unknown error';
			console.error('Error generating hint:', errorMessage);
			hint = formatErrorMessage(genError);
		}

		// Send hint message
		const messageToReply = questionMessageId ?? callbackQuery.message?.message_id;
		await bot.sendMessage(chatId, `💡 *Подсказка:*\n${escapeMarkdownV2(hint)}`, {
			...threadOpts,
			parse_mode: 'MarkdownV2',
			...(messageToReply && { reply_to_message_id: messageToReply }),
			disable_web_page_preview: true,
		});

		// Delete hint data from Redis
		if (redis) {
			await redis.del(hintKey);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('Error handling callback query (hint):', errorMessage);
		await bot.answerCallbackQuery(callbackQuery.id, {
			text: MESSAGES.ERROR_LOADING_HINT,
			show_alert: true,
		});
	}
}
