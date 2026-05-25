/**
 * Markdown utilities for Telegram MarkdownV2 formatting
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

	// Characters that need to be escaped in MarkdownV2
	const specialChars = [
		"_",
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

	for (const char of specialChars) {
		replaced = replaced.split(char).join("\\" + char);
	}

	// Restore original links
	replaced = replaced.replace(/\u0000MDLINK(\d+)\u0000/g, (_, n) => placeholders[Number(n)]);

	return replaced;
}

module.exports = { escapeMarkdownV2 };