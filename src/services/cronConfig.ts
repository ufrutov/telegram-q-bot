/**
 * Cron Job Configuration - CRUD for tq-bot-cron_jobs.
 *
 * Per-chat schedule, capped at 12 jobs per chat. Accepts HH or HH:MM as input;
 * the minute is preserved for display but the on-the-hour ticker matches on
 * the hour only (Hobby plan).
 *
 * All errors are logged and surfaced as discriminated results so the bot
 * command layer can format them in MarkdownV2.
 */

import { TABLES, getSupabaseClient } from "./supabase.js";
import { getOrCreateChat } from "./chatStore.js";
import { COMPLEXITIES, type Complexity } from "@/types/question.js";

export const MAX_JOBS_PER_CHAT = 12;

export interface CronJobRow {
  id: string;
  chat_id: string;
  send_at: string;
  complexity: Complexity;
  is_enabled: boolean;
  last_sent_at: string | null;
  created_at: string;
}

export type CronResult<T> = { ok: true; value: T } | { ok: false; error: string };

const TIME_REGEX = /^(\d{1,2})(?::(\d{1,2}))?$/;

/**
 * Parse "12" or "12:30" into normalized "HH:MM:SS". Returns null on
 * invalid input or out-of-range hours/minutes. Seconds are not accepted
 * because the on-the-hour ticker matches on the hour only.
 */
export function parseTime(input: string): string | null {
  const m = input.trim().match(TIME_REGEX);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] != null ? Number(m[2]) : 0;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

export function isComplexity(value: string | undefined): value is Complexity {
  return !!value && (COMPLEXITIES as readonly string[]).includes(value);
}

async function resolveChat(
  chatId: number | string,
  threadId: number | undefined,
): Promise<{ id: string } | null> {
  const chat = await getOrCreateChat(chatId, threadId);
  if (!chat) return null;
  return { id: chat.id };
}

