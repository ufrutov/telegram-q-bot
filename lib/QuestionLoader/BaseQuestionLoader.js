/**
 * BaseQuestionLoader - Abstract base class for question loaders
 */
class BaseQuestionLoader {
	/**
	 * Escape special characters for MarkdownV2
	 * @param {string} text - Text to escape
	 * @returns {string} - Escaped text
	 */
	escapeMarkdownV2(text) {
		if (!text) return text;
		// Characters that need to be escaped in MarkdownV2
		const specialChars = [
			"_",
			// "*", // Bold text
			"[",
			"]",
			"(",
			")",
			"~",
			"`",
			">",
			"#",
			"+",
			"-",
			"=",
			"|",
			"{",
			"}",
			".",
			"!",
		];
		let escaped = text;

		for (const char of specialChars) {
			escaped = escaped.replaceAll(char, "\\" + char);
		}

		return escaped;
	}

	/**
	 * Format question for Telegram message
	 * @param {Object} questionData - Question data object
	 * @param {string} questionData.question - The question text
	 * @param {string} [questionData.answer] - The answer text
	 * @param {string} [questionData.description] - The description/commentary text
	 * @param {string[]} [questionData.preview] - Array of image URLs
	 * @param {boolean} [split=false] - If true, returns question and answer/description separately
	 * @returns {{question: string, answer: string}} - Object with formatted question and answer texts
	 */
	formatForTelegram(questionData, split = false, spoiler = true) {
		const parts = {
			question: "",
			answer: "",
		};

		// Format question section
		if (questionData.question) {
			parts.question = `❓ *Вопрос:*\n${this.escapeMarkdownV2(questionData.question)}`;
		}

		// Format answer and description
		const answerParts = [];
		const s = `${spoiler ? "||" : ""}`;

		if (questionData.answer) {
			answerParts.push(`✅ *Ответ:*\n${s}${this.escapeMarkdownV2(questionData.answer)}${s}`);
		}

		if (questionData.description) {
			answerParts.push(
				`💬 *Комментарий:*\n${s}${this.escapeMarkdownV2(questionData.description)}${s}`
			);
		}

		const answerText = answerParts.join("\n\n");

		// Combine or split based on split parameter
		if (split) {
			parts.answer = answerText;
		} else {
			if (parts.question && answerText) {
				parts.question += "\n\n" + answerText;
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
	 * Load a random question - must be implemented by subclasses
	 * @returns {Promise<Object>} - Question object with question, answer, description, and preview fields
	 */
	async loadQuestion() {
		throw new Error("loadQuestion() must be implemented by subclass");
	}
}

module.exports = BaseQuestionLoader;
