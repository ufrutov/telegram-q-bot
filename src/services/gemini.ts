import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const SYSTEM_INSTRUCTION = `
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
`.trim();

interface GeminiTextPart {
  text: string;
}

interface GeminiInlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

type GeminiPart = GeminiTextPart | GeminiInlineDataPart;

interface GeminiContent {
  role: "user";
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiTextPart[];
  };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: {
    blockReason?: string;
  };
}

/** Cap on generated hint length. Hints are 2-4 sentences, so this is generous
 * headroom while keeping requests well inside the free-tier token budget. */
const HINT_MAX_OUTPUT_TOKENS = 500;

/** Fetch timeout for downloading question preview images before inlining them. */
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

/**
 * Guess a MIME type from a URL's file extension.
 * Falls back to image/jpeg, which covers the vast majority of
 * gotquestions.online / questions.chgk.info preview images.
 */
function guessMimeType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/**
 * Download a remote image and encode it as a base64 inlineData part.
 * Gemini's generateContent endpoint does not fetch arbitrary URLs itself
 * (unlike OpenRouter/OpenAI-style image_url inputs), so images must be
 * downloaded and embedded as bytes.
 *
 * Returns null on any failure — a single bad image should degrade the hint
 * (text-only) rather than fail the whole request.
 */
async function fetchImageAsInlineData(url: string): Promise<GeminiInlineDataPart | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        console.warn(`[Gemini] Failed to fetch image ${url}: HTTP ${response.status}`);
        return null;
      }
      const buffer = await response.arrayBuffer();
      const data = Buffer.from(buffer).toString("base64");
      const mimeType = response.headers.get("content-type") || guessMimeType(url);
      return { inlineData: { mimeType, data } };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Gemini] Error fetching image ${url}: ${message}`);
    return null;
  }
}

export async function generateHint(
  question: string,
  correctAnswer: string,
  description: string | undefined,
  questionPreview: string[] = [],
): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const parts: GeminiPart[] = [];

  if (questionPreview.length > 0) {
    parts.push({ text: "Question image(s):" });
    const inlineImages = await Promise.all(questionPreview.map(fetchImageAsInlineData));
    for (const image of inlineImages) {
      if (image) parts.push(image);
    }
  }

  parts.push({ text: `Question: ${question}\nCorrect Answer: ${correctAnswer}` });

  if (description) {
    parts.push({ text: `Description: ${description}` });
  }

  parts.push({
    text: "Write a helpful hint in Russian language. Important: Do NOT include the answer in your hint — give only a logical clue.",
  });

  const contents: GeminiContent[] = [{ role: "user", parts }];

  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents,
      generationConfig: {
        maxOutputTokens: HINT_MAX_OUTPUT_TOKENS,
        temperature: 0.7,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as GeminiResponse;

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned no message content");
  }
  return text;
}

export function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("GEMINI_API_KEY") ||
    message.includes("403") ||
    message.includes("API key")
  ) {
    return "⚠️ Ошибка API ключа. Проверьте настройки.";
  }
  if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
    return "⏳ Лимит запросов исчерпан. Попробуйте позже.";
  }
  if (message.includes("503") || message.includes("UNAVAILABLE")) {
    return "⚠️ Сервис Gemini временно недоступен. Попробуйте позже.";
  }
  if (message.includes("blocked") || message.includes("SAFETY")) {
    return "⚠️ Подсказка заблокирована фильтром безопасности.";
  }
  return "⚠️ Не удалось создать подсказку. Думаем сами, знатоки.";
}
