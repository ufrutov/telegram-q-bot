/**
 * BaseQuestionLoader - Abstract base class for question loaders
 */

import { escapeMarkdownV2 } from '@utils/markdown';
import { COMPLEXITY_EMOJI } from '@bot/constants';
import {
	QuestionData,
	FormattedQuestion,
	Complexity,
	QuestionLoaderOptions,
} from '@app-types/question';

export abstract class BaseQuestionLoader {
	/**
	 * Format question for Telegram message
	 */
	formatForTelegram(
		questionData: QuestionData,
		split: boolean = false,
		complexity?: Complexity,
	): FormattedQuestion {
		const parts: FormattedQuestion = {
			question: '',
			answer: '',
		};

		// Format question section
		if (questionData.question) {
			const prefix = questionData.link ? `[❓](${questionData.link})` : '❓';
			parts.question = `${prefix} *Вопрос ${questionData.number + 1}*`;

			if (questionData.trueDl && complexity) {
				const complexityEmoji = COMPLEXITY_EMOJI[complexity] || '↗️';
				parts.question += ` • Cложность: *${escapeMarkdownV2(String(questionData.trueDl))}* ${complexityEmoji}`;
			}

			parts.question += `\n${escapeMarkdownV2(questionData.question)}`;
		}

		// Format answer and description
		const answerParts: string[] = [];

		if (questionData.answer) {
			answerParts.push(`✅ *Ответ:*\n${escapeMarkdownV2(questionData.answer)}`);
		}

		if (questionData.description) {
			answerParts.push(`💬 *Комментарий:*\n${escapeMarkdownV2(questionData.description)}`);
		}

		const answerText = answerParts.join('\n\n');

		// Combine or split based on split parameter
		if (split) {
			parts.answer = answerText;
		} else {
			if (parts.question && answerText) {
				parts.question += '\n\n' + answerText;
			} else if (answerText) {
				parts.question = answerText;
			}
		}

		return {
			question: parts.question.trim(),
			answer: parts.answer.trim(),
		};
	}

	/**
	 * Load a question - must be implemented by subclasses
	 */
	abstract loadQuestion(options?: QuestionLoaderOptions): Promise<QuestionData>;
}
