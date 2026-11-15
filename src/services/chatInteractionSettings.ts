import { getSupabaseClient, TABLES } from "./supabase.js";
import type { CallbackAction } from "@/types/telegram.js";

export interface ChatInteractionSettings {
  commands_enabled: boolean;
  answer_buttons_enabled: boolean;
  hint_enabled: boolean;
}

/** Fresh read: dashboard edits must take effect even on warm Vercel instances.
 * A false group-level setting also restricts every topic in that group.
 * Missing rows use defaults; lookup failures suppress restricted interactions.
 */
export async function getChatInteractionSettings(
  chatId: number | string,
  threadId: number | undefined,
): Promise<ChatInteractionSettings> {
  const disabled = { commands_enabled: false, answer_buttons_enabled: false, hint_enabled: false };
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.warn("[chatInteractionSettings] DB is not configured");
    return disabled;
  }

  try {
    let query = supabase
      .from(TABLES.chats)
      .select("thread_id, commands_enabled, answer_buttons_enabled, hint_enabled")
      .eq("chat_id", Number(chatId));
    query =
      threadId == null
        ? query.is("thread_id", null)
        : query.or(`thread_id.is.null,thread_id.eq.${threadId}`);
    const { data, error } = await query;
    if (error) throw error;
    return {
      hint_enabled: (data ?? []).every((row) => row.hint_enabled !== false),
      commands_enabled: (data ?? []).every((row) => row.commands_enabled === true),
      answer_buttons_enabled: (data ?? []).every((row) => row.answer_buttons_enabled === true),
    };
  } catch (error) {
    console.warn("[chatInteractionSettings] lookup failed:", error);
    return disabled;
  }
}

export function isCallbackEnabled(
  action: CallbackAction,
  settings: ChatInteractionSettings,
): boolean {
  if ("hintKey" in action) return settings.hint_enabled;
  if (!("action" in action)) return true; // Answer remains usable.
  if (action.action === "answered") return settings.answer_buttons_enabled;
  if (action.action === "pack") {
    return settings.commands_enabled && settings.answer_buttons_enabled;
  }
  return settings.commands_enabled;
}
