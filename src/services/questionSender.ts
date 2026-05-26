/**
 * Question Sender Service
 * Shared logic for sending questions to Telegram chats
 * Used by both webhook and cron endpoints
 */

import TelegramBot from 'node-telegram-bot-api';
import { RedisClientType } from 'redis';
import { createQuestionLoader, QuestionSource } from '@lib/QuestionLoader/QuestionLoader';
import { Complexity } from '@app-types/question';
import { REDIS_TTL } from '@app-types/redis';
import { getThreadOptions } from '@utils/redis';
import { MediaGroupItem } from '@app-types/telegram';

/** Default target questions service */
const DEFAULT_SOURCE: QuestionSource =
	(process.env.QUESTION_SOURCE as QuestionSource) || 'gotquestions.online';

interface SendQuestionResult {
	answerKey: string;
	questionMessageId: number;
}

/**
 * Sends a question message to a Telegram chat with answer/hint inline buttons.
 *
 * Delivery strategy:
 *   - If the question has preview images → sends as a media group, then a
 *     separate "Ответ на вопрос" message with inline buttons (reply to media).
 *   - If no images → single text message with inline buttons attached.
 *
 * Redis persistence:
 *   - Stores the answer (with optional answerImages) under `answer:{chatId}:{id}`
 *   - Stores hint context (question, answer, description) under `hint:{chatId}:{id}`
 *   - Both keys expire after 24 hours (REDIS_TTL seconds).
 *
 * Forum topics:
 *   - When `threadId` is provided and the chat is a forum supergroup, all outgoing
 *     messages include `message_thread_id` so they appear inside the correct topic.
 *   - Non-forum chats ignore this field.
 */
export async function sendQuestionMessage(
	bot: TelegramBot,
	redisClient: RedisClientType | null,
	chatId: number | string,
	complexity: Complexity = 'random',
	questionId?: string,
	threadId?: number,
): Promise<SendQuestionResult> {
	const threadOpts = getThreadOptions(threadId);

	// Send loading message
	const loadingMsg = await bot.sendMessage(chatId, '🔄 Загружаю вопрос...', threadOpts);

	// Load question from the question service
	const questionLoader = createQuestionLoader(DEFAULT_SOURCE, complexity);
	const questionData = await questionLoader.loadQuestion({ complexity, questionId });

	// Format question and answer for Telegram (MarkdownV2)
	const { question, answer } = questionLoader.formatForTelegram(questionData, true, complexity);

	console.log(
		`[${chatId}${threadId ? `_${threadId}` : ''}] ${complexity} question: ${questionData.link || questionData.id}`,
	);

	// Delete loading message
	try {
		await bot.deleteMessage(chatId, loadingMsg.message_id);
	} catch (dErr) {
		// ignore if already deleted
	}

	// Generate Redis keys for answer and hint storage
	const answerKey = `answer:${chatId}:${questionData.id || questionData.number}`;
	const hintKey = `hint:${chatId}:${questionData.id || questionData.number}`;

	// If question has preview images, send as media group
	if (questionData.questionImages && questionData.questionImages.length > 0) {
		const media: MediaGroupItem[] = questionData.questionImages.map((url, index) => ({
			type: 'photo',
			media: url,
			// Add caption with question text to the first image
			...(index === 0 && {
				caption: question,
				parse_mode: 'MarkdownV2' as const,
			}),
		}));

		try {
			// Send images as media group
			const messages = await bot.sendMediaGroup(chatId, media, threadOpts as any);
			const questionMessage = messages[0];

			// Send inline buttons as separate message
			const separate = await bot.sendMessage(chatId, 'Ответ на вопрос', {
				...threadOpts,
				reply_to_message_id: questionMessage.message_id,
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '📖 Ответ',
								callback_data: JSON.stringify({ answerKey }),
							},
							{
								text: '✨ Подсказка',
								callback_data: JSON.stringify({ hintKey }),
							},
						],
					],
				},
			});

			// Store answer and hint data in Redis (24h TTL)
			if (redisClient) {
				const answerImages = questionData.answerImages || [];
				await redisClient.setEx(
					answerKey,
					REDIS_TTL,
					JSON.stringify({
						answer,
						answerImages,
						packId: questionData.pack?.id || null,
					}),
				);
				await redisClient.setEx(
					hintKey,
					REDIS_TTL,
					JSON.stringify({
						question: questionData.question,
						answer: questionData.answer,
						description: questionData.description,
						questionMessageId: questionMessage.message_id,
						questionImages: questionData.questionImages || [],
					}),
				);
			}

			return { answerKey, questionMessageId: separate.message_id };
		} catch (imgError) {
			console.error('Error sending question media group:', imgError);
			// Fall through to send without images
		}
	}

	// Send question as regular text message with inline buttons
	const questionMessage = await bot.sendMessage(chatId, question, {
		...threadOpts,
		parse_mode: 'MarkdownV2',
		disable_web_page_preview: true,
		reply_markup: {
			inline_keyboard: [
				[
					{
						text: '📖 Ответ',
						callback_data: JSON.stringify({ answerKey }),
					},
					{
						text: '✨ Подсказка',
						callback_data: JSON.stringify({ hintKey }),
					},
				],
			],
		},
	});

	// Store answer and hint data in Redis (24h TTL)
	if (redisClient) {
		const answerImages = questionData.answerImages || [];
		await redisClient.setEx(
			answerKey,
			REDIS_TTL,
			JSON.stringify({
				answer,
				answerImages,
				packId: questionData.pack?.id || null,
			}),
		);
		await redisClient.setEx(
			hintKey,
			REDIS_TTL,
			JSON.stringify({
				question: questionData.question,
				answer: questionData.answer,
				description: questionData.description,
				questionMessageId: questionMessage.message_id,
			}),
		);
	}

	return { answerKey, questionMessageId: questionMessage.message_id };
}
