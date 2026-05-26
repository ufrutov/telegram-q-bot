/**
 * Answer Callback Handler - Show answer button
 */
import TelegramBot from 'node-telegram-bot-api';
import { RedisClientType } from 'redis';
import { TARGET_DOMAIN, MESSAGES } from '@bot/constants';
import { getThreadOptions } from '@utils/redis';

interface AnswerCallbackData {
	answerKey: string;
}

interface StoredAnswerData {
	answer: string;
	answerPreview?: string[];
	questionMessageId?: number;
	packId?: string | null;
}

/**
 * Handle answer button callbacks
 */
export async function answerCallback(
	bot: TelegramBot,
	redis: RedisClientType | null,
	callbackQuery: TelegramBot.CallbackQuery,
	parsed: AnswerCallbackData,
	threadId?: number,
): Promise<void> {
	const chatId = callbackQuery.message?.chat?.id;
	const answerKey = parsed.answerKey;

	if (!chatId || !answerKey) {
		return;
	}

	const threadOpts = getThreadOptions(threadId);

	try {
		// Acknowledge callback first to remove button loading state
		await bot.answerCallbackQuery(callbackQuery.id);

		// Get answer from Redis
		const answerDataStr = redis ? await redis.get(answerKey) : null;

		const questionId = answerKey.split(':').at(2);
		const logChat = threadId ? `${chatId}_${threadId}` : chatId;
		console.log(`[${logChat}] answer: https://${TARGET_DOMAIN}/question/${questionId}`);

		// Handle expired answer
		if (!answerDataStr) {
			await bot.sendMessage(chatId, MESSAGES.ANSWER_EXPIRED, {
				...threadOpts,
				parse_mode: 'MarkdownV2',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: `❓ Вопрос ${questionId}`,
								url: `https://${TARGET_DOMAIN}/question/${questionId}`,
							},
						],
					],
				},
			});
			return;
		}

		const answerData: StoredAnswerData = JSON.parse(answerDataStr);
		const { answer, answerPreview, questionMessageId, packId } = answerData;

		// Determine which message to reply to
		const messageToReply = questionMessageId ?? callbackQuery.message?.message_id;

		// Send answer with images or text
		if (answerPreview && answerPreview.length > 0) {
			const media: TelegramBot.InputMediaPhoto[] = answerPreview.map((url, index) => ({
				type: 'photo',
				media: url,
				...(index === 0 && {
					caption: answer,
					parse_mode: 'MarkdownV2' as const,
				}),
			}));

			try {
				await bot.sendMediaGroup(chatId, media, {
					...threadOpts,
					...(messageToReply && { reply_to_message_id: messageToReply }),
				});
			} catch (imgError) {
				const errorMessage = imgError instanceof Error ? imgError.message : 'Unknown error';
				console.error('Error sending answer media group:', errorMessage);
				await bot.sendMessage(chatId, answer, {
					...threadOpts,
					parse_mode: 'MarkdownV2',
					...(messageToReply && { reply_to_message_id: messageToReply }),
					disable_web_page_preview: true,
				});
			}
		} else {
			// Build inline keyboard with pack button if packId exists
			const replyMarkup = packId
				? {
						inline_keyboard: [
							[
								{
									text: '📦 Играть весь пакет',
									callback_data: JSON.stringify({ action: 'pack', packId }),
								},
							],
						],
					}
				: undefined;

			await bot.sendMessage(chatId, answer, {
				...threadOpts,
				parse_mode: 'MarkdownV2',
				...(messageToReply && { reply_to_message_id: messageToReply }),
				disable_web_page_preview: true,
				reply_markup: replyMarkup,
			});
		}

		// Remove inline buttons from question message
		if (callbackQuery.message?.message_id) {
			try {
				await bot.editMessageReplyMarkup(
					{ inline_keyboard: [] },
					{ chat_id: chatId, message_id: callbackQuery.message.message_id },
				);
			} catch (editError) {
				const errorMessage = editError instanceof Error ? editError.message : 'Unknown error';
				console.error('Error removing reply markup:', errorMessage);
			}
		}

		// Delete separate button message if question had images
		if (questionMessageId && callbackQuery.message?.message_id) {
			try {
				await bot.deleteMessage(chatId, callbackQuery.message.message_id);
			} catch (deleteError) {
				const errorMessage = deleteError instanceof Error ? deleteError.message : 'Unknown error';
				console.error(
					'Error deleting separated message after question with media group:',
					errorMessage,
				);
			}
		}

		// Delete answer data from Redis (one-time use)
		if (redis) {
			await redis.del(answerKey);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('Error handling callback query (answer):', errorMessage);
		await bot.answerCallbackQuery(callbackQuery.id, {
			text: MESSAGES.ERROR_LOADING_ANSWER,
			show_alert: true,
		});
	}
}
