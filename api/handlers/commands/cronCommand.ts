/**
 * Cron Command Handler - toggle the daily scheduled question send.
 *
 * Syntax:
 *   /cron on      — enable the daily question (fixed at 12:00 chat-local time)
 *   /cron off     — disable
 *   /cron status  — status card with an inline on/off toggle button
 *   /cron help    — usage
 *
 * The same status card is rendered by the "⏰ Ежедневный вопрос" menu item
 * (via cronStatusCallback), so both entry points share resolveCronState /
 * buildCronStatusText / buildCronKeyboard below.
 *
 * Anyone in the chat can run these commands. One question per day at 12:00.
 */

import type TelegramBot from "node-telegram-bot-api";

import { getChat, setCronEnabled } from "@/services/chatStore.js";
import { escapeMarkdownV2 } from "@/utils/markdown.js";
import { resolveChatTitle } from "@/utils/telegramChat.js";
import { MESSAGES } from "@/bot/constants.js";
import type { InlineKeyboardMarkup, ThreadOpts } from "@/types/telegram.js";

interface TelegramMessage {
  chat?: {
    id?: number | string;
    title?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  text?: string;
  message_thread_id?: number;
}

const HELP_TEXT = `⏰ *Ежедневный вопрос*

Каждый день в 12:00 бот отправит случайный вопрос\\.

  /cron on      — включить
  /cron off     — выключить
  /cron status  — текущее состояние
  /cron help    — эта справка`;

/** State needed to render the cron status card. */
export interface CronCardState {
  enabled: boolean;
  /** Local send time, "HH:MM". */
  time: string;
  /** ISO timestamp of the last scheduled send, or null. */
  lastSentAt: string | null;
}

/**
 * Resolve the card state for a chat. Read-only: a chat that has never been
 * registered renders as disabled with defaults (12:00) instead of erroring,
 * so the menu item works before any question was asked.
 */
export async function resolveCronState(
  chatId: number | string,
  threadId: number | undefined,
): Promise<CronCardState> {
  const chat = await getChat(chatId, threadId);
  if (!chat) {
    return { enabled: false, time: "12:00", lastSentAt: null };
  }
  return {
    enabled: chat.cron_enabled,
    time: chat.cron_time.slice(0, 5),
    lastSentAt: chat.cron_last_sent_at,
  };
}

/** MarkdownV2 status card body (without the toggle keyboard). */
export function buildCronStatusText(state: CronCardState): string {
  const status = state.enabled ? "✅ включён" : "⏸ выключен";
  const lastSent = state.lastSentAt ? state.lastSentAt.slice(0, 10) : "—";
  return [
    "⏰ *Ежедневный вопрос*",
    "",
    `Статус: ${status}`,
    `Время: ${escapeMarkdownV2(state.time)}`,
    `Последняя отправка: ${escapeMarkdownV2(lastSent)}`,
  ].join("\n");
}

/** Single-row keyboard whose label offers the opposite action of the current state. */
export function buildCronKeyboard(enabled: boolean): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: enabled ? MESSAGES.CRON_DISABLE : MESSAGES.CRON_ENABLE,
          callback_data: JSON.stringify({ action: "cronToggle", enable: !enabled }),
        },
      ],
    ],
  };
}

function formatTime(time: string): string {
  return escapeMarkdownV2(time.slice(0, 5));
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
      const result = await setCronEnabled(chatId, threadId, true, resolveChatTitle(message.chat));
      if (!result.ok) {
        await bot.sendMessage(chatId, `❌ ${escapeMarkdownV2(result.error)}`, {
          ...threadOpts,
          parse_mode: "MarkdownV2",
        });
        return;
      }
      await bot.sendMessage(
        chatId,
        `✅ Ежедневный вопрос включён\\. Время: ${formatTime(result.value.cron_time)}`,
        { ...threadOpts, parse_mode: "MarkdownV2" },
      );
      return;
    }

    if (subcommand === "off") {
      const result = await setCronEnabled(chatId, threadId, false, resolveChatTitle(message.chat));
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
      // Unified with the menu item: full card + inline toggle button.
      const state = await resolveCronState(chatId, threadId);
      await bot.sendMessage(chatId, buildCronStatusText(state), {
        ...threadOpts,
        parse_mode: "MarkdownV2",
        reply_markup: buildCronKeyboard(state.enabled),
      });
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
