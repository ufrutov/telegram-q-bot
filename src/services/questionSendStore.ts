/**
 * Question Send Store - records the lifecycle of a question sent to a chat.
 *
 * Each row in tq-bot-question_sends represents one question that was successfully
 * sent to a chat. The row is created on the success path of sendQuestionMessage
 * and mutated on hint interactions.
 *
 * Note: hint_asked and hint_failed are mutually exclusive (one-shot hint per
 * today's bot behavior). A future question_answered flag will be set by a
 * separate trigger and is not wired here.
 *
 * All errors are logged and swallowed. The bot never crashes because the DB
 * is missing.
 */

import type { Complexity } from "@/types/question.js";

import { TABLES, getSupabaseClient } from "./supabase.js";
import { getOrCreateChat } from "./chatStore.js";

interface RecordQuestionSentArgs {
  chatId: number | string;
  threadId: number | undefined;
  telegramMessageId: number;
  questionId: string | number | null;
  complexity: Complexity;
}

/**
 * Insert a row in tq-bot-question_sends. Idempotent on (chat_id, telegram_message_id).
 * Resolves the chat UUID via getOrCreateChat; if that fails (DB unreachable) the
 * call is a no-op so the bot keeps working.
 */
export async function recordQuestionSent(args: RecordQuestionSentArgs): Promise<void> {
  const { chatId, threadId, telegramMessageId, questionId, complexity } = args;

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
      telegram_message_id: telegramMessageId,
      question_id: questionId != null ? String(questionId) : null,
      complexity,
    };
    const { error } = await supabase
      .from(TABLES.questionSends)
      .upsert(row, { onConflict: "chat_id,telegram_message_id", ignoreDuplicates: true });

    if (error) {
      console.warn("[supabase] recordQuestionSent upsert failed:", error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[supabase] recordQuestionSent unexpected error:", message);
  }
}

interface RecordHintResultArgs {
  chatId: number | string;
  threadId: number | undefined;
  telegramMessageId: number;
  ok: boolean;
  error?: string;
}

/**
 * Update the question_sends row matching (chat_id, telegram_message_id) with
 * the hint outcome. Mutually exclusive: ok=true sets hint_asked=true and
 * hint_failed=false; ok=false sets hint_failed=true and hint_asked stays false.
 *
 * If the matching row does not exist (e.g. older bot version, missed insert),
 * the update is silently skipped — hint state is best-effort.
 */
export async function recordHintResult(args: RecordHintResultArgs): Promise<void> {
  const { chatId, threadId, telegramMessageId, ok, error } = args;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const chat = await getOrCreateChat(chatId, threadId);
  if (!chat) {
    return;
  }

  const update: Record<string, unknown> = {
    hint_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (ok) {
    update.hint_asked = true;
    update.hint_failed = false;
  } else {
    update.hint_failed = true;
  }
  if (error) {
    update.meta = { error };
  }

  try {
    const { error: dbError } = await supabase
      .from(TABLES.questionSends)
      .update(update)
      .eq("chat_id", chat.id)
      .eq("telegram_message_id", telegramMessageId);

    if (dbError) {
      console.warn("[supabase] recordHintResult update failed:", dbError.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[supabase] recordHintResult unexpected error:", message);
  }
}

export type AnsweredResult = { ok: true } | { ok: false; error: string };

interface RecordQuestionAnsweredArgs {
  chatId: number | string;
  threadId: number | undefined;
  /** telegram_message_id of the original question row in tq-bot-question_sends. */
  telegramMessageId: number;
}

/**
 * Flag the question as answered (question_answered = TRUE).
 *
 * Unlike the other store functions this one SURFACES the outcome: the
 * ✅ Засчитать ответ button flow only removes itself and confirms after a
 * successful write, so DB failures must reach the caller for retry.
 *
 * A missing row (question sent before the integration was deployed)
 * counts as ok with no effect — nothing to flag.
 */
export async function recordQuestionAnswered(
  args: RecordQuestionAnsweredArgs,
): Promise<AnsweredResult> {
  const { chatId, threadId, telegramMessageId } = args;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, error: "DB is not configured" };
  }

  const chat = await getOrCreateChat(chatId, threadId);
  if (!chat) {
    return { ok: false, error: "Chat could not be registered" };
  }

  try {
    const { error } = await supabase
      .from(TABLES.questionSends)
      .update({
        question_answered: true,
        updated_at: new Date().toISOString(),
      })
      .eq("chat_id", chat.id)
      .eq("telegram_message_id", telegramMessageId);

    if (error) {
      console.warn("[supabase] recordQuestionAnswered failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[supabase] recordQuestionAnswered unexpected error:", message);
    return { ok: false, error: message };
  }
}
