/**
 * Date utilities for formatting
 */

const MONTHS_RU = [
	"января",
	"февраля",
	"марта",
	"апреля",
	"мая",
	"июня",
	"июля",
	"августа",
	"сентября",
	"октября",
	"ноября",
	"декабря",
];

/**
 * Format date string to Russian format
 * @param {string} dateString - Date string in ISO format (e.g., "2025-06-15T20:15:33.384604" or "2025-06-15T14:00:00")
 * @returns {string} - Formatted date (e.g., "15 июня 2025")
 */
function formatDate(dateString) {
	if (!dateString) {
		return "";
	}

	try {
		const normalizedDateString = String(dateString)
			.trim()
			.replace(" ", "T")
			.replace(/\.(\d{1,6})/, (_, fractional) => `.${fractional.slice(0, 3).padEnd(3, "0")}`);

		const dateWithTimezone = /T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(
			normalizedDateString
		)
			? normalizedDateString
			: `${normalizedDateString}Z`;
		const date = new Date(dateWithTimezone);

		if (isNaN(date.getTime())) {
			return "";
		}

		const day = date.getDate();
		const month = MONTHS_RU[date.getMonth()];
		const year = date.getFullYear();

		return `${day} ${month} ${year}`;
	} catch (error) {
		console.warn(`Failed to format date ${dateString}: ${error.message}`);
		return "";
	}
}

module.exports = { formatDate };
