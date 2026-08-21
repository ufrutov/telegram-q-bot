/**
 * Stats Service - aggregates tq-bot-question_sends and tq-bot-load_failures
 * into a MarkdownV2 report for /stats.
 *
 * All errors are logged and surfaced as discriminated results so the bot
 * command layer can format them.
 */

import { TABLES, getSupabaseClient } from "./supabase.js";
import { getOrCreateChat } from "./chatStore.js";
import { COMPLEXITIES, type Complexity } from "@/types/question.js";
import { COMPLEXITY_EMOJI } from "@/bot/constants.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";

export type StatsResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type StatsWindow = "7d" | "30d" | "all";

export interface SendStat {
  complexity: Complexity;
  loaded: number;
  hints_asked: number;
  hints_failed: number;
  answered: number;
}

export interface StatsReport {
  window: StatsWindow;
  sends: SendStat[];
  failures: number;
  totalLoaded: number;
  totalHintsAsked: number;
  totalHintsFailed: number;
  totalAnswered: number;
}

function windowIso(w: StatsWindow): string | null {
  if (w === "7d") return new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  if (w === "30d") return new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  return null;
}

function emptyStat(complexity: Complexity): SendStat {
  return { complexity, loaded: 0, hints_asked: 0, hints_failed: 0, answered: 0 };
}

export async function getStats(
  chatId: number | string,
  threadId: number | undefined,
  window: StatsWindow,
): Promise<StatsResult<StatsReport>> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "DB is not configured" };

  const chat = await getOrCreateChat(chatId, threadId);
  if (!chat) return { ok: false, error: "Chat could not be registered" };

  const since = windowIso(window);

  try {
    let sendsQuery = supabase
      .from(TABLES.questionSends)
      .select("complexity, hint_asked, hint_failed, question_answered")
      .eq("chat_id", chat.id);
    if (since) sendsQuery = sendsQuery.gte("created_at", since);

    const { data: sends, error: sendsError } = await sendsQuery;
    if (sendsError) return { ok: false, error: `DB error: ${sendsError.message}` };

    const buckets = new Map<Complexity, SendStat>();
    for (const c of COMPLEXITIES) {
      buckets.set(c, emptyStat(c));
    }
    for (const row of sends ?? []) {
      const r = row as {
        complexity: Complexity | null;
        hint_asked: boolean;
        hint_failed: boolean;
        question_answered: boolean | null;
      };
      if (!r.complexity) continue;
      const bucket = buckets.get(r.complexity) ?? emptyStat(r.complexity);
      bucket.loaded += 1;
      if (r.hint_asked) bucket.hints_asked += 1;
      if (r.hint_failed) bucket.hints_failed += 1;
      if (r.question_answered) bucket.answered += 1;
      buckets.set(r.complexity, bucket);
    }

    let failuresQuery = supabase
      .from(TABLES.loadFailures)
      .select("id", { count: "exact", head: true })
      .eq("chat_id", chat.id);
    if (since) failuresQuery = failuresQuery.gte("created_at", since);

    const { count: failures, error: failError } = await failuresQuery;
    if (failError) return { ok: false, error: `DB error: ${failError.message}` };

    const sendsList = COMPLEXITIES.map((c) => buckets.get(c) ?? emptyStat(c));
    const totalLoaded = sendsList.reduce((s, b) => s + b.loaded, 0);
    const totalHintsAsked = sendsList.reduce((s, b) => s + b.hints_asked, 0);
    const totalHintsFailed = sendsList.reduce((s, b) => s + b.hints_failed, 0);
    const totalAnswered = sendsList.reduce((s, b) => s + b.answered, 0);

    return {
      ok: true,
      value: {
        window,
        sends: sendsList,
        failures: failures ?? 0,
        totalLoaded,
        totalHintsAsked,
        totalHintsFailed,
        totalAnswered,
      },
    };
  } catch (err) {
    return { ok: false, error: `Unexpected: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const WINDOW_LABEL: Record<StatsWindow, string> = {
  "7d": "7 дней",
  "30d": "30 дней",
  all: "всё время",
};

export function formatStats(report: StatsReport): string {
  const lines: string[] = [];
  lines.push(`📊 *Статистика* \\(${escapeMarkdownV2(WINDOW_LABEL[report.window])}\\)`);
  lines.push("");

  lines.push("*Загружено вопросов:* " + escapeMarkdownV2(String(report.totalLoaded)));
  const parts: string[] = [];
  for (const b of report.sends) {
    if (b.loaded === 0) continue;
    const emoji = COMPLEXITY_EMOJI[b.complexity];
    parts.push(`${emoji} ${escapeMarkdownV2(String(b.loaded))}`);
  }
  if (parts.length > 0) {
    lines.push("  " + parts.join(" • "));
  }
  lines.push("");

  lines.push(
    `*Подсказок:* ${escapeMarkdownV2(String(report.totalHintsAsked))} ✅ • ${escapeMarkdownV2(
      String(report.totalHintsFailed),
    )} ❌`,
  );

  if (report.totalAnswered > 0) {
    lines.push(`*Отвечено:* ${escapeMarkdownV2(String(report.totalAnswered))}`);
  }

  if (report.failures > 0) {
    lines.push("");
    lines.push(`⚠️ *Ошибок загрузки:* ${escapeMarkdownV2(String(report.failures))}`);
  }

  return lines.join("\n");
}
