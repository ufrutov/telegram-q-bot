import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
// `:free` model variants are promotional capacity and can disappear without
// notice. Let OpenRouter select from its maintained model pool by default;
// deployments can still pin a model through OPENROUTER_HINT_MODEL when needed.
const OPENROUTER_HINT_MODEL = process.env.OPENROUTER_HINT_MODEL ?? "openrouter/auto";
const DEFAULT_HINT_MAX_TOKENS = 20;
const MAX_HINT_MAX_TOKENS = 30;
const configuredHintMaxTokens = Number(process.env.OPENROUTER_HINT_MAX_TOKENS);
// Keep the reservation small enough for low-credit OpenRouter accounts. A
// caller may choose a smaller value, but must not accidentally reserve more.
const HINT_MAX_TOKENS =
  Number.isFinite(configuredHintMaxTokens) && configuredHintMaxTokens > 0
    ? Math.min(Math.floor(configuredHintMaxTokens), MAX_HINT_MAX_TOKENS)
    : DEFAULT_HINT_MAX_TOKENS;

// The prompt is kept at a hard minimum so the whole request fits the small
// per-provider credit budgets of low-balance OpenRouter accounts. The
// description is intentionally omitted: it is the largest token block and
// often paraphrases the answer (leak risk). The completion is bounded to a
// word count that fits the 20-token budget without truncation.
const SYSTEM_INSTRUCTION = `
Give a Russian hint for the question. One short sentence, at most 10 words.
Never reveal the answer or a synonym of it.
`.trim();

// Hints sometimes arrive prefixed with a label (e.g. "Подсказка: ...") or a
// stray colon; strip them so only the hint text is shown.
const HINT_LABEL_PREFIX = /^\s*(?:Подсказка|Подсказка\s*[:\-–]|Hint\s*[:\-–])+/i;
const HINT_STRAY_COLON = /^\s*[:：]\s*/;

/*
Previous extended instruction, retained for use when the completion budget is
raised above the low-credit 30-token limit:

You are an expert question master for "What Where When" (Что Где Когда) —
the intellectual team trivia format where players deduce answers through logic,
not memory alone.

When given a question and its correct answer, craft a hint that follows the
spirit of the game:

CORE PHILOSOPHY:
- The answer must be DERIVABLE — the hint should give the team a logical path
  to reach the answer themselves
- NEVER give the answer away in any form — do NOT use synonyms, partial answers,
  or any text that could hint at the solution
- Great hints in this format often involve etymology, historical context,
  an unexpected connection, or a lateral thinking nudge

RULES:
- NEVER state or imply the answer in any way — no words from the answer,
  no synonyms, no partial matches
- Reveal one hidden connection, origin, or logical bridge that makes the
  answer deducible
- Prioritize: etymology > historical analogy > categorical logic > wordplay
- Length: 2–4 sentences
- The hint should make a smart person say "I should be able to get this now"
- Use precise, intellectual language — this audience appreciates accuracy

HINT STRUCTURE (internal guide, don't output these labels):
  1. Reframe the question from a different angle
  2. Offer the key logical or etymological bridge
  3. (Optional) Add a narrowing constraint

TONE:
- Intellectual, precise, respectful of the player's intelligence
- Elegant — no unnecessary words
- Neutral — not playful like trivia, not warm like a teacher. Think: chess clock.
- Write hints in RUSSIAN language

OUTPUT FORMAT:
- Return ONLY the hint text as plain prose
- NO labels, NO markdown, NO answer references
- DO NOT include words like "ответ", "ответ:", "это", or any hint to the answer
*/

interface OpenRouterTextContent {
  type: "text";
  text: string;
}

interface OpenRouterImageContent {
  type: "image_url";
  image_url: { url: string };
}

type OpenRouterUserContent = OpenRouterTextContent | OpenRouterImageContent;

interface OpenRouterMessage {
  role: "system" | "user";
  content: string | OpenRouterUserContent[];
}

interface OpenRouterChoice {
  message: { content: string };
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
}

export async function generateHint(
  question: string,
  correctAnswer: string,
  description: string | undefined,
  questionPreview: string[] = [],
): Promise<string> {
  const questionText = question.slice(0, 220);
  const answerText = correctAnswer.slice(0, 60);

  const userContent: OpenRouterUserContent[] = [];

  if (questionPreview && questionPreview.length > 0) {
    userContent.push({
      type: "text",
      text: "Question image(s):",
    });
    for (const imageUrl of questionPreview) {
      userContent.push({
        type: "image_url",
        image_url: { url: imageUrl },
      });
    }
  }

  userContent.push({
    type: "text",
    text: `Question: ${questionText}\nCorrect Answer: ${answerText}`,
  });

  const messages: OpenRouterMessage[] = [
    { role: "system", content: SYSTEM_INSTRUCTION },
    { role: "user", content: userContent },
  ];

  // The auto router may pick a model that mandates reasoning (rejects
  // `effort: "none"` with 400) or one where disabling reasoning keeps the
  // request affordable. Try `none` first, then retry with low effort only
  // when the provider explicitly requires reasoning.
  const basePayload = {
    model: OPENROUTER_HINT_MODEL,
    messages,
    max_tokens: HINT_MAX_TOKENS,
    temperature: 0.7,
  };
  let response: Response | null = null;
  let lastError: string | null = null;
  for (const reasoning of [{ effort: "none" }, { effort: "low" }]) {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://telegram-q-bot.vercel.app",
        "X-Title": "Telegram Q Bot",
      },
      body: JSON.stringify({ ...basePayload, reasoning }),
    });
    if (response.ok) {
      break;
    }
    const errorText = await response.text();
    lastError = `${response.status} - ${errorText}`;
    // Only reasoning-required providers are worth a second attempt.
    if (!(response.status === 400 && /reasoning is mandatory/i.test(errorText))) {
      response = null;
      break;
    }
    response = null;
  }

  if (!response) {
    throw new Error(`OpenRouter API error: ${lastError}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  const content = data.choices[0]?.message.content;
  const hint = content?.trim().replace(HINT_LABEL_PREFIX, "").replace(HINT_STRAY_COLON, "").trim();
  if (!hint) {
    throw new Error("OpenRouter returned no message content");
  }
  return hint;
}

export function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("401") || message.includes("API key")) {
    return "⚠️ Ошибка API ключа. Проверьте настройки.";
  }
  if (message.includes("402") || message.includes("credits")) {
    return "⚠️ Недостаточно токенов для подсказки. Думаем сами, знатоки.";
  }
  if (message.includes("429")) {
    return "⏳ Лимит запросов исчерпан. Попробуйте позже.";
  }
  if (message.includes("rate_limit")) {
    return "⏳ Лимит запросов исчерпан. Попробуйте позже.";
  }
  return "⚠️ Не удалось загрузить подсказку. Думаем сами, знатоки.";
}
