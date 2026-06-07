/**
 * Markdown utilities for Telegram MarkdownV2 formatting
 */

/**
 * Escape special MarkdownV2 characters while preserving Markdown link and
 * bold entity syntax.
 *
 * Telegram's MarkdownV2 parser treats a defined set of characters as reserved.
 * Plain user-provided text must have those characters escaped with a leading
 * backslash, but `[text](url)` constructs and `*bold*` entities must be left
 * intact. Inside `*...*` the content must also be properly escaped (e.g. `\.`
 * for a literal dot) so the resulting entity is still parseable; this function
 * does not validate that — callers are expected to escape the inner content
 * themselves when building the bold payload.
 *
 * The strategy is: temporarily swap every link and every balanced `*...*`
 * pair out for a placeholder, escape the remaining reserved characters, then
 * restore the originals. Bold is matched first so we never interpret the
 * `*` inside an already-swapped link as a bold delimiter.
 *
 * Blockquote markers (`>` at line start) are preserved as-is even after the
 * pass that escapes `>` everywhere else.
 *
 * @param text - Text to escape. Falsy input returns an empty string.
 * @returns MarkdownV2-safe text
 */
export function escapeMarkdownV2(text: string | null | undefined): string {
  if (!text) return "";

  // Preserve Markdown links [text](url) and *bold* entities while escaping
  // other special chars. Links are swapped first so the bold regex below
  // never matches a `*` that belongs to a link's URL parentheses.
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  // Match a non-greedy bold span that does not contain `*` or newline.
  // The content can still contain escaped chars like `\.`; those are not `*`,
  // so they are matched as part of the span.
  const boldRegex = /\*([^*\n]+)\*/g;
  const placeholders: string[] = [];
  let replaced = text.replace(linkRegex, (match) => {
    const idx = placeholders.push(match) - 1;
    return `\u0000MDLINK${idx}\u0000`;
  });

  replaced = replaced.replace(boldRegex, (match) => {
    const idx = placeholders.push(match) - 1;
    return `\u0000MDBOLD${idx}\u0000`;
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

  // Restore original links and bold entities. The placeholder tokens contain
  // only ASCII letters and digits, so they survive the escape pass untouched
  // and can be expanded back to the original link/bold substrings.
  // oxlint-disable-next-line no-control-regex
  replaced = replaced.replace(/\u0000(MDLINK|MDBOLD)(\d+)\u0000/g, (_, _kind, n) => {
    const idx = Number(n);
    return placeholders[idx] ?? "";
  });

  return replaced;
}
