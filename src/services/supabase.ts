/**
 * Supabase Client Initialization
 *
 * Returns a singleton Supabase client (service-role key) when env vars are
 * configured; returns null otherwise so the bot continues to work without DB.
 *
 * Non-regression: every call site must check `getSupabaseClient()` for null
 * and skip the write. The bot must never crash because Supabase is missing.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Centralized table names so call sites don't repeat the `tq-bot-` prefix.
 * Hyphenated identifiers require quoting in raw SQL; the JS client takes
 * the string as-is and quotes it internally.
 */
export const TABLES = {
  chats: "tq-bot-chats",
  questionSends: "tq-bot-question_sends",
  loadFailures: "tq-bot-load_failures",
} as const;

let client: SupabaseClient | null = null;

function buildClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!client) {
    client = buildClient();
  }
  return client;
}
