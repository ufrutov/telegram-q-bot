/** Dashboard API. Every authenticated Supabase user has access. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { getSupabaseClient, TABLES } from "@/services/supabase.js";
import type { DashboardChat } from "@/types/dashboard.js";
import { getBotClient } from "@/bot/botClient.js";
import QuestionLoader from "@/lib/QuestionLoader/QuestionLoader.js";
import {
  dashboardRedis,
  loadDashboardQuestion,
  deliverDashboardQuestion,
  dashboardDeliveryDependencies,
} from "@/services/dashboardQuestionDelivery.js";

type ChatCountRow = DashboardChat &
  Record<"loaded" | "answered" | "hints", Array<{ count: number }>>;

const querySchema = z.object({
  resource: z
    .enum(["overview", "chats", "chat", "questions", "question", "send-question"])
    .default("chats"),
  chatId: z.uuid().optional(),
  sendId: z
    .string()
    .regex(/^\d{1,15}$/)
    .optional(),
  page: z.coerce.number().int().min(0).max(10000).default(0),
  search: z.string().trim().max(100).default(""),
  active: z.enum(["all", "true", "false"]).default("all"),
  cron: z.enum(["all", "true", "false"]).default("all"),
  sort: z.enum(["created_at", "title", "cron_last_sent_at"]).default("created_at"),
  cursor: z.string().max(500).optional(),
});
const cursorSchema = z.object({
  created_at: z.iso.datetime({ offset: true }),
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const mutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("toggle"),
      field: z.enum(["cron_enabled", "commands_enabled", "answer_buttons_enabled", "hint_enabled"]),
      enabled: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal("delete"), confirmChatId: z.string().regex(/^-?\d+$/) }).strict(),
]);
const complexitySchema = z.enum(["random", "easy", "medium", "hard"]);
const questionIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}$/)
  .transform((value) => value.replace(/^0+(?=\d)/, ""));
const sendQuestionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("load"),
      questionId: questionIdSchema.optional(),
      complexity: complexitySchema.default("random"),
    })
    .strict(),
  z
    .object({
      action: z.literal("send"),
      questionId: questionIdSchema,
      complexity: complexitySchema,
      draftId: z.uuid(),
      chatIds: z
        .array(z.uuid())
        .min(1)
        .max(10)
        .refine((ids) => new Set(ids).size === ids.length, "Recipients must be unique"),
    })
    .strict(),
]);
const PAGE_SIZE = 25;
const CHAT_COLUMNS =
  "id,chat_id,thread_id,title,timezone,is_active,cron_enabled,cron_time,cron_last_sent_at,commands_enabled,answer_buttons_enabled,hint_enabled,created_at,updated_at";
const QUESTION_COLUMNS =
  "id,question_id,telegram_message_id,complexity,hint_asked,hint_failed,hint_at,question_answered,created_at";

export default async function dashboard(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method ?? "")) {
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Sign in to view the dashboard" });
    return;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    res.status(503).json({ error: "Dashboard database is not configured" });
    return;
  }

  try {
    // Explicit token verification does not sign in or mutate the shared service client.
    const { data: identity, error: authError } = await supabase.auth.getUser(token);
    if (authError || !identity.user) {
      res
        .status(authError && (authError.status ?? 0) >= 500 ? 503 : 401)
        .json({ error: "Unable to verify your session. Please sign in again." });
      return;
    }
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid dashboard query" });
      return;
    }
    const query = parsed.data;
    if (query.resource === "send-question") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        res.status(405).json({ error: "Use POST for question loading and delivery" });
        return;
      }
      const parsedBody = sendQuestionSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res
          .status(400)
          .json({ error: "Provide a valid question ID and select up to 10 unique chats" });
        return;
      }
      const body = parsedBody.data;
      if (body.action === "load") {
        try {
          const redis = await dashboardRedis();
          const question = await loadDashboardQuestion(body.questionId, body.complexity, redis);
          const formatted = QuestionLoader(
            "gotquestions.online",
            body.complexity,
          ).formatForTelegram(question, true, body.complexity);
          res.status(200).json({
            id: String(question.id),
            complexity: body.complexity,
            question: formatted.question,
            answer: formatted.answer,
            attachments: question.questionPreview?.length ?? 0,
            sourceUrl: `https://gotquestions.online/question/${question.id}`,
          });
          return;
        } catch (error) {
          console.error(
            "[dashboard] question preview failed:",
            error instanceof Error ? error.message : String(error),
          );
          res
            .status(502)
            .json({ error: "Could not load the question. Check the ID and try again." });
        }
        return;
      }
      const bot = getBotClient();
      if (!bot) {
        res.status(503).json({ error: "Telegram bot is not configured" });
        return;
      }
      const { data: recipients, error } = await supabase
        .from(TABLES.chats)
        .select(CHAT_COLUMNS)
        .in("id", body.chatIds)
        .overrideTypes<DashboardChat[], { merge: false }>();
      if (error) throw error;
      if (!recipients || recipients.length !== body.chatIds.length) {
        res
          .status(400)
          .json({ error: "One or more selected chats no longer exist. Refresh the chat list." });
        return;
      }
      const recipientMap = new Map(recipients.map((chat) => [chat.id, chat]));
      const chats = body.chatIds.map((id) => recipientMap.get(id)!);
      const redis = await dashboardRedis();
      const results = await deliverDashboardQuestion(
        identity.user.id,
        body.draftId,
        body.questionId,
        body.complexity,
        chats,
        redis,
        dashboardDeliveryDependencies(bot, body.questionId, body.complexity, redis),
      );
      res.status(200).json({ questionId: body.questionId, results });
      return;
    }
    if (req.method === "POST") {
      res.status(405).json({ error: "POST is only available for question loading and delivery" });
      return;
    }
    if (req.method !== "GET") {
      if (query.resource !== "chat" || !query.chatId) {
        res.status(400).json({ error: "A chat row ID is required" });
        return;
      }
      const body = mutationSchema.safeParse(req.body);
      if (!body.success || (req.method === "PATCH") !== (body.data.action === "toggle")) {
        res.status(400).json({ error: "Invalid chat action" });
        return;
      }
      if (body.data.action === "toggle") {
        const { data, error } = await supabase
          .from(TABLES.chats)
          .update({ [body.data.field]: body.data.enabled, updated_at: new Date().toISOString() })
          .eq("id", query.chatId)
          .select(CHAT_COLUMNS)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          res.status(404).json({ error: "Chat not found" });
          return;
        }
        res.status(200).json({ chat: data });
        return;
      }
      // Match both identifiers atomically, including the explicit deletion confirmation.
      // FK cascades delete question sends and load failures for this row only.
      const { data, error } = await supabase
        .from(TABLES.chats)
        .delete()
        .eq("id", query.chatId)
        .eq("chat_id", body.data.confirmChatId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        res.status(404).json({ error: "Chat not found or confirmation did not match" });
        return;
      }
      res.status(200).json({ deleted: true });
      return;
    }
    if (query.resource === "overview") {
      const sends = () =>
        supabase
          .from(TABLES.questionSends)
          .select("id", { count: "exact", head: true })
          .eq("is_integration_test", false);
      const [chats, scheduled, questions, answered, scheduledChats, recent] = await Promise.all([
        supabase.from(TABLES.chats).select("id", { count: "exact", head: true }),
        supabase
          .from(TABLES.chats)
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .eq("cron_enabled", true),
        sends(),
        sends().eq("question_answered", true),
        supabase
          .from(TABLES.chats)
          .select(CHAT_COLUMNS)
          .eq("is_active", true)
          .eq("cron_enabled", true)
          .order("cron_last_sent_at", { ascending: false, nullsFirst: false })
          .limit(5),
        supabase
          .from(TABLES.questionSends)
          .select(`${QUESTION_COLUMNS},chat_id`)
          .eq("is_integration_test", false)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(6),
      ]);
      for (const result of [chats, scheduled, questions, answered, scheduledChats, recent])
        if (result.error) throw result.error;
      const ids = [...new Set((recent.data ?? []).map((row) => row.chat_id))];
      const related = ids.length
        ? await supabase
            .from(TABLES.chats)
            .select("id,title,chat_id,thread_id,timezone")
            .in("id", ids)
        : { data: [], error: null };
      if (related.error) throw related.error;
      const chatMap = new Map((related.data ?? []).map((row) => [row.id, row]));
      res.status(200).json({
        counts: {
          chats: chats.count ?? 0,
          scheduled: scheduled.count ?? 0,
          questions: questions.count ?? 0,
          answered: answered.count ?? 0,
        },
        scheduledChats: scheduledChats.data ?? [],
        recentQuestions: (recent.data ?? []).map((row) => {
          const chat = chatMap.get(row.chat_id);
          const { chat_id: chatRowId, ...question } = row;
          return {
            ...question,
            chatRowId,
            chatTitle: chat?.title || (chat ? `Chat ${chat.chat_id}` : "Unknown chat"),
            chatTimezone: chat?.timezone || "UTC",
          };
        }),
      });
      return;
    }
    if (query.resource === "chats") {
      // Embedded counts are aggregated in Postgres in the same paginated request.
      // Default left joins retain chats with no sends; each alias has its own filters.
      let request = supabase
        .from(TABLES.chats)
        .select(
          `${CHAT_COLUMNS},loaded:${TABLES.questionSends}(count),answered:${TABLES.questionSends}(count),hints:${TABLES.questionSends}(count)`,
          { count: "exact" },
        )
        .eq("loaded.is_integration_test", false)
        .eq("answered.is_integration_test", false)
        .eq("answered.question_answered", true)
        .eq("hints.is_integration_test", false)
        .eq("hints.hint_asked", true);
      if (query.active !== "all") request = request.eq("is_active", query.active === "true");
      if (query.cron !== "all") request = request.eq("cron_enabled", query.cron === "true");
      if (query.search) {
        // Never interpolate arbitrary input into PostgREST's filter grammar.
        const search = query.search.replace(/[^\p{L}\p{N}\s_-]/gu, "").trim();
        if (search) {
          request = /^-?\d+$/.test(search)
            ? request.eq("chat_id", search)
            : request.ilike("title", `%${search}%`);
        } else {
          res.status(200).json({ items: [], total: 0, page: query.page, pageSize: PAGE_SIZE });
          return;
        }
      }
      const { data, error, count } = await request
        .order(query.sort, { ascending: query.sort === "title", nullsFirst: false })
        .order("id", { ascending: false })
        .range(query.page * PAGE_SIZE, (query.page + 1) * PAGE_SIZE - 1)
        .overrideTypes<ChatCountRow[], { merge: false }>();
      if (error) throw error;
      const items = (data ?? []).map(({ loaded, answered, hints, ...chat }) => ({
        ...chat,
        counts: {
          loaded: Number(loaded?.[0]?.count ?? 0),
          answered: Number(answered?.[0]?.count ?? 0),
          hints: Number(hints?.[0]?.count ?? 0),
        },
      }));
      res.status(200).json({ items, total: count ?? 0, page: query.page, pageSize: PAGE_SIZE });
      return;
    }
    if (query.resource === "question") {
      if (!query.sendId || !query.chatId) {
        res.status(400).json({ error: "Chat and question send IDs are required" });
        return;
      }
      const { data, error } = await supabase
        .from(TABLES.questionSends)
        .select("hint_payload,answer_payload")
        .eq("id", query.sendId)
        .eq("chat_id", query.chatId)
        .eq("is_integration_test", false)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        res.status(404).json({ error: "Question send not found" });
        return;
      }
      const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
      res.status(200).json({
        question: text(data.hint_payload?.question),
        answer: text(data.answer_payload?.answer),
        description: text(data.hint_payload?.description),
      });
      return;
    }
    if (!query.chatId) {
      res.status(400).json({ error: "Chat ID is required" });
      return;
    }
    const { data: chat, error: chatError } = await supabase
      .from(TABLES.chats)
      .select(CHAT_COLUMNS)
      .eq("id", query.chatId)
      .maybeSingle();
    if (chatError) throw chatError;
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }
    if (query.resource === "chat") {
      const countBase = () =>
        supabase
          .from(TABLES.questionSends)
          .select("id", { count: "exact", head: true })
          .eq("chat_id", query.chatId!)
          .eq("is_integration_test", false);
      const groupQuery =
        chat.thread_id == null
          ? Promise.resolve({ data: chat, error: null })
          : supabase
              .from(TABLES.chats)
              .select("commands_enabled,answer_buttons_enabled,hint_enabled")
              .eq("chat_id", chat.chat_id)
              .is("thread_id", null)
              .maybeSingle();
      const [loaded, answered, hints, group] = await Promise.all([
        countBase(),
        countBase().eq("question_answered", true),
        countBase().eq("hint_asked", true),
        groupQuery,
      ]);
      for (const result of [loaded, answered, hints, group]) if (result.error) throw result.error;
      res.status(200).json({
        chat,
        effectiveSettings: {
          hint_enabled: chat.hint_enabled && group.data?.hint_enabled !== false,
          commands_enabled: chat.commands_enabled && group.data?.commands_enabled !== false,
          answer_buttons_enabled:
            chat.answer_buttons_enabled && group.data?.answer_buttons_enabled !== false,
        },
        counts: {
          loaded: loaded.count ?? 0,
          answered: answered.count ?? 0,
          hints: hints.count ?? 0,
        },
      });
      return;
    }
    let request = supabase
      .from(TABLES.questionSends)
      // Project only question text; answer payloads remain lazy-loaded on expansion.
      .select(`${QUESTION_COLUMNS},question:hint_payload->>question`)
      .eq("chat_id", query.chatId)
      .eq("is_integration_test", false);
    if (query.cursor) {
      let cursor;
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")),
        );
      } catch {
        res.status(400).json({ error: "Invalid history cursor" });
        return;
      }
      request = request.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await request
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE + 1);
    if (error) throw error;
    const items = (data ?? []).slice(0, PAGE_SIZE);
    const last = items.at(-1);
    res.status(200).json({
      items,
      nextCursor:
        data && data.length > PAGE_SIZE && last
          ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString(
              "base64url",
            )
          : null,
    });
  } catch (error) {
    console.error("[dashboard] request failed:", error instanceof Error ? error.message : error);
    res.status(503).json({ error: "Dashboard data is temporarily unavailable. Try again." });
  }
}
