/**
 * Chat Store - upserts and looks up tq-bot-chats rows.
 *
 * - getOrCreateChat: write path. Inserts the row if missing and returns the
 *   full ChatRow. Used by questionSendStore / loadFailureStore / cronConfig
 *   where we know the chat has interacted with the bot.
 * - getChat: read-only path. Returns null if the chat is not registered.
 *   Used by stats and any future read-only command that must NOT pollute the
 *   chats table.
 *
 * Per-invocation cache: rows survive as long as the module instance does,
 * which on Vercel means across many invocations within the same warm
 * function. Cold starts wipe it, which is fine — the next call is one
 * round-trip to Postgres.
 *
 * All errors are logged and swallowed. The bot never crashes because the DB
 * is missing.
 */

import { TABLES, getSupabaseClient } from "./supabase.js";

export interface ChatRow {
  id: string;
  chat_id: number;
  thread_id: number | null;
  title: string | null;
  timezone: string;
  is_active: boolean;
}

const cache = new Map<string, ChatRow>();

function cacheKey(chatId: number | string, threadId: number | undefined): string {
  const chatPart = String(chatId);
  const threadPart = threadId == null ? "" : String(threadId);
  return `${chatPart}:${threadPart}`;
}

export async function getOrCreateChat(
  chatId: number | string,
  threadId: number | undefined,
): Promise<ChatRow | null> {
  const numericChatId = typeof chatId === "string" ? Number(chatId) : chatId;
  if (!Number.isFinite(numericChatId)) {
    return null;
  }

  const key = cacheKey(chatId, threadId);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  try {
    const row = {
      chat_id: numericChatId,
      thread_id: threadId ?? null,
    };

    const { data, error } = await supabase
      .from(TABLES.chats)
      .upsert(row, { onConflict: "chat_id,thread_id", ignoreDuplicates: false })
      .select("id, chat_id, thread_id, title, timezone, is_active")
      .single();

    if (error) {
      console.warn("[supabase] getOrCreateChat upsert failed:", error.message);
      return null;
    }

    if (!data) {
      return null;
    }

    const out: ChatRow = {
      id: data.id,
      chat_id: data.chat_id,
      thread_id: data.thread_id,
      title: data.title,
      timezone: data.timezone,
      is_active: data.is_active,
    };
    cache.set(key, out);
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[supabase] getOrCreateChat unexpected error:", message);
    return null;
  }
}

/**
 * Read-only lookup. Returns null if the chat is not registered or if
 * the call fails. Never inserts.
 */
export async function getChat(
  chatId: number | string,
  threadId: number | undefined,
): Promise<ChatRow | null> {
  const numericChatId = typeof chatId === "string" ? Number(chatId) : chatId;
  if (!Number.isFinite(numericChatId)) {
    return null;
  }

  const key = cacheKey(chatId, threadId);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(TABLES.chats)
      .select("id, chat_id, thread_id, title, timezone, is_active")
      .eq("chat_id", numericChatId)
      .eq("thread_id", threadId ?? null)
      .maybeSingle();

    if (error) {
      console.warn("[supabase] getChat select failed:", error.message);
      return null;
    }
    if (!data) {
      return null;
    }

    const out: ChatRow = {
      id: data.id,
      chat_id: data.chat_id,
      thread_id: data.thread_id,
      title: data.title,
      timezone: data.timezone,
      is_active: data.is_active,
    };
    cache.set(key, out);
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[supabase] getChat unexpected error:", message);
    return null;
  }
}
