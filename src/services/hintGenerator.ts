import { generateHint as geminiHint } from "./gemini.js";
import { generateHint as openrouterHint } from "./openrouter.js";
import { getHintSettings } from "./hintSettings.js";
import type { HintModelConfig } from "@/types/hintSettings.js";

export async function generateHint(
  question: string,
  answer: string,
  description?: string,
  images: string[] = [],
  override?: HintModelConfig,
  chatId?: number | string,
  threadId?: number,
): Promise<string> {
  const config = override ?? (await getHintSettings(chatId, threadId)).effective;
  return config.provider === "gemini"
    ? geminiHint(question, answer, description, images, config.model)
    : openrouterHint(question, answer, description, images, config.model);
}
export function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/API_KEY|API key|401|403/.test(message)) return "⚠️ Ошибка API ключа. Проверьте настройки.";
  if (/402|credits/.test(message))
    return "⚠️ Недостаточно токенов для подсказки. Думаем сами, знатоки.";
  if (/429|RESOURCE_EXHAUSTED|rate_limit/.test(message))
    return "⏳ Лимит запросов исчерпан. Попробуйте позже.";
  if (/503|UNAVAILABLE|TimeoutError|timed out/.test(message))
    return "⚠️ Сервис подсказок временно недоступен. Попробуйте позже.";
  if (/blocked|SAFETY/.test(message)) return "⚠️ Подсказка заблокирована фильтром безопасности.";
  return "⚠️ Не удалось создать подсказку. Думаем сами, знатоки.";
}
