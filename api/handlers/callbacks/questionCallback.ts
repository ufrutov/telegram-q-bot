/**
 * Question Callback Handler - Menu selection
 */
import TelegramBot from 'node-telegram-bot-api';
import { RedisClientType } from 'redis';
import { sendQuestionMessage } from '@services/questionSender';
import { MESSAGES } from '@bot/constants';
import { Complexity } from '@app-types/question';

interface QuestionCallbackData {
	action: 'question';
	complexity?: string;
}

/**
 * Handle question menu selection callbacks
 */
export async function questionCallback(
	bot: TelegramBot,
	redis: RedisClientType | null,
	callbackQuery: TelegramBot.CallbackQuery,
	parsed: QuestionCallbackData,
	threadId?: number,
): Promise<void> {
	const chatId = callbackQuery.message?.chat?.id;

	if (!chatId) {
		return;
	}

	const complexity = (parsed.complexity || 'random') as Complexity;

	try {
		await bot.answerCallbackQuery(callbackQuery.id);
		await sendQuestionMessage(bot, redis, chatId, complexity, undefined, threadId);

		// Delete the menu message after selection
		try {
			if (callbackQuery.message?.message_id) {
				await bot.deleteMessage(chatId, callbackQuery.message.message_id);
			}
		} catch {
			// Ignore deletion errors
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('Error handling question callback:', errorMessage);
		await bot.answerCallbackQuery(callbackQuery.id, {
			text: MESSAGES.ERROR_LOADING_QUESTION,
			show_alert: true,
		});
	}
}
