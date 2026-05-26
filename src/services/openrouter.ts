/**
 * OpenRouter AI Hint Generation Service
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_REFERER = process.env.VERCEL_URL
	? `https://${process.env.VERCEL_URL}`
	: 'https://telegram-q-bot.vercel.app';

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

interface MessageContent {
	type: 'text' | 'image_url';
	text?: string;
	image_url?: { url: string };
}

interface OpenRouterResponse {
	choices: Array<{
		message: {
			content: string;
		};
	}>;
}

/**
 * Generate AI hint for a question
 * @param question - The question text
 * @param correctAnswer - The correct answer
 * @param description - Optional description/commentary
 * @param questionImages - Optional question images
 * @returns Generated hint text
 */
export async function generateHint(
	question: string,
	correctAnswer: string,
	description?: string,
	questionImages: string[] = [],
): Promise<string> {
	const userContent: MessageContent[] = [];

	if (questionImages && questionImages.length > 0) {
		userContent.push({
			type: 'text',
			text: 'Question image(s):',
		});
		for (const imageUrl of questionImages) {
			userContent.push({
				type: 'image_url',
				image_url: { url: imageUrl },
			});
		}
	}

	userContent.push({
		type: 'text',
		text: `Question: ${question}\nCorrect Answer: ${correctAnswer}`,
	});

	if (description) {
		userContent.push({
			type: 'text',
			text: `Description: ${description}`,
		});
	}

	userContent.push({
		type: 'text',
		text: 'Write a helpful hint in Russian language. Important: Do NOT include the answer in your hint — give only a logical clue.',
	});

	// Add timeout to prevent function timeout
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 second timeout

	try {
		const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPENROUTER_API_KEY}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': OPENROUTER_REFERER,
				'X-Title': 'Telegram Q Bot',
			},
			body: JSON.stringify({
				model: 'openrouter/auto',
				messages: [
					{ role: 'system', content: SYSTEM_INSTRUCTION },
					{ role: 'user', content: userContent },
				],
			}),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const errorText = await response.text();
			const errorMsg = `OpenRouter API error: ${response.status} - ${errorText}`;
			throw new Error(errorMsg);
		}

		const data = (await response.json()) as OpenRouterResponse;
		return data.choices[0].message.content;
	} catch (error) {
		clearTimeout(timeoutId);
		throw error;
	}
}

/**
 * Format error message for users
 */
export function formatErrorMessage(error: unknown): string {
	const errorMessage = error instanceof Error ? error.message : '';

	if (errorMessage.includes('401') || errorMessage.includes('API key')) {
		return '⚠️ Ошибка API ключа. Проверьте настройки.';
	}
	if (errorMessage.includes('429') || errorMessage.includes('rate_limit')) {
		return '⏳ Лимит запросов исчерпан. Попробуйте позже.';
	}
	if (errorMessage.includes('abort')) {
		return '⏳ Превышено время ожидания. Попробуйте позже.';
	}
	return '⚠️ Не удалось создать подсказку. Попробуйте позже.';
}
