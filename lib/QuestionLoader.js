/**
 * QuestionLoader - Helper class to fetch and parse questions from chgk.info
 */
class QuestionLoader {
	constructor() {
		this.baseUrl =
			"http://questions.chgk.info/cgi-bin/db.cgi?qnum=1&text=0&type=chgk&type=brain&type=igp&type=game&type=ehruditka&type=beskrylka&Get=Get+random+questions&rand=yes";
	}

	/**
	 * Decode KOI8-R encoded buffer to string
	 * @param {ArrayBuffer} buffer - The raw buffer to decode
	 * @returns {string} - Decoded string
	 */
	decodeKOI8R(buffer) {
		const decoder = new TextDecoder("koi8-r");
		return decoder.decode(buffer);
	}

	/**
	 * Extract image URLs from HTML content
	 * @param {string} content - HTML content to parse
	 * @returns {string[]} - Array of image URLs
	 */
	extractImages(content) {
		const images = [];
		const imgRegex = /<p><img src="(.*?)">/g;
		let imgMatch;

		while ((imgMatch = imgRegex.exec(content)) !== null) {
			let imgSrc = imgMatch[1];
			if (imgSrc.startsWith("/")) {
				imgSrc = "http://questions.chgk.info" + imgSrc;
			}
			images.push(imgSrc);
		}

		return images;
	}

	/**
	 * Clean HTML content and remove tags
	 * @param {string} content - HTML content to clean
	 * @param {Object} options - Cleaning options
	 * @returns {string} - Cleaned text
	 */
	cleanContent(content, options = {}) {
		let cleaned = content;

		// Remove images if specified
		if (options.removeImages) {
			cleaned = cleaned.replace(/<p><img[^>]*><\/p>/g, "");
		}

		// Stop at next <p> tag if specified
		if (options.stopAtP) {
			const pIndex = cleaned.indexOf("p ");
			if (pIndex !== -1) {
				cleaned = cleaned.substring(0, pIndex);
			}
		}

		// Remove HTML tags and decode entities
		cleaned = cleaned
			.replace(/<p\s*\/?>/g, "")
			.replace(/<br\s*\/?>/g, "")
			.replace(/<[^>]*>/g, "")
			.replace(/&nbsp;/g, " ")
			.replace(/&#0150;/g, "-")
			.replace(/&quot;/g, '"')
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/\n/g, " ")
			.replace(/\r/g, "")
			.trim();

		return cleaned;
	}

	/**
	 * Parse question section from content
	 * @param {string} content - HTML content
	 * @param {Object} result - Result object to populate
	 */
	parseQuestion(content, result) {
		const images = this.extractImages(content);
		result.preview.push(...images);
		result.question = this.cleanContent(content, { removeImages: true });
	}

	/**
	 * Parse answer section from content
	 * @param {string} content - HTML content
	 * @param {Object} result - Result object to populate
	 */
	parseAnswer(content, result) {
		result.answer = this.cleanContent(content, { stopAtP: true });
	}

	/**
	 * Parse description/commentary section from content
	 * @param {string} content - HTML content
	 * @param {Object} result - Result object to populate
	 */
	parseDescription(content, result) {
		result.description = this.cleanContent(content, { stopAtP: true });
	}

	/**
	 * Process matched strong tags and extract question data
	 * @param {string} html - Full HTML content
	 * @param {Array} strongMatches - Array of regex matches
	 * @param {Object} result - Result object to populate
	 */
	processMatches(html, strongMatches, result) {
		strongMatches.forEach((match, i) => {
			const strongText = match[1];
			const strongIndex = match.index + match[0].length;
			const nextIndex = strongMatches[i + 1]?.index ?? html.length;
			const content = html.substring(strongIndex, nextIndex);

			if (strongText.includes("Вопрос 1:")) {
				this.parseQuestion(content, result);
			} else if (strongText.includes("Ответ:")) {
				this.parseAnswer(content, result);
			} else if (strongText.includes("Комментарии:")) {
				this.parseDescription(content, result);
			}
		});
	}

	/**
	 * Clean up empty fields from result
	 * @param {Object} result - Result object to clean
	 */
	cleanupResult(result) {
		if (result.preview.length === 0) {
			delete result.preview;
		}
		if (!result.description) {
			delete result.description;
		}
	}

	/**
	 * Load a random question from chgk.info
	 * @returns {Promise<Object>} - Question object with question, answer, description, and preview fields
	 */
	async loadQuestion() {
		const result = {
			question: null,
			answer: null,
			description: null,
			preview: [],
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

			return result;
		} catch (error) {
			throw new Error(`Failed to load question: ${error.message}`);
		}
	}

	/**
	 * Format question for Telegram message
	 * @param {Object} questionData - Question data object
	 * @returns {string} - Formatted message text
	 */
	formatForTelegram(questionData) {
		let message = "";

		if (questionData.question) {
			message += `❓ *Вопрос:*\n${questionData.question}\n\n`;
		}

		if (questionData.answer) {
			message += `✅ *Ответ:*\n||${questionData.answer}||\n\n`;
		}

		if (questionData.description) {
			message += `💬 *Комментарий:*\n||${questionData.description}||`;
		}

		return message.trim();
	}
}

module.exports = QuestionLoader;
