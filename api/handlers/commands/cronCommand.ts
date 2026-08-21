/**
 * Cron Command Handler - manage per-chat scheduled question sends.
 *
 * Syntax:
 *   /cron add HH:MM [complexity]   (e.g. /cron add 12, /cron add 18:30 easy)
 *   /cron list
 *   /cron remove <id_prefix>
 *   /cron enable <id_prefix>
 *   /cron disable <id_prefix>
 *   /cron setcomplexity <id_prefix> <complexity>
 *   /cron help
 *
 * Anyone in the chat can run these commands. Up to 12 jobs per chat.
 */

import type TelegramBot from "node-telegram-bot-api";

import {
  addJob,
  listJobs,
  removeJob,
  setJobComplexity,
  setJobEnabled,
  type CronJobRow,
  MAX_JOBS_PER_CHAT,
} from "@/services/cronConfig.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import type { ThreadOpts } from "@/types/telegram.js";

interface TelegramMessage {
  chat?: { id?: number | string };
  text?: string;
  message_thread_id?: number;
}

const HELP_TEXT = `⏰ *Настройка расписания*

Формат:
  /cron add \\<HH:MM\\> \\<сложность\\>
  /cron list
  /cron remove \\<id\\_prefix\\>
  /cron enable \\<id\\_prefix\\>
  /cron disable \\<id\\_prefix\\>
  /cron setcomplexity \\<id\\_prefix\\> \\<сложность\\>
  /cron help

Сложность: random \\(по умолчанию\\), easy, medium, hard.
До ${MAX_JOBS_PER_CHAT} задач на чат.
Расписание срабатывает на указанный час \\(Vercel Hobby cron — раз в час\\).`;

function formatJobRow(job: CronJobRow): string {
  const status = job.is_enabled ? "✅" : "⏸";
  const idShort = job.id.slice(0, 8);
  const last = job.last_sent_at ? new Date(job.last_sent_at).toISOString().slice(0, 10) : "—";
  return `${status} \`${idShort}\` \\- ${escapeMarkdownV2(job.send_at.slice(0, 5))} \\(${escapeMarkdownV2(
    job.complexity,
  )}\\), last: ${escapeMarkdownV2(last)}`;
}

function formatList(jobs: CronJobRow[]): string {
  if (jobs.length === 0) {
    return "⏰ *Расписание*\n\nПусто. Используйте /cron add HH:MM \\[сложность\\]";
  }
  const lines = ["⏰ *Расписание*", ""];
  for (const job of jobs) {
    lines.push(formatJobRow(job));
  }
  return lines.join("\n");
}

export default async function cronCommand(
  bot: TelegramBot,
  message: TelegramMessage,
  threadId: number | undefined,
): Promise<void> {
  const chatId = message.chat?.id;
  if (!chatId) return;

  const threadOpts: ThreadOpts = threadId ? { message_thread_id: threadId } : {};
  const text = (message.text ?? "").trim();
  const parts = text.split(/\s+/).slice(1); // drop "/cron"
  const subcommand = (parts[0] ?? "").toLowerCase();

  await sendResult(bot, chatId, threadOpts, async () => {
    if (subcommand === "" || subcommand === "help") {
      return { ok: true, text: HELP_TEXT };
    }

    if (subcommand === "list") {
      const result = await listJobs(chatId, threadId);
      if (!result.ok) return { ok: false, text: `❌ ${escapeMarkdownV2(result.error)}` };
      return { ok: true, text: formatList(result.value) };
    }

    if (subcommand === "add") {
      const timeArg = parts[1];
      if (!timeArg) {
        return { ok: false, text: "❌ Укажите время: /cron add HH:MM \\[сложность\\]" };
      }
      const complexityArg = parts[2];
      const result = await addJob(chatId, threadId, timeArg, complexityArg);
      if (!result.ok) return { ok: false, text: `❌ ${escapeMarkdownV2(result.error)}` };
      const job = result.value;
      return {
        ok: true,
        text: `✅ Добавлено: ${escapeMarkdownV2(job.send_at.slice(0, 5))} \\(${escapeMarkdownV2(
          job.complexity,
        )}\\)\\nID: \`${job.id.slice(0, 8)}\``,
      };
    }

    if (subcommand === "remove" || subcommand === "rm") {
      const prefix = parts[1];
      if (!prefix)
        return { ok: false, text: "❌ Укажите id или префикс: /cron remove <id_prefix>" };
      const result = await removeJob(chatId, threadId, prefix);
      if (!result.ok) return { ok: false, text: `❌ ${escapeMarkdownV2(result.error)}` };
      return { ok: true, text: `✅ Удалено: \`${result.value.id.slice(0, 8)}\`` };
    }

    if (subcommand === "enable") {
      const prefix = parts[1];
      if (!prefix) return { ok: false, text: "❌ Укажите id: /cron enable <id_prefix>" };
      const result = await setJobEnabled(chatId, threadId, prefix, true);
      if (!result.ok) return { ok: false, text: `❌ ${escapeMarkdownV2(result.error)}` };
      return { ok: true, text: `✅ Включено: \`${result.value.id.slice(0, 8)}\`` };
    }

    if (subcommand === "disable") {
      const prefix = parts[1];
      if (!prefix) return { ok: false, text: "❌ Укажите id: /cron disable <id_prefix>" };
      const result = await setJobEnabled(chatId, threadId, prefix, false);
      if (!result.ok) return { ok: false, text: `❌ ${escapeMarkdownV2(result.error)}` };
      return { ok: true, text: `⏸ Выключено: \`${result.value.id.slice(0, 8)}\`` };
    }

    if (subcommand === "setcomplexity") {
      const prefix = parts[1];
      const complexity = parts[2];
      if (!prefix || !complexity) {
        return {
          ok: false,
          text: "❌ Использование: /cron setcomplexity <id_prefix> <сложность>",
        };
      }
      const result = await setJobComplexity(chatId, threadId, prefix, complexity);
      if (!result.ok) return { ok: false, text: `❌ ${escapeMarkdownV2(result.error)}` };
      return {
        ok: true,
        text: `✅ Сложность обновлена: ${escapeMarkdownV2(result.value.complexity)}`,
      };
    }

    return {
      ok: false,
      text: `❌ Неизвестная подкоманда: ${escapeMarkdownV2(subcommand)}\n\n${HELP_TEXT}`,
    };
  });
}

interface ResultPayload {
  ok: boolean;
  text: string;
}

async function sendResult(
  bot: TelegramBot,
  chatId: number | string,
  threadOpts: ThreadOpts,
  runner: () => Promise<ResultPayload>,
): Promise<void> {
  try {
    const result = await runner();
    await bot.sendMessage(chatId, result.text, {
      ...threadOpts,
      parse_mode: "MarkdownV2",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cronCommand] send failed:", message);
    try {
      await bot.sendMessage(chatId, "❌ Ошибка при обработке команды", threadOpts);
    } catch {
      // ignore
    }
  }
}
