require("dotenv").config({ path: ".env.local" });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const SYSTEM_INSTRUCTION = `
You are an expert question master for "What Where When" (Что Где Когда) — 
the intellectual team trivia format where players deduce answers through logic, 
not memory alone.

When given a question and its correct answer, craft a hint that follows the 
spirit of the game:

CORE PHILOSOPHY:
- The answer must be DERIVABLE — the hint should give the team a logical path 
  to reach the answer themselves
- Never give the answer away; give a key that unlocks the reasoning
- Great hints in this format often involve etymology, historical context, 
  an unexpected connection, or a lateral thinking nudge

RULES:
- NEVER state or strongly imply the answer
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
Return only the hint text. Plain prose. No labels, no markdown.
`.trim();

async function generateHint(question, correctAnswer, description) {
	let userContent = `Question: ${question}\nCorrect Answer: ${correctAnswer}`;
	if (description) {
		userContent += `\nDescription: ${description}`;
	}
	userContent += `\n\nWrite a helpful hint in Russian language.`;

	const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${OPENROUTER_API_KEY}`,
			"Content-Type": "application/json",
			"HTTP-Referer": "https://telegram-q-bot.vercel.app",
			"X-Title": "Telegram Q Bot",
		},
		body: JSON.stringify({
			model: "openrouter/auto",
			messages: [
				{ role: "system", content: SYSTEM_INSTRUCTION },
				{ role: "user", content: userContent },
			],
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		const errorMsg = `OpenRouter API error: ${response.status} - ${errorText}`;
		throw new Error(errorMsg);
	}

	const data = await response.json();
	return data.choices[0].message.content;
}

function formatErrorMessage(error) {
	if (error.message && (error.message.includes("401") || error.message.includes("API key"))) {
		return "⚠️ Ошибка API ключа. Проверьте настройки.";
	}
	if (error.message && error.message.includes("429")) {
		return "⏳ Лимит запросов исчерпан. Попробуйте позже.";
	}
	if (error.message && error.message.includes("rate_limit")) {
		return "⏳ Лимит запросов исчерпан. Попробуйте позже.";
	}
	return "⚠️ Не удалось создать подсказку. Попробуйте позже.";
}

module.exports = { generateHint, formatErrorMessage };