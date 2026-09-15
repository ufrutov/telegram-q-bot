/**
 * Supabase Client Initialization
 *
 * Returns a singleton Supabase client (service-role key) when env vars are
 * configured; returns null otherwise so the bot continues to work without DB.
 *
 * Non-regression: every call site must check `getSupabaseClient()` for null
 * and skip the write. The bot must never crash because Supabase is missing.
 *
 * Also exports:
 * - `withRetry`: retry helper for transient Supabase/PostgREST errors
 *   (504 Gateway Timeout, network blips, 5xx). The Supabase free-tier
 *   edge gateway occasionally returns a 504 on a single query inside a
 *   burst; a one-shot retry resolves it in the vast majority of cases.
 * - `SupabaseMissingError`: sentinel thrown by callers to mean "the row
 *   genuinely does not exist" — never retried, never surfaced as a
 *   transient error. Lets store functions distinguish "expired" from
 *   "couldn't reach the DB".
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

/**
 * Sentinel thrown to signal "the row genuinely does not exist" inside a
 * `withRetry` body. `withRetry` does not retry this — the caller should
 * translate it into a "missing" branch, not a "transient error" branch.
 */
export class SupabaseMissingError extends Error {
  constructor(public readonly kind: "chat" | "question_send" | "payload" | "row" = "row") {
    super(`__missing__:${kind}`);
    this.name = "SupabaseMissingError";
  }
}

/**
 * Heuristic for transient PostgREST/network errors. PostgREST returns plain
 * messages ("Gateway Timeout", "503 Service Unavailable") and the underlying
 * fetch layer surfaces its own ("fetch failed", "ETIMEDOUT"). Matching by
 * message is sufficient here — the alternative (parsing the PostgREST error
 * envelope for an HTTP status) adds coupling without buying much, since
 * 4xx auth/permission errors fall outside the regex anyway.
 */
const TRANSIENT_ERROR_RE =
  /timeout|5\d\d|Gateway|UNAVAILABLE|ETIMEDOUT|ECONNRESET|fetch failed|network|socket hang up/i;

function isTransientMessage(message: string): boolean {
  return TRANSIENT_ERROR_RE.test(message);
}

export interface WithRetryOptions {
  /** Total attempts including the first. Defaults to 2 (one retry). */
  attempts?: number;
  /** Delay before the second attempt in ms; subsequent delays scale linearly. */
  baseDelayMs?: number;
}

/**
 * Run `fn`, retrying on transient errors. Non-transient errors (4xx, auth,
 * validation) and `SupabaseMissingError` re-throw immediately. Each retry
 * is logged so Vercel captures the flakiness even when the second attempt
 * succeeds.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: WithRetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 250;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SupabaseMissingError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (!isTransientMessage(message)) {
        throw err;
      }
      if (i === attempts - 1) {
        throw err;
      }
      const delay = baseDelayMs * (i + 1);
      console.warn(`[supabase] transient error, retrying in ${delay}ms:`, message);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // Unreachable: the loop either returns or throws on the last iteration.
  throw new Error("withRetry: exhausted attempts without throwing");
}
