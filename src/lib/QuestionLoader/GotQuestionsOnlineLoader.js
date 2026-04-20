const BaseQuestionLoader = require("./BaseQuestionLoader");
const { formatDate } = require("../../utils/date");
const { escapeMarkdownV2 } = require("../../utils/markdown");

/**
 * TrueDL complexity ranges mapping
 * Based on https://pecheny.me/blog/truedl/
 */
const COMPLEXITY_RANGES = {
	random: { min: 0.1, max: 4.5, pages: 500 }, // Random easy questions
	easy: { min: 0.1, max: 3.5, pages: 500 }, // School/beginner tournaments
	medium: { min: 3.5, max: 6.5, pages: 500 }, // Standard tournaments
	hard: { min: 6.5, max: 10, pages: 200 }, // Expert level
};

/**
 * GotQuestionsOnlineLoader - Loads questions from gotquestions.online
 * @extends BaseQuestionLoader
 */
class GotQuestionsOnlineLoader extends BaseQuestionLoader {
	constructor(target = "gotquestions.online", complexity = "random") {
		super();
		const range = COMPLEXITY_RANGES[complexity] || COMPLEXITY_RANGES.medium;
		const params = new URLSearchParams({
			type: "questions",
			limit: "1",
			fromD: "50",
			toD: "100", // Процент взятия
			fromTrueDL: range.min.toString(),
			toTrueDL: range.max.toString(), // Сложность турнира `TrueDL`
		});
		this.baseUrl = `https://${target}`;
		this.apiUrl = `${this.baseUrl}/api/search/?${params}`;
		this.pages = range.pages;
		this.complexity = complexity;
	}

	/**
	 * Extract image URLs from razdatka fields
	 * @param {string} razdatkaPic - URL of razdatka picture
	 * @returns {string[]} - Array of image URLs
	 */
	extractImages(razdatkaPic) {
		const images = [];
		if (razdatkaPic) {
			// Ensure full URL
			let imgSrc = razdatkaPic;
			if (imgSrc.startsWith("/")) {
				imgSrc = this.baseUrl + imgSrc;
			}
			images.push(imgSrc);
		}
		return images;
	}

	/**
	 * Load Questions Pack data from API
	 * @param {number|string} packId - Pack ID to load
	 * @returns {Promise<Object|null>} - Pack data object with id, pubDate, title, and trueDl fields, or null if not found
	 */
	async loadPackData(packId) {
		if (!packId) {
			return null;
		}

		try {
			const url = `${this.baseUrl}/api/pack/${packId}/`;
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const packData = await response.json();

			// Return only the required fields
			return {
				id: packData.id,
				pubDate: packData.pubDate,
				title: packData.title,
				trueDl: packData.trueDl,
			};
		} catch (error) {
			console.warn(`Failed to load pack ${packId}: ${error.message}`);
			return null;
		}
	}

