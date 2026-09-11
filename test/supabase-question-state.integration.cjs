/**
 * Integration test for durable answer/hint callback state.
 *
 * Run with dedicated disposable Supabase credentials only:
 *   SUPABASE_TEST_URL=... SUPABASE_TEST_SERVICE_ROLE_KEY=... npm run test:integration
 *
 * The test is skipped unless both variables are present. It deliberately does
 * not fall back to SUPABASE_URL, preventing accidental writes to production.
 */

const path = require("path");
const { randomInt } = require("crypto");
const { createClient } = require("@supabase/supabase-js");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env.local"),
});

const testUrl = process.env.SUPABASE_TEST_URL;
const testKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

if (!testUrl || !testKey) {
  console.log(
    "Skipping Supabase integration test: SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_ROLE_KEY are required.",
  );
  process.exit(0);
}

process.env.SUPABASE_URL = testUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = testKey;

const chatId = 8_000_000_000_000 + randomInt(1_000_000_000);
const telegramMessageId = randomInt(1_000_000_000);
const supabase = createClient(testUrl, testKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { recordQuestionSent, getQuestionSendContext } =
    await import("../dist/src/services/questionSendStore.js");

  try {
    await recordQuestionSent({
      chatId,
      threadId: undefined,
      title: "Supabase integration test",
      telegramMessageId,
      questionId: "integration-test-question",
      complexity: "random",
      answerPayload: {
        answer: "Тестовый ответ",
        answerPreview: ["https://example.com/answer.jpg"],
        packId: "test-pack",
      },
      hintPayload: {
        question: "Тестовый вопрос",
        answer: "Тестовый ответ",
        description: "Тестовый комментарий",
        questionPreview: ["https://example.com/question.jpg"],
      },
    });

    const context = await getQuestionSendContext(chatId, undefined, telegramMessageId);
    if (!context) throw new Error("Question-send context was not persisted");
    if (context.answerPayload.answer !== "Тестовый ответ") {
      throw new Error("Answer payload did not round-trip");
    }
    if (context.hintPayload.question !== "Тестовый вопрос") {
      throw new Error("Hint payload did not round-trip");
    }
    if (context.answerPayload.packId !== "test-pack") {
      throw new Error("Answer menu pack ID did not round-trip");
    }

    console.log("✓ Supabase question callback state persisted and loaded successfully.");
  } finally {
    const { error } = await supabase.from("tq-bot-chats").delete().eq("chat_id", chatId);
    if (error) {
      console.error("Failed to clean up integration-test chat:", error.message);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error("✗ Supabase integration test failed:", error);
  process.exitCode = 1;
});
