import { BaseQuestionLoader } from './BaseQuestionLoader';
import { QuestionData, QuestionLoaderOptions } from '@app-types/question';
import { QuestionSource } from './QuestionLoader';
import { Complexity } from '@app-types/question';

/**
 * ChgkInfoQuestionLoader - Loads questions from questions.chgk.info
 */
export class ChgkInfoQuestionLoader extends BaseQuestionLoader {
	private baseUrl: string;

	constructor(_target: QuestionSource = 'questions.chgk.info', _complexity: Complexity = 'random') {
		super();
		this.baseUrl =
			'http://questions.chgk.info/cgi-bin/db.cgi?qnum=1&text=0&type=chgk&type=brain&type=igp&type=game&type=ehruditka&type=beskrylka&Get=Get+random+questions&rand=yes';
	}

	/**
	 * Decode KOI8-R encoded buffer to string
	 */
	private decodeKOI8R(buffer: ArrayBuffer): string {
		const decoder = new TextDecoder('koi8-r');
		return decoder.decode(buffer);
	}

	/**
	 * Extract image URLs from HTML content
	 */
	private extractImages(content: string): string[] {
		const images: string[] = [];
		const imgRegex = /<p><img src="(.*?)">/g;
		let imgMatch;

		while ((imgMatch = imgRegex.exec(content)) !== null) {
			let imgSrc = imgMatch[1];
			if (imgSrc.startsWith('/')) {
				imgSrc = 'http://questions.chgk.info' + imgSrc;
			}
			images.push(imgSrc);
		}

		return images;
	}

	/**
	 * Clean HTML content and remove tags
	 */
	private cleanContent(
		content: string,
		options: { removeImages?: boolean; stopAtP?: boolean } = {},
	): string {
		let cleaned = content;

		// Remove images if specified
		if (options.removeImages) {
			cleaned = cleaned.replace(/<p><img[^>]*><\/p>/g, '');
		}

		// Stop at next <p> tag if specified
		if (options.stopAtP) {
			const pIndex = cleaned.indexOf('p ');
			if (pIndex !== -1) {
				cleaned = cleaned.substring(0, pIndex);
			}
		}

		// Remove HTML tags and decode entities
		cleaned = cleaned
			.replace(/<p\s*\/?>/g, '')
			.replace(/<[^>]*>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&#0150;/g, '-')
			.replace(/&quot;/g, '"')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.trim();

		return cleaned;
	}

	/**
	 * Parse question section from content
	 */
	private parseQuestion(
		content: string,
		result: Partial<QuestionData> & { questionImages: string[] },
	): void {
		const images = this.extractImages(content);
		result.questionImages.push(...images);
		result.question = this.cleanContent(content, { removeImages: true });
	}

	/**
	 * Parse answer section from content
	 */
	private parseAnswer(content: string, result: Partial<QuestionData>): void {
		const cleaned = this.cleanContent(content, { stopAtP: true });
		// Remove any remaining < or > characters that weren't part of HTML tags
		result.answer = cleaned.replace(/[<>]/g, '');
	}

	/**
	 * Parse description/commentary section from content
	 */
	private parseDescription(content: string, result: Partial<QuestionData>): void {
		const cleaned = this.cleanContent(content, { stopAtP: true });
		// Remove any remaining < or > characters that weren't part of HTML tags
		result.description = cleaned.replace(/[<>]/g, '');
	}

	/**
	 * Process matched strong tags and extract question data
	 */
	private processMatches(
		html: string,
		strongMatches: RegExpMatchArray[],
		result: Partial<QuestionData> & { questionImages: string[] },
	): void {
		strongMatches.forEach((match, i) => {
			const strongText = match[1];
			const strongIndex = match.index! + match[0].length;
			const nextIndex = strongMatches[i + 1]?.index ?? html.length;
			const content = html.substring(strongIndex, nextIndex);

			if (strongText.includes('Вопрос 1:')) {
				this.parseQuestion(content, result);
			} else if (strongText.includes('Ответ:')) {
				this.parseAnswer(content, result);
			} else if (strongText.includes('Комментарии:')) {
				this.parseDescription(content, result);
			}
		});
	}

	/**
	 * Clean up empty fields from result
	 */
	private cleanupResult(result: Partial<QuestionData> & { questionImages?: string[] }): void {
		if (result.questionImages && result.questionImages.length === 0) {
			delete result.questionImages;
		}
		if (!result.description) {
			delete result.description;
		}
	}

	/**
	 * Load a random question from questions.chgk.info
	 */
	async loadQuestion(_options?: QuestionLoaderOptions): Promise<QuestionData> {
		const result: Partial<QuestionData> & { questionImages: string[] } = {
			question: '',
			answer: '',
			description: undefined,
			questionImages: [],
			number: 0,
		};

		try {
			const response = await fetch(this.baseUrl);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			// Fetch raw bytes and decode as KOI8-R
			const buffer = await response.arrayBuffer();
			const html = this.decodeKOI8R(buffer);

			// Extract all strong tags
			const strongRegex = /<strong>([\s\S]*?)<\/strong>/g;
			const strongMatches = [...html.matchAll(strongRegex)];

			// Process matches
			this.processMatches(html, strongMatches, result);

			// Cleanup result
			this.cleanupResult(result);

			return result as QuestionData;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			throw new Error(`Failed to load question: ${errorMessage}`);
		}
	}
}
