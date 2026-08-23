/**
 * Stats Service - aggregates tq-bot-question_sends and tq-bot-load_failures
 * into a MarkdownV2 report for /stats.
 *
 * Always covers the full lifetime of the chat (no period filter); the
 * aggregation itself runs server-side via the tq_bot_get_stats RPC, so the
 * payload stays bounded at O(complexities) regardless of row count.
 * The RPC's p_since parameter is passed null.
 *
 * All errors are logged and surfaced as discriminated results so the bot
 * command layer can format them.
 */

import { getSupabaseClient } from "./supabase.js";
import { getChat } from "./chatStore.js";
import { COMPLEXITIES, type Complexity } from "@/types/question.js";
import { COMPLEXITY_EMOJI } from "@/bot/constants.js";

export type StatsResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface SendStat {
  complexity: Complexity;
  loaded: number;
  hints_asked: number;
  hints_failed: number;
  answered: number;
}

export interface StatsReport {
  sends: SendStat[];
  failures: number;
}

function emptyStat(complexity: Complexity): SendStat {
  return { complexity, loaded: 0, hints_asked: 0, hints_failed: 0, answered: 0 };
}

export async function getStats(
  chatId: number | string,
  threadId: number | undefined,
): Promise<StatsResult<StatsReport>> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "DB is not configured" };

  const chat = await getChat(chatId, threadId);
  if (!chat) return { ok: false, error: "Chat is not registered yet. Run a /question first." };

  try {
    const { data, error } = await supabase.rpc("tq_bot_get_stats", {
      p_chat_id: chat.id,
      p_since: null,
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

    return {
      ok: true,
      value: {
        sends: COMPLEXITIES.map((c) => buckets.get(c) ?? emptyStat(c)),
        failures,
      },
    };
  } catch (err) {
    return { ok: false, error: `Unexpected: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const DISPLAY_ORDER: readonly Complexity[] = ["easy", "medium", "hard", "random"];

const LABELS: Record<Complexity, string> = {
  easy: "Лёгкие",
  medium: "Средние",
  hard: "Сложные",
  random: "Случайные",
};

/** Russian plural: 1 вопрос / 2 вопроса / 5 вопросов. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * One line per complexity that has at least one loaded question:
 *   🎯 Лёгкие — 1 вопрос • 1 подсказка • ✅ 1 правильный ответ
 * followed by a Total row over all buckets, then the load-failure count
 * when non-zero. Zero-count buckets are omitted; the answered segment is
 * appended only when the count is above zero.
 */
export function formatStats(report: StatsReport): string {
  const lines: string[] = ["📊 *Статистика*", ""];

  const detailLines: string[] = [];
  let totalLoaded = 0;
  let totalHints = 0;
  let totalAnswered = 0;

  for (const complexity of DISPLAY_ORDER) {
    const bucket = report.sends.find((s) => s.complexity === complexity);
    if (!bucket || bucket.loaded === 0) continue;

    totalLoaded += bucket.loaded;
    totalHints += bucket.hints_asked;
    totalAnswered += bucket.answered;

    let line = `${COMPLEXITY_EMOJI[complexity]} *${LABELS[complexity]}* — ${bucket.loaded} ${plural(
      bucket.loaded,
      "вопрос",
      "вопроса",
      "вопросов",
    )} • ${bucket.hints_asked} ${plural(bucket.hints_asked, "подсказка", "подсказки", "подсказок")}`;
    if (bucket.answered > 0) {
      line += ` • ✅ ${bucket.answered} ${plural(
        bucket.answered,
        "правильный ответ",
        "правильных ответа",
        "правильных ответов",
      )}`;
    }
    detailLines.push(line);
  }

  if (detailLines.length > 0) {
    lines.push(...detailLines);
  }

  if (totalLoaded > 0) {
    if (detailLines.length > 0) {
      lines.push("");
    }
    let totalLine = `🏆 *Всего* — ${totalLoaded} ${plural(
      totalLoaded,
      "вопрос",
      "вопроса",
      "вопросов",
    )} • ${totalHints} ${plural(totalHints, "подсказка", "подсказки", "подсказок")}`;
    if (totalAnswered > 0) {
      totalLine += ` • ✅ ${totalAnswered} ${plural(
        totalAnswered,
        "правильный ответ",
        "правильных ответа",
        "правильных ответов",
      )}`;
    }
    lines.push(totalLine);
  }

  if (report.failures > 0) {
    lines.push("", `⚠️ Ошибок загрузки: ${report.failures}`);
  }

  return lines.join("\n");
}
