import { z } from "zod";
import { getConnectedRedis } from "./redisConnection.js";
import { getSupabaseClient, TABLES } from "./supabase.js";
import type {
  HintModelConfig,
  HintSettings,
  HintProvider,
  HintModelOption,
  EffectiveHintConfig,
} from "@/types/hintSettings.js";

export const hintConfigSchema = z
  .object({
    provider: z.enum(["gemini", "openrouter"]),
    model: z.string().trim().min(1).max(180),
  })
  .strict()
  .superRefine((value, ctx) => {
    const pattern =
      value.provider === "gemini" ? /^gemini-[a-zA-Z0-9._-]+$/ : /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/;
    if (!pattern.test(value.model))
      ctx.addIssue({ code: "custom", message: "Invalid model identifier", path: ["model"] });
  });

export function environmentHintConfig(): HintModelConfig {
  const provider = process.env.HINT_PROVIDER === "openrouter" ? "openrouter" : "gemini";
  return {
    provider,
    model:
      provider === "gemini"
        ? process.env.GEMINI_MODEL || "gemini-3.5-flash"
        : process.env.OPENROUTER_HINT_MODEL || "openrouter/auto",
  };
}
export function hintProviders(): HintSettings["providers"] {
  return [
    { id: "gemini", label: "Gemini", configured: !!process.env.GEMINI_API_KEY },
    { id: "openrouter", label: "OpenRouter", configured: !!process.env.OPENROUTER_API_KEY },
  ];
}
interface StoredConfig {
  hint_provider: HintProvider | null;
  hint_model: string | null;
  thread_id?: number | null;
}
function config(row?: StoredConfig | null): HintModelConfig | null {
  return row?.hint_provider && row.hint_model
    ? { provider: row.hint_provider, model: row.hint_model }
    : null;
}
/** Read on every request so edits propagate across warm serverless functions. */
export async function getHintSettings(
  chatId?: number | string,
  threadId?: number,
  ignoreOwn = false,
): Promise<HintSettings> {
  const db = getSupabaseClient();
  const global = await readGlobalHintConfig();
  const flags = { overrideAll: global.overrideAll, globalStorage: !!process.env.REDIS_URL };
  let effective: EffectiveHintConfig = { ...environmentHintConfig(), source: "environment" };
  const bot = global.config;
  if (bot && !(ignoreOwn && chatId == null)) effective = { ...bot, source: "bot" };
  if (chatId == null) return { override: bot, effective, ...flags, providers: hintProviders() };
  if (!db) return { override: null, effective, ...flags, providers: hintProviders() };
  let query = db
    .from(TABLES.chats)
    .select("thread_id,hint_provider,hint_model")
    .eq("chat_id", Number(chatId));
  query =
    threadId == null
      ? query.is("thread_id", null)
      : query.or(`thread_id.is.null,thread_id.eq.${threadId}`);
  const rows = await query;
  if (rows.error) throw new Error("Could not load chat hint settings");
  const main = config(rows.data?.find((row) => row.thread_id == null));
  if (main && threadId != null && !global.overrideAll) effective = { ...main, source: "main-chat" };
  const own = config(rows.data?.find((row) => (row.thread_id ?? undefined) === threadId));
  if (own && !ignoreOwn && !global.overrideAll) effective = { ...own, source: "chat" };
  return { override: own, effective, ...flags, providers: hintProviders() };
}

const GLOBAL_KEY = "tq-bot:hint-settings";
const globalSchema = z.object({ config: hintConfigSchema.nullable(), overrideAll: z.boolean() });
async function readGlobalHintConfig(): Promise<z.infer<typeof globalSchema>> {
  const redis = await getConnectedRedis();
  if (!redis) return { config: null, overrideAll: false };
  const raw = await redis.get(GLOBAL_KEY);
  return raw ? globalSchema.parse(JSON.parse(raw)) : { config: null, overrideAll: false };
}
export async function saveGlobalHintConfig(
  value: HintModelConfig | null,
  overrideAll: boolean,
): Promise<void> {
  const redis = await getConnectedRedis();
  if (!redis) throw new Error("Configure REDIS_URL on the server to save global hint settings");
  await redis.set(GLOBAL_KEY, JSON.stringify({ config: value, overrideAll }));
}

const catalogs = new Map<HintProvider, { expires: number; models: HintModelOption[] }>();
/** Only text-generating, image-capable model families are offered for hints. */
export async function listHintModels(provider: HintProvider): Promise<HintModelOption[]> {
  if (!hintProviders().find((p) => p.id === provider)?.configured)
    throw new Error(`${provider} API key is not configured`);
  const cached = catalogs.get(provider);
  if (cached && cached.expires > Date.now()) return cached.models;
  const models: HintModelOption[] = [];
  if (provider === "gemini") {
    let page: string | undefined;
    const signal = AbortSignal.timeout(10000);
    for (let i = 0; i < 10; i++) {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("pageSize", "1000");
      if (page) url.searchParams.set("pageToken", page);
      const response = await fetch(url, {
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! },
        signal,
      });
      if (!response.ok) throw new Error("Could not load Gemini models. Check the server API key.");
      const data = (await response.json()) as {
        models?: Array<{
          name: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }>;
        nextPageToken?: string;
      };
      for (const model of data.models ?? []) {
        const id = model.name.replace(/^models\//, "");
        if (
          model.supportedGenerationMethods?.includes("generateContent") &&
          /^gemini-[\d.]+-(?:flash|pro)/.test(id) &&
          !/(?:image|tts|audio|live|robotics)/i.test(id)
        )
          models.push({ id, label: model.displayName || id });
      }
      page = data.nextPageToken;
      if (!page) break;
    }
  } else {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new Error("Could not load OpenRouter models. Check the server API key.");
    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        architecture?: { input_modalities?: string[]; output_modalities?: string[] };
      }>;
    };
    models.push({ id: "openrouter/auto", label: "OpenRouter Auto (automatic routing)" });
    for (const model of data.data ?? [])
      if (
        model.id !== "openrouter/auto" &&
        model.architecture?.input_modalities?.includes("image") &&
        model.architecture?.output_modalities?.includes("text")
      )
        models.push({ id: model.id, label: model.name || model.id });
  }
  const unique = [...new Map(models.map((model) => [model.id, model])).values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  catalogs.set(provider, { expires: Date.now() + 300_000, models: unique });
  return unique;
}
export async function validateHintConfig(value: HintModelConfig): Promise<void> {
  if (!(await listHintModels(value.provider)).some((model) => model.id === value.model))
    throw new Error("Select a supported model from the provider list");
}
