/**
 * Pack Question Callback Handler - Select question from pack
 */
import TelegramBot from 'node-telegram-bot-api';
import { RedisClientType } from 'redis';
import { sendQuestionMessage } from '@services/questionSender';
import { MESSAGES } from '@bot/constants';

interface PackQuestionCallbackData {
	action: 'packQuestion';
	questionId: number;
}

/**
 * Handle pack question button clicks
 */
export async function packQuestionCallback(
	bot: TelegramBot,
	redis: RedisClientType | null,
	callbackQuery: TelegramBot.CallbackQuery,
	parsed: PackQuestionCallbackData,
	threadId?: number,
): Promise<void> {
	const chatId = callbackQuery.message?.chat?.id;
	const questionId = parsed.questionId;

	if (!chatId || !questionId) {
		return;
	}

	try {
		// Answer callback query to remove loading indicator
		await bot.answerCallbackQuery(callbackQuery.id);

		// Load specific question by ID using existing sendQuestionMessage
		// Use 'random' complexity since we're loading by specific ID
		await sendQuestionMessage(bot, redis, chatId, 'random', questionId.toString(), threadId);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('Error handling pack question callback:', errorMessage);
		await bot.answerCallbackQuery(callbackQuery.id, {
			text: MESSAGES.ERROR_LOADING_QUESTION,
			show_alert: true,
		});
	}
}
