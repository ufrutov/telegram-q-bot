/**
 * Chat Store - upserts tq-bot-chats rows and caches the UUID per serverless invocation.
 *
 * All errors are logged and swallowed. The bot never crashes because the DB is missing.
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

/** Per-invocation cache (chat_id,thread_id) -> row. Wiped on cold start. */
const cache = new Map<string, ChatRow>();

function cacheKey(chatId: number | string, threadId: number | undefined): string {
  return `${chatId}:${threadId ?? ""}`;
}

/**
 * Returns the chat's UUID, creating the row if it does not yet exist.
 * Returns null if Supabase is unconfigured or the call fails — callers
 * must handle null and skip the dependent write.
 */
export async function getOrCreateChat(
  chatId: number | string,
  threadId: number | undefined,
  title?: string,
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
      ...(title ? { title } : {}),
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
 * Look up an existing chat row without inserting. Returns null if missing or on error.
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
