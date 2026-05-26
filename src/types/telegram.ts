import TelegramBot from 'node-telegram-bot-api';

/**
 * Telegram-specific types
 */

export interface ThreadOptions {
	message_thread_id?: number;
}

export interface QuestionCallbackData {
	action: 'question';
	complexity: string;
}

export interface AnswerCallbackData {
	action: 'answer';
	chatId: number;
	messageId: number;
	threadId?: number;
}

export interface HintCallbackData {
	action: 'hint';
	chatId: number;
	messageId: number;
}

export interface PackQuestionCallbackData {
	action: 'pack_question';
	packId: string;
	index: number;
}

export type CallbackData =
	| QuestionCallbackData
	| AnswerCallbackData
	| HintCallbackData
	| PackQuestionCallbackData;

export interface StoredAnswer {
	answer: string;
	packId?: string;
	packName?: string;
	packUrl?: string;
	questionIndex?: number;
	totalQuestions?: number;
	answerImages?: string[];
	commentImages?: string[];
}

export interface StoredHint {
	hint: string;
}

export interface MediaGroupItem extends TelegramBot.InputMediaPhoto {
	type: 'photo';
	media: string;
}
