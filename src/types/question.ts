/**
 * Core question data types
 */

export interface QuestionData {
	id?: string;
	packId?: string;
	question: string;
	answer: string;
	description?: string;
	preview?: string[];
	link?: string;
	number: number;
	trueDl?: number;
	pack?: PackInfo;
	questionImages?: string[];
	answerImages?: string[];
	commentImages?: string[];
}

export interface PackInfo {
	id: string;
	name: string;
	url?: string;
}

export interface FormattedQuestion {
	question: string;
	answer: string;
}

export type Complexity = 'random' | 'easy' | 'medium' | 'hard';

export interface ComplexityRange {
	min: number;
	max: number;
	pages: number;
}

export interface QuestionLoaderOptions {
	complexity?: Complexity;
	questionId?: string;
}
