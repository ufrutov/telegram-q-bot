/** Telegram entities used in saved messages. Text stays data, never raw HTML. */
export type TelegramToken =
  | { type: "text"; text: string }
  | { type: "bold" | "italic" | "underline" | "strike" | "code"; children: TelegramToken[] }
  | { type: "link"; href: string | null; children: TelegramToken[] };

const escapedCharacter = /[\\_*[\]()~`>#+\-=|{}.!]/;

function closing(text: string, delimiter: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text.startsWith(delimiter, i)) return i;
  }
  return -1;
}
function unescape(text: string): string {
  return text.replace(/\\([\\_*[\]()~`>#+\-=|{}.!])/g, "$1");
}
function safeHref(value: string): string | null {
  try {
    const url = new URL(unescape(value));
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function parseTelegram(text: string, depth = 0): TelegramToken[] {
  if (depth > 12) return [{ type: "text", text: unescape(text) }];
  const tokens: TelegramToken[] = [];
  let plain = "";
  const flush = () => {
    if (plain) {
      tokens.push({ type: "text", text: plain });
      plain = "";
    }
  };
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\\" && text[i + 1] && escapedCharacter.test(text[i + 1])) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (text[i] === "[") {
      const labelEnd = closing(text, "](", i + 1);
      if (labelEnd !== -1) {
        let balance = 1;
        let end = labelEnd + 2;
        for (; end < text.length; end++) {
          if (text[end] === "\\") {
            end++;
            continue;
          }
          if (text[end] === "(") balance++;
          if (text[end] === ")" && --balance === 0) break;
        }
        if (balance === 0) {
          flush();
          tokens.push({
            type: "link",
            href: safeHref(text.slice(labelEnd + 2, end)),
            children: parseTelegram(text.slice(i + 1, labelEnd), depth + 1),
          });
          i = end + 1;
          continue;
        }
      }
    }
    const format = (
      [
        ["__", "underline"],
        ["*", "bold"],
        ["_", "italic"],
        ["~", "strike"],
        ["`", "code"],
      ] as const
    ).find(([delimiter]) => text.startsWith(delimiter, i));
    if (format) {
      const [delimiter, type] = format;
      const end = closing(text, delimiter, i + delimiter.length);
      if (end > i + delimiter.length) {
        flush();
        const inner = text.slice(i + delimiter.length, end);
        tokens.push({
          type,
          children:
            type === "code"
              ? [{ type: "text", text: unescape(inner) }]
              : parseTelegram(inner, depth + 1),
        });
        i = end + delimiter.length;
        continue;
      }
    }
    plain += text[i++];
  }
  flush();
  return tokens;
}
export function telegramPlainText(text: string): string {
  const flatten = (tokens: TelegramToken[]): string =>
    tokens.map((token) => (token.type === "text" ? token.text : flatten(token.children))).join("");
  return flatten(parseTelegram(text));
}
export function hasEmbeddedDescription(answer: string | null, description: string | null): boolean {
  if (!answer || !description) return false;
  const normalize = (text: string) => telegramPlainText(text).replace(/\s+/g, " ").trim();
  const comment = normalize(description);
  return !!comment && normalize(answer).includes(comment);
}
