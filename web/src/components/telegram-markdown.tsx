import type { ReactNode } from "react";
import { parseTelegram, type TelegramToken } from "../lib/telegram-markdown";

function render(tokens: TelegramToken[]): ReactNode {
  return tokens.map((token, key) => {
    if (token.type === "text") return token.text;
    const children = render(token.children);
    switch (token.type) {
      case "bold":
        return <strong key={key}>{children}</strong>;
      case "italic":
        return <em key={key}>{children}</em>;
      case "underline":
        return <u key={key}>{children}</u>;
      case "strike":
        return <s key={key}>{children}</s>;
      case "code":
        return <code key={key}>{children}</code>;
      case "link":
        return token.href ? (
          <a key={key} href={token.href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ) : (
          <span key={key}>{children}</span>
        );
    }
  });
}
export function TelegramMarkdown({ text }: { text: string }) {
  return (
    <div className="telegram-markdown">
      {text.split(/\n[ \t]*\n/).map((paragraph, key) => (
        <p key={key}>{render(parseTelegram(paragraph))}</p>
      ))}
    </div>
  );
}
