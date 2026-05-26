/**
 * Callback Query Handler - Routes button presses
 */
import TelegramBot from 'node-telegram-bot-api';
import { RedisClientType } from 'redis';
import { sendPackMessage } from '@services/packSender';
import { questionCallback } from './callbacks/questionCallback';
import { answerCallback } from './callbacks/answerCallback';
import { hintCallback } from './callbacks/hintCallback';
import { packQuestionCallback } from './callbacks/packQuestionCallback';

/**
 * Union type for all possible callback data structures
 */
type CallbackData =
	| { action: 'question'; complexity?: string }
	| { action: 'packQuestion'; questionId: number }
	| { action: 'pack'; packId: string }
	| { answerKey: string }
	| { hintKey: string };

/**
 * Parse and validate callback data
 */
function parseCallbackData(data: string): CallbackData | null {
	try {
		return JSON.parse(data) as CallbackData;
	} catch {
		return null;
	}
}

/**
 * Main callback handler - routes callback queries to specific handlers
 */
export async function callbackHandler(
	bot: TelegramBot,
	redis: RedisClientType | null,
	callbackQuery: TelegramBot.CallbackQuery,
): Promise<void> {
	const chatId = callbackQuery.message?.chat?.id;
	const threadId = callbackQuery.message?.message_thread_id;

	// Validate chatId
	if (!chatId) {
		return;
	}

	// Parse callback data
	const parsed = parseCallbackData(callbackQuery.data || '');
	if (!parsed) {
		return;
	}

	// Route to specific callback handler
	// Each handler has its own try-catch for error handling
	if ('action' in parsed) {
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
				if (callbackQuery.message?.message_id) {
					try {
						await bot.editMessageReplyMarkup(
							{ inline_keyboard: [] },
							{ chat_id: chatId, message_id: callbackQuery.message.message_id },
						);
					} catch {
						// Ignore "message is not modified" — button was already removed
					}
				}

				// Load and send pack using existing service
				await sendPackMessage(bot, redis, chatId, parsed.packId, threadId);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				console.error('Error loading pack from answer button:', errorMessage);
			}
		}
	} else if ('answerKey' in parsed) {
		await answerCallback(bot, redis, callbackQuery, parsed, threadId);
	} else if ('hintKey' in parsed) {
		await hintCallback(bot, redis, callbackQuery, parsed, threadId);
	}
}