export async function addJob(
  chatId: number | string,
  threadId: number | undefined,
  sendAtInput: string,
  complexityInput: string | undefined,
): Promise<CronResult<CronJobRow>> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "DB is not configured" };

  const time = parseTime(sendAtInput);
  if (!time) return { ok: false, error: "Invalid time. Use HH or HH:MM (e.g. 12, 14:30)." };

  const complexity: Complexity = isComplexity(complexityInput) ? complexityInput : "random";

  const chat = await getOrCreateChat(chatId, threadId);
  if (!chat) return { ok: false, error: "Chat could not be registered" };

  try {
    // Atomic count + insert via RPC. Concurrent /cron add calls in the
    // same chat are serialized through an advisory lock derived from
    // chat_id, so the 12-cap is enforced server-side.
    const { data, error } = await supabase.rpc("tq_bot_add_cron_job", {
      p_chat_id: chat.id,
      p_send_at: time,
      p_complexity: complexity,
      p_max: MAX_JOBS_PER_CHAT,
    });

    if (error) {
      const message = error.message ?? "";
      if (message.includes("maximum") && message.includes("jobs per chat")) {
        return { ok: false, error: `Maximum of ${MAX_JOBS_PER_CHAT} jobs per chat reached.` };
      }
      return { ok: false, error: `DB error: ${message}` };
    }
    if (!data) return { ok: false, error: "Insert returned no row" };
    return { ok: true, value: data as CronJobRow };
  } catch (err) {
    return { ok: false, error: `Unexpected: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function listJobs(
  chatId: number | string,
  threadId: number | undefined,
): Promise<CronResult<CronJobRow[]>> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "DB is not configured" };

  const chat = await resolveChat(chatId, threadId);
  if (!chat) return { ok: false, error: "Chat could not be registered" };

  try {
    const { data, error } = await supabase
      .from(TABLES.cronJobs)
      .select("id, chat_id, send_at, complexity, is_enabled, last_sent_at, created_at")
      .eq("chat_id", chat.id)
      .order("send_at", { ascending: true });

    if (error) return { ok: false, error: `DB error: ${error.message}` };
    return { ok: true, value: (data ?? []) as CronJobRow[] };
  } catch (err) {
    return { ok: false, error: `Unexpected: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function findJobByPrefix(
  chatId: number | string,
  threadId: number | undefined,
  prefix: string,
): Promise<CronResult<CronJobRow>> {
  const list = await listJobs(chatId, threadId);
  if (!list.ok) return list;
  const lower = prefix.toLowerCase();
  const matches = list.value.filter((j) => j.id.toLowerCase().startsWith(lower));
  if (matches.length === 0) {
    return { ok: false, error: `No job with id starting with "${prefix}"` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `Prefix "${prefix}" matches ${matches.length} jobs; be more specific`,
    };
  }
  const job = matches[0];
  if (!job) return { ok: false, error: "No job matched" };
  return { ok: true, value: job };
}

export async function setJobEnabled(
  chatId: number | string,
  threadId: number | undefined,
  prefix: string,
  enabled: boolean,
): Promise<CronResult<CronJobRow>> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "DB is not configured" };

  const found = await findJobByPrefix(chatId, threadId, prefix);
  if (!found.ok) return found;

  try {
    const { data, error } = await supabase
      .from(TABLES.cronJobs)
      .update({ is_enabled: enabled })
      .eq("id", found.value.id)
      .select("id, chat_id, send_at, complexity, is_enabled, last_sent_at, created_at")
      .single();

    if (error) return { ok: false, error: `DB error: ${error.message}` };
    if (!data) return { ok: false, error: "Update returned no row" };
    return { ok: true, value: data as CronJobRow };
  } catch (err) {
    return { ok: false, error: `Unexpected: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function removeJob(
  chatId: number | string,
  threadId: number | undefined,
  prefix: string,
): Promise<CronResult<{ id: string }>> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "DB is not configured" };

  const found = await findJobByPrefix(chatId, threadId, prefix);
  if (!found.ok) return found;

  try {
    const { error } = await supabase.from(TABLES.cronJobs).delete().eq("id", found.value.id);
    if (error) return { ok: false, error: `DB error: ${error.message}` };
    return { ok: true, value: { id: found.value.id } };
  } catch (err) {
    return { ok: false, error: `Unexpected: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function setJobComplexity(
  chatId: number | string,
  threadId: number | undefined,
  prefix: string,
  complexity: string | undefined,
): Promise<CronResult<CronJobRow>> {
  if (!isComplexity(complexity)) {
    return { ok: false, error: "Invalid complexity. Use one of: random, easy, medium, hard." };
  }

  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "DB is not configured" };

  const found = await findJobByPrefix(chatId, threadId, prefix);
  if (!found.ok) return found;

  try {
    const { data, error } = await supabase
      .from(TABLES.cronJobs)
      .update({ complexity })
      .eq("id", found.value.id)
      .select("id, chat_id, send_at, complexity, is_enabled, last_sent_at, created_at")
      .single();

    if (error) return { ok: false, error: `DB error: ${error.message}` };
    if (!data) return { ok: false, error: "Update returned no row" };
    return { ok: true, value: data as CronJobRow };
  } catch (err) {
    return { ok: false, error: `Unexpected: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Internal: select all enabled cron jobs joined with their chat rows.
 * Used by the ticker. The ticker applies hour/date filters in JS.
 */
export interface CronJobWithChat {
  id: string;
  chat_id: string;
  send_at: string;
  complexity: Complexity;
  last_sent_at: string | null;
  chats: { chat_id: number; thread_id: number | null; timezone: string; is_active: boolean } | null;
}

export async function listEnabledJobs(): Promise<CronResult<CronJobWithChat[]>> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "DB is not configured" };

  try {
    const { data, error } = await supabase
      .from(TABLES.cronJobs)
      .select(
        "id, chat_id, send_at, complexity, last_sent_at, chats:chat_id (chat_id, thread_id, timezone, is_active)",
      )
      .eq("is_enabled", true);

    if (error) return { ok: false, error: `DB error: ${error.message}` };

    const rows = (data ?? []) as unknown as CronJobWithChat[];
    const active = rows.filter((row) => row.chats && row.chats.is_active);
    return { ok: true, value: active };
  } catch (err) {
    return { ok: false, error: `Unexpected: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function markJobSent(jobId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from(TABLES.cronJobs)
      .update({ last_sent_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) {
      console.warn("[supabase] markJobSent failed:", error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[supabase] markJobSent unexpected error:", message);
  }
}
