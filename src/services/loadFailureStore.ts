/**
 * Load Failure Store - lightweight log of failed question loads.
 *
 * Each row corresponds to a single load attempt that threw (HTTP 4xx/5xx,
 * network failure, retry exhaustion). Unlike question_sends, no telegram_message_id
 * is recorded because the message was never sent.
 *
 * All errors are logged and swallowed. The bot never crashes because the DB
 * is missing.
 */

import type { Complexity } from "@/types/question.js";

import { TABLES, getSupabaseClient } from "./supabase.js";
import { getOrCreateChat } from "./chatStore.js";

interface RecordLoadFailureArgs {
  chatId: number | string;
  threadId: number | undefined;
  complexity: Complexity;
  error: string;
}

export async function recordLoadFailure(args: RecordLoadFailureArgs): Promise<void> {
  const { chatId, threadId, complexity, error } = args;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const chat = await getOrCreateChat(chatId, threadId);
  if (!chat) {
    return;
  }

  try {
    const row = {
      chat_id: chat.id,
      complexity,
      error: error.slice(0, 1000),
      meta: { source: "questionSender" },
    };
    const { error: dbError } = await supabase.from(TABLES.loadFailures).insert(row);

    if (dbError) {
      console.warn("[supabase] recordLoadFailure insert failed:", dbError.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[supabase] recordLoadFailure unexpected error:", message);
  }
}