	/**
	 * Parse question data from API response
	 * @param {Object} questionData - Raw question object from API
	 * @param {string} questionLink - Link to the question
	 * @param {Object} [packData] - Optional pack data object
	 * @returns {Object} - Parsed question object
	 */
	parseQuestionData(questionData, questionLink, packData = null) {
		const result = {
			id: questionData.id,
			question: null,
			answer: null,
			description: null,
			questionPreview: [],
			answerPreview: [],
			link: questionLink,
		};

		// Parse question text and preview
		if (questionData.text) {
			result.question = questionData.text.trim();
		}

		// Add razdatka text if present
		if (questionData.razdatkaText) {
			const razdatkaText = questionData.razdatkaText.trim();
			if (razdatkaText) {
				result.question = result.question
					? `${result.question}\n\n📎 ${razdatkaText}`
					: razdatkaText;
			}
		}

		// Extract preview images from razdatkaPic (question images)
		if (questionData.razdatkaPic) {
			const images = this.extractImages(questionData.razdatkaPic);
			result.questionPreview.push(...images);
		}

		// Parse answer
		if (questionData.answer) {
			result.answer = questionData.answer.trim();
		}

		// Add zachet (accepted answer) to description
		const descriptionParts = [];

		if (questionData.zachet) {
			const zachet = questionData.zachet.trim();
			if (zachet) {
				descriptionParts.push(`Зачёт: ${zachet}`);
			}
		}

		// Add comment to description
		if (questionData.comment) {
			const comment = questionData.comment.trim();
			if (comment) {
				descriptionParts.push(comment);
			}
		}

		// Add complexity percent to description
		if (questionData.complexity && questionData.complexity.length > 0) {
			let complexityText = `[↗️](${this.baseUrl}/question/${questionData.id})`;

			// Add pack complexity if available
			if (Array.isArray(packData?.trueDl) && packData.trueDl.length > 0) {
				const packComplexity = (
					packData.trueDl.reduce((a, b) => a + b) / packData.trueDl.length
				).toFixed(1);
				complexityText += ` Cложность *${packComplexity}* (${this.complexity})`;
			}

			const questionComplexity = (
				questionData.complexity.reduce((a, b) => a + b) / questionData.complexity.length
			).toFixed(1);

			complexityText += `, *${questionComplexity}%* верных ответов`;

			// Add pack info if available
			if (packData?.title) {
				const escapedTitle = escapeMarkdownV2(packData.title);
				complexityText += `\n[*${escapedTitle}*](${this.baseUrl}/pack/${packData.id}/) • ${formatDate(packData.pubDate)}`;
			}

			descriptionParts.push(complexityText);
		}

		if (descriptionParts.length > 0) {
			result.description = descriptionParts.join("\n\n");
		}

		// Add answerPic to answer preview if present
		if (questionData.answerPic) {
			const answerImages = this.extractImages(questionData.answerPic);
			result.answerPreview.push(...answerImages);
		}

		// Add commentPic to answer preview if present
		if (questionData.commentPic) {
			const commentImages = this.extractImages(questionData.commentPic);
			result.answerPreview.push(...commentImages);
		}

		// Clean up empty fields
		if (result.questionPreview.length === 0) {
			delete result.questionPreview;
		}
		if (result.answerPreview.length === 0) {
			delete result.answerPreview;
		}
		if (!result.description) {
			delete result.description;
		}

		return result;
	}

	/**
	 * Load a question from gotquestions.online
	 * If `questionId` is provided, loads that specific question directly.
	 * Otherwise loads a random question from the search API.
	 * @param {number|string} [questionId] - Optional question id to load directly
	 * @returns {Promise<Object>} - Question object with question, answer, description, questionPreview, and answerPreview fields
	 */
	async loadQuestion(questionId = undefined) {
		const maxAttempts = 3;
		let lastError = null;

		// If a specific question id is provided, fetch it directly and return
		if (questionId != null) {
			try {
				const url = `${this.baseUrl}/api/question/${questionId}/`;
				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}
				const questionData = await response.json();
				const questionLink = `${this.baseUrl}/question/${questionData.id}`;

				// Load pack data if packId is available
				let packData = null;
				if (questionData.packId) {
					packData = await this.loadPackData(questionData.packId);
				}

				return this.parseQuestionData(questionData, questionLink, packData);
			} catch (error) {
				throw new Error(`Failed to load question ${questionId}: ${error.message}`);
			}
		}

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				// Generate random page number between 1 and X (this.pages contains number of available pages)
				const randomPage = Math.floor(Math.random() * this.pages) + 1;
				const url = `${this.apiUrl}&page=${randomPage}`;

				const response = await fetch(url);

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data = await response.json();

				// Check if we have questions
				if (!data.questions || data.questions.length === 0) {
					throw new Error("No questions found in response");
				}

				// Select a random question from the returned items
				const randomIndex = Math.floor(Math.random() * data.questions.length);
				const questionData = data.questions[randomIndex];
				const questionLink = `${this.baseUrl}/question/${questionData.id}`;

				// Load pack data if packId is available
				let packData = null;
				if (questionData.packId) {
					packData = await this.loadPackData(questionData.packId);
				}

				// Parse and return the question
				return this.parseQuestionData(questionData, questionLink, packData);
			} catch (error) {
				lastError = error;
				if (attempt < maxAttempts) {
					console.warn(`Attempt ${attempt} failed: ${error.message}. Retrying...`);
					continue;
				}
				throw new Error(`Failed to load question after ${maxAttempts} attempts: ${error.message}`);
			}
		}
	}
}

module.exports = GotQuestionsOnlineLoader;
