/**
 * Chat Store - reads and writes tq-bot-chats rows.
 *
 * - getOrCreateChat: write path used by questionSendStore / loadFailureStore.
 *   Inserts the row if missing and returns the full ChatRow.
 * - getChat: read-only path. Used by stats and any read-only command that
 *   must NOT pollute the chats table.
 *
 * Cron helpers:
 * - setCronEnabled: toggle cron_enabled for a chat.
 * - listChatsWithCronEnabled: every active chat that opted into the daily
 *   scheduled send, used by the ticker.
 * - markChatCronSent: idempotency stamp; the ticker skips a chat whose
 *   last_sent_at is already today in chat timezone.
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
  cron_enabled: boolean;
  cron_time: string;
  cron_last_sent_at: string | null;
}

export type CronResult<T> = { ok: true; value: T } | { ok: false; error: string };

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
      .select(
        "id, chat_id, thread_id, title, timezone, is_active, cron_enabled, cron_time, cron_last_sent_at",
      )
      .single();

    if (error) {
      console.warn("[supabase] getOrCreateChat upsert failed:", error.message);
      return null;
    }

    if (!data) {
      return null;
    }

    const out: ChatRow = rowFromData(data);
    cache.set(key, out);
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[supabase] getOrCreateChat unexpected error:", message);
    return null;
  }
}

/**
 * Read-only lookup. Returns null if the chat is not registered or if the
 * call fails. Never inserts.
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
      .select(
        "id, chat_id, thread_id, title, timezone, is_active, cron_enabled, cron_time, cron_last_sent_at",
      )
      .eq("chat_id", numericChatId)
      // `.is()` (not `.eq()`) — PostgREST null matching; `eq.null` never matches.
      .is("thread_id", threadId ?? null)
      .maybeSingle();

    if (error) {
      console.warn("[supabase] getChat select failed:", error.message);
      return null;
    }
    if (!data) {
      return null;
    }

    const out: ChatRow = rowFromData(data);
    cache.set(key, out);
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[supabase] getChat unexpected error:", message);
    return null;
  }
}

/**
 * Toggle cron_enabled for a chat. Inserts the row if missing (carrying the
 * default cron_time of 12:00 and the default timezone Europe/Chisinau).
 */
export async function setCronEnabled(
  chatId: number | string,
  threadId: number | undefined,
  enabled: boolean,
): Promise<CronResult<{ cron_enabled: boolean; cron_time: string; timezone: string }>> {
  const numericChatId = typeof chatId === "string" ? Number(chatId) : chatId;
  if (!Number.isFinite(numericChatId)) {
    return { ok: false, error: "Invalid chat id" };
  }

  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "DB is not configured" };

  try {
    const { data, error } = await supabase
      .from(TABLES.chats)
      .upsert(
        {
          chat_id: numericChatId,
          thread_id: threadId ?? null,
          cron_enabled: enabled,
        },
        { onConflict: "chat_id,thread_id" },
      )
      .select("cron_enabled, cron_time, timezone")
      .single();

    if (error) return { ok: false, error: `DB error: ${error.message}` };
    if (!data) return { ok: false, error: "Upsert returned no row" };

    // Invalidate the per-invocation cache so the next read sees the change.
    cache.delete(cacheKey(chatId, threadId));

    return {
      ok: true,
      value: {
        cron_enabled: data.cron_enabled,
        cron_time: data.cron_time,
        timezone: data.timezone,
      },
    };
  } catch (err) {
    return { ok: false, error: `Unexpected: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Returns every active chat whose cron_enabled = true. The ticker iterates
 * this list twice a day (see vercel.json) and matches each chat's local
 * hour against cron_time.
 */
export async function listChatsWithCronEnabled(): Promise<
  CronResult<
    Array<{
      id: string;
      chat_id: number;
      thread_id: number | null;
      timezone: string;
      cron_time: string;
      cron_last_sent_at: string | null;
    }>
  >
> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "DB is not configured" };

  try {
    const { data, error } = await supabase
      .from(TABLES.chats)
      .select("id, chat_id, thread_id, timezone, cron_time, cron_last_sent_at")
      .eq("is_active", true)
      .eq("cron_enabled", true);

    if (error) return { ok: false, error: `DB error: ${error.message}` };
    return { ok: true, value: (data ?? []) as never };
  } catch (err) {
    return { ok: false, error: `Unexpected: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Idempotency stamp. The ticker calls this after a successful send so the
 * same chat is not picked again until tomorrow (in chat timezone).
 */
export async function markChatCronSent(chatId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from(TABLES.chats)
      .update({
        cron_last_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", chatId);
    if (error) {
      console.warn("[supabase] markChatCronSent failed:", error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[supabase] markChatCronSent unexpected error:", message);
  }
}

function rowFromData(data: {
  id: string;
  chat_id: number;
  thread_id: number | null;
  title: string | null;
  timezone: string;
  is_active: boolean;
  cron_enabled: boolean;
  cron_time: string;
  cron_last_sent_at: string | null;
}): ChatRow {
  return {
    id: data.id,
    chat_id: data.chat_id,
    thread_id: data.thread_id,
    title: data.title,
    timezone: data.timezone,
    is_active: data.is_active,
    cron_enabled: data.cron_enabled,
    cron_time: data.cron_time,
    cron_last_sent_at: data.cron_last_sent_at,
  };
}
