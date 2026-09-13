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

import { SupabaseMissingError, TABLES, getSupabaseClient, withRetry } from "./supabase.js";
import { getOrCreateChat } from "./chatStore.js";

export interface AnswerPayload {
  answer: string;
  answerPreview: string[];
  packId: string | number | null;
  /** Set only when buttons are carried by a separate message after media. */
  questionMessageId?: number;
}

export interface HintPayload {
  question: string;
  answer: string;
  description?: string;
  questionMessageId?: number;
  questionPreview?: string[];
}

export interface QuestionSendContext {
  answerPayload: AnswerPayload;
  hintPayload: HintPayload;
}

/**
 * Outcome of looking up a question's callback context.
 *
 * - `ok` — the row exists and both payloads round-tripped.
 * - `missing` — neither the chat nor the question-send row exists, or
 *   the payloads are malformed. Treat as "hint/answer expired" UX.
 * - `error` — Supabase returned a persistent (post-retry) failure: the
 *   row may or may not exist but we couldn't reach it. Treat as a
 *   transient load failure; do NOT remove buttons — the user should
 *   be able to tap again.
 */
export type GetQuestionSendContextResult =
  | { status: "ok"; context: QuestionSendContext }
  | { status: "missing" }
  | { status: "error"; message: string };

interface RecordQuestionSentArgs {
  chatId: number | string;
  threadId: number | undefined;
  title?: string;
  telegramMessageId: number;
  questionId: string | number | null;
  complexity: Complexity;
  answerPayload: AnswerPayload;
  hintPayload: HintPayload;
  isIntegrationTest?: boolean;
}

/**
 * Insert a row in tq-bot-question_sends. Idempotent on (chat_id, telegram_message_id).
 * Resolves the chat UUID via getOrCreateChat; if that fails (DB unreachable) the
 * call is a no-op so the bot keeps working.
 */
export async function recordQuestionSent(args: RecordQuestionSentArgs): Promise<void> {
  const {
    chatId,
    threadId,
    telegramMessageId,
    questionId,
    complexity,
    answerPayload,
    hintPayload,
    isIntegrationTest = false,
    title,
  } = args;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const chat = await getOrCreateChat(chatId, threadId, title);
  if (!chat) {
    return;
  }

  try {
    const row = {
      chat_id: chat.id,
      telegram_message_id: telegramMessageId,
      question_id: questionId != null ? String(questionId) : null,
      complexity,
      answer_payload: answerPayload,
      hint_payload: hintPayload,
      is_integration_test: isIntegrationTest,
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

/**
 * Reads the durable callback context for a question message. The Telegram
 * message ID identifies a single send even when the same source question has
 * been posted to a chat more than once.
 *
 * Transient Supabase failures (504 Gateway Timeout, network blips) are
 * retried via `withRetry`. The result discriminates between a row that
 * genuinely does not exist (`missing`) and a query that could not be
 * completed (`error`) so the handler can show the right message instead
 * of conflating the two.
 */
export async function getQuestionSendContext(
  chatId: number | string,
  threadId: number | undefined,
  telegramMessageId: number,
): Promise<GetQuestionSendContextResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { status: "error", message: "DB is not configured" };
  }

  const numericChatId = typeof chatId === "string" ? Number(chatId) : chatId;
  if (!Number.isFinite(numericChatId)) {
    return { status: "missing" };
  }

  try {
    const context = await withRetry(async () => {
      let chatQuery = supabase.from(TABLES.chats).select("id").eq("chat_id", numericChatId);
      // PostgREST operators differ by nullness: `is` accepts only null/true/false,
      // so real thread ids must filter with plain `eq` (is.7 is a parse error).
      chatQuery =
        threadId == null ? chatQuery.is("thread_id", null) : chatQuery.eq("thread_id", threadId);

      const { data: chatData, error: chatError } = await chatQuery.maybeSingle();
      if (chatError) throw chatError;
      if (!chatData) throw new SupabaseMissingError("chat");

      const { data, error } = await supabase
        .from(TABLES.questionSends)
        .select("answer_payload, hint_payload")
        .eq("chat_id", chatData.id)
        .eq("telegram_message_id", telegramMessageId)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new SupabaseMissingError("question_send");

      const answerPayload = data.answer_payload as AnswerPayload | null;
      const hintPayload = data.hint_payload as HintPayload | null;
      if (!isAnswerPayload(answerPayload) || !isHintPayload(hintPayload)) {
        throw new SupabaseMissingError("payload");
      }

      return { answerPayload, hintPayload };
    });

    return { status: "ok", context };
  } catch (err) {
    if (err instanceof SupabaseMissingError) {
      return { status: "missing" };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[supabase] getQuestionSendContext failed:", message);
    return { status: "error", message };
  }
}

function isAnswerPayload(value: unknown): value is AnswerPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.answer === "string" &&
    Array.isArray(payload.answerPreview) &&
    payload.answerPreview.every((url) => typeof url === "string") &&
    (payload.questionMessageId === undefined || typeof payload.questionMessageId === "number")
  );
}

function isHintPayload(value: unknown): value is HintPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.question === "string" &&
    typeof payload.answer === "string" &&
    (payload.description === undefined || typeof payload.description === "string") &&
    (payload.questionMessageId === undefined || typeof payload.questionMessageId === "number") &&
    (payload.questionPreview === undefined ||
      (Array.isArray(payload.questionPreview) &&
        payload.questionPreview.every((url) => typeof url === "string")))
  );
}

interface RecordHintResultArgs {
  chatId: number | string;
  threadId: number | undefined;
  title?: string;
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
  const { chatId, threadId, telegramMessageId, ok, error, title } = args;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const chat = await getOrCreateChat(chatId, threadId, title);
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
  title?: string;
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
  const { chatId, threadId, telegramMessageId, title } = args;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, error: "DB is not configured" };
  }

  const chat = await getOrCreateChat(chatId, threadId, title);
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
