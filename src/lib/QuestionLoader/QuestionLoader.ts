/**
 * QuestionLoader Factory
 */

import { BaseQuestionLoader } from './BaseQuestionLoader';
import { GotQuestionsOnlineLoader } from './GotQuestionsOnlineLoader';
import { ChgkInfoQuestionLoader } from './ChgkInfoQuestionLoader';
import { Complexity } from '@app-types/question';

export type QuestionSource = 'gotquestions.online' | 'questions.chgk.info';

/**
 * Factory function to create appropriate question loader
 */
export function createQuestionLoader(
	source: QuestionSource = 'gotquestions.online',
	complexity: Complexity = 'random',
): BaseQuestionLoader {
	const loaderMap: Record<
		QuestionSource,
		new (source: QuestionSource, complexity: Complexity) => BaseQuestionLoader
	> = {
		'gotquestions.online': GotQuestionsOnlineLoader,
		'questions.chgk.info': ChgkInfoQuestionLoader,
	};

	const LoaderClass = loaderMap[source];

	if (!LoaderClass) {
		throw new Error(
			`Unknown target: ${source}. Available targets: ${Object.keys(loaderMap).join(', ')}`,
		);
	}

	return new LoaderClass(source, complexity);
}
