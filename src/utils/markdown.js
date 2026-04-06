/**
 * Escape special characters for MarkdownV2
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeMarkdownV2(text) {
	if (!text) return text;
	// Preserve Markdown links [text](url) while escaping other special chars.
	// Replace links with placeholders so their punctuation won't be escaped,
	// then escape the rest and restore originals.
	const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
	const placeholders = [];
	let replaced = text.replace(linkRegex, (match) => {
		const idx = placeholders.push(match) - 1;
		return `\u0000MDLINK${idx}\u0000`;
	});

	// Characters that need to be escaped in MarkdownV2 (keep '*' unescaped for bold formatting)
	// Note: We keep '_' unescaped to preserve italic styling in user-generated content
	const specialChars = /([`\[\]()#+\-.!|\\})({])/g;
	replaced = replaced.replace(specialChars, "\\$1");

	// Restore Markdown links
	placeholders.forEach((link, idx) => {
		replaced = replaced.replace(`\u0000MDLINK${idx}\u0000`, link);
	});

	return replaced;
}

module.exports = { escapeMarkdownV2 };