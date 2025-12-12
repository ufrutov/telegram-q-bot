const BaseQuestionLoader = require("./BaseQuestionLoader");

/**
 * GotQuestionsOnlineLoader - Loads questions from gotquestions.online
 * @extends BaseQuestionLoader
 */
class GotQuestionsOnlineLoader extends BaseQuestionLoader {
	constructor() {
		super();
		const params = new URLSearchParams({
			type: "questions",
			limit: "1",
			fromD: "50",
			toD: "100", // Процент взятия
			fromTrueDL: "0.1",
			toTrueDL: "3.8", // Сложность турнира `TrueDL`
		});
		this.baseUrl = `https://gotquestions.online/api/search/?${params}`;
		this.pages = 300;
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
				imgSrc = "https://gotquestions.online" + imgSrc;
			}
			images.push(imgSrc);
		}
		return images;
	}

	/**
	 * Parse question data from API response
	 * @param {Object} questionData - Raw question object from API
	 * @returns {Object} - Parsed question object
	 */
	parseQuestionData(questionData) {
		const result = {
			question: null,
			answer: null,
			description: null,
			questionPreview: [],
			answerPreview: [],
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

		if (descriptionParts.length > 0) {
			result.description = descriptionParts.join("\n\n");
		}

		// Add answerPic to answer preview if present
		if (questionData.answerPic) {
			const answerImages = this.extractImages(questionData.answerPic);
			result.answerPreview.push(...answerImages);
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
	 * Load a random question from gotquestions.online
	 * @returns {Promise<Object>} - Question object with question, answer, description, questionPreview, and answerPreview fields
	 */
	async loadQuestion() {
		try {
			// Generate random page number between 1 and X (this.pages contains number of available pages)
			const randomPage = Math.floor(Math.random() * this.pages) + 1;
			const url = `${this.baseUrl}&page=${randomPage}`;

			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json();

			// Check if we have questions
			if (!data.questions || data.questions.length === 0) {
				throw new Error("No questions found in response");
			}

			// Select a random question from the 20 items
			const randomIndex = Math.floor(Math.random() * data.questions.length);
			const questionData = data.questions[randomIndex];

			// Parse and return the question
			return this.parseQuestionData(questionData);
		} catch (error) {
			throw new Error(`Failed to load question: ${error.message}`);
		}
	}
}

module.exports = GotQuestionsOnlineLoader;
