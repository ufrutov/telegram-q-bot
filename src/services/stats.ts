/**
 * Stats Service - aggregates tq-bot-question_sends and tq-bot-load_failures
 * into a MarkdownV2 report for /stats.
 *
 * Aggregation is done server-side via the tq_bot_get_stats RPC function.
 * This keeps the payload bounded at O(complexities) regardless of how many
 * questions the chat has asked over the lifetime of the bot.
 *
 * All errors are logged and surfaced as discriminated results so the bot
 * command layer can format them.
 */

import { TABLES, getSupabaseClient } from "./supabase.js";
import { getChat } from "./chatStore.js";
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

  const chat = await getChat(chatId, threadId);
  if (!chat) return { ok: false, error: "Chat is not registered yet. Run a /question first." };

  const since = windowIso(window);

  try {
    const { data, error } = await supabase.rpc("tq_bot_get_stats", {
      p_chat_id: chat.id,
      p_since: since,
    });

    if (error) return { ok: false, error: `DB error: ${error.message}` };

    const buckets = new Map<Complexity, SendStat>();
    for (const c of COMPLEXITIES) {
      buckets.set(c, emptyStat(c));
    }
    let failures = 0;

    for (const row of data ?? []) {
      const r = row as {
        complexity: string;
        loaded: number;
        hints_asked: number;
        hints_failed: number;
        answered: number;
        failures: number;
      };
      if (r.complexity === "__failures__") {
        failures = Number(r.failures);
        continue;
      }
      if (!(COMPLEXITIES as readonly string[]).includes(r.complexity)) continue;
      const c = r.complexity as Complexity;
      buckets.set(c, {
        complexity: c,
        loaded: Number(r.loaded),
        hints_asked: Number(r.hints_asked),
        hints_failed: Number(r.hints_failed),
        answered: Number(r.answered),
      });
    }

    const sends = COMPLEXITIES.map((c) => buckets.get(c) ?? emptyStat(c));
    const totalLoaded = sends.reduce((s, b) => s + b.loaded, 0);
    const totalHintsAsked = sends.reduce((s, b) => s + b.hints_asked, 0);
    const totalHintsFailed = sends.reduce((s, b) => s + b.hints_failed, 0);
    const totalAnswered = sends.reduce((s, b) => s + b.answered, 0);

    return {
      ok: true,
      value: {
        window,
        sends,
        failures,
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

// Silence unused-import warnings when only some symbols from a module are used.
void TABLES;

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
