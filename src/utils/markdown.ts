/**
 * Markdown utilities for Telegram MarkdownV2 formatting
 */

/**
 * Escape special MarkdownV2 characters while preserving Markdown link syntax.
 *
 * Telegram's MarkdownV2 parser treats a defined set of characters as reserved.
 * Plain user-provided text must have those characters escaped with a leading
 * backslash, but `[text](url)` constructs must be left intact.
 *
 * The strategy is: temporarily swap every `[text](url)` out for a placeholder,
 * escape the remaining reserved characters, then restore the original links.
 *
 * Blockquote markers (`>` at line start) are preserved as-is even after the
 * pass that escapes `>` everywhere else.
 *
 * @param text - Text to escape. Falsy input returns an empty string.
 * @returns MarkdownV2-safe text
 */
export function escapeMarkdownV2(text: string | null | undefined): string {
  if (!text) return "";

  // Preserve Markdown links [text](url) while escaping other special chars.
  // Replace links with placeholders so their punctuation won't be escaped,
  // then escape the rest and restore originals.
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const placeholders: string[] = [];
  let replaced = text.replace(linkRegex, (match) => {
    const idx = placeholders.push(match) - 1;
    return `\u0000MDLINK${idx}\u0000`;
  });

  // Characters that need to be escaped in MarkdownV2
  const specialChars = [
    "_",
    "*",
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

  // Preserve MarkdownV2 blockquote markers at line start.
  // All other '>' remain escaped as literal characters.
  replaced = replaced.replace(/(^|\n)\\>(?=\s|$)/g, "$1>");

  // Restore original links
  // oxlint-disable-next-line no-control-regex
  replaced = replaced.replace(/\u0000MDLINK(\d+)\u0000/g, (_, n) => {
    const idx = Number(n);
    return placeholders[idx] ?? "";
  });

  return replaced;
}
