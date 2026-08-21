/**
 * Cron Command Handler - toggle the daily scheduled question send.
 *
 * Syntax:
 *   /cron on      — enable the daily question (default 12:00 in chat's timezone)
 *   /cron off     — disable
 *   /cron status  — show current state
 *   /cron help    — usage
 *
 * Anyone in the chat can run these commands. Up to 1 question per day;
 * the time is fixed at 12:00 in the chat's timezone (default Europe/Chisinau).
 */

import type TelegramBot from "node-telegram-bot-api";

import { getChat, setCronEnabled } from "@/services/chatStore.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import type { ThreadOpts } from "@/types/telegram.js";

interface TelegramMessage {
  chat?: { id?: number | string };
  text?: string;
  message_thread_id?: number;
}

const HELP_TEXT = `⏰ *Ежедневный вопрос*

Каждый день в 12:00 \\(по часовому поясу чата\\) бот отправит случайный вопрос.

  /cron on      — включить
  /cron off     — выключить
  /cron status  — текущее состояние
  /cron help    — эта справка`;

function formatCronTime(time: string): string {
  return time.slice(0, 5);
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
  const subcommand = (text.split(/\s+/)[1] ?? "").toLowerCase();

  try {
    if (subcommand === "" || subcommand === "help") {
      await bot.sendMessage(chatId, HELP_TEXT, {
        ...threadOpts,
        parse_mode: "MarkdownV2",
      });
      return;
    }

    if (subcommand === "on") {
      const result = await setCronEnabled(chatId, threadId, true);
      if (!result.ok) {
        await bot.sendMessage(chatId, `❌ ${escapeMarkdownV2(result.error)}`, {
          ...threadOpts,
          parse_mode: "MarkdownV2",
        });
        return;
      }
      const v = result.value;
      await bot.sendMessage(
        chatId,
        `✅ Ежедневный вопрос включён\\. Время: ${escapeMarkdownV2(formatCronTime(v.cron_time))} \\(${escapeMarkdownV2(v.timezone)}\\)`,
        { ...threadOpts, parse_mode: "MarkdownV2" },
      );
      return;
    }

    if (subcommand === "off") {
      const result = await setCronEnabled(chatId, threadId, false);
      if (!result.ok) {
        await bot.sendMessage(chatId, `❌ ${escapeMarkdownV2(result.error)}`, {
          ...threadOpts,
          parse_mode: "MarkdownV2",
        });
        return;
      }
      await bot.sendMessage(chatId, "⏸ Ежедневный вопрос выключен", {
        ...threadOpts,
        parse_mode: "MarkdownV2",
      });
      return;
    }

    if (subcommand === "status") {
      const chat = await getChat(chatId, threadId);
      if (!chat) {
        await bot.sendMessage(chatId, "ℹ️ Чат ещё не зарегистрирован. Задайте вопрос: /question", {
          ...threadOpts,
          parse_mode: "MarkdownV2",
        });
        return;
      }
      const status = chat.cron_enabled ? "✅ включён" : "⏸ выключен";
      const lastSent = chat.cron_last_sent_at
        ? new Date(chat.cron_last_sent_at).toISOString().slice(0, 10)
        : "—";
      await bot.sendMessage(
        chatId,
        `⏰ *Ежедневный вопрос*\n\nСтатус: ${status}\nВремя: ${escapeMarkdownV2(formatCronTime(chat.cron_time))} \\(${escapeMarkdownV2(chat.timezone)}\\)\nПоследняя отправка: ${escapeMarkdownV2(lastSent)}`,
        { ...threadOpts, parse_mode: "MarkdownV2" },
      );
      return;
    }

    await bot.sendMessage(
      chatId,
      `❌ Неизвестная подкоманда: ${escapeMarkdownV2(subcommand)}\n\n${HELP_TEXT}`,
      {
        ...threadOpts,
        parse_mode: "MarkdownV2",
      },
    );
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
