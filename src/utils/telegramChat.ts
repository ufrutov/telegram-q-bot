/**
 * Telegram Chat Title Extraction
 *
 * Resolves a display title for any chat kind from the fields Telegram
 * includes in update payloads — no extra API calls required.
 *
 * Priority:
 *   1. chat.title            — groups, supergroups, forum-topic chats
 *   2. first_name + last_name — private chats
 *   3. username              — fallback when no names are set
 *
 * Forum topic names are NOT obtainable from Bot API payloads; callers
 * distinguish topics by thread_id instead.
 */

export interface TelegramChatInfo {
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function resolveChatTitle(chat: TelegramChatInfo | undefined): string | undefined {
  if (!chat) return undefined;

  const groupTitle = chat.title?.trim();
  if (groupTitle) return groupTitle;

  const personName = [chat.first_name, chat.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  if (personName) return personName;

  const username = chat.username?.trim();
  return username || undefined;
}
