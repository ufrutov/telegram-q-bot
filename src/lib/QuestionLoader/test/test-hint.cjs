/**
 * Manual test — run with `node test-hint.cjs` from this directory after
 * `npm run build` at the project root.
 *
 * Requires: dist/src/lib/QuestionLoader/QuestionLoader.js and
 *           dist/src/services/openrouter.js must exist.
 */

const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../../../.env.local"),
});

async function main() {
  const { default: QuestionLoader } =
    await import("../../../../dist/src/lib/QuestionLoader/QuestionLoader.js");
  const { generateHint } = await import("../../../../dist/src/services/openrouter.js");

  console.log("Loading a random question from gotquestions.online…");
  const loader = QuestionLoader("gotquestions.online", "random");
  const question = await loader.loadQuestion();

  console.log("\n📝 Question:");
  console.log(question.question);
  console.log("\n✅ Answer:");
  console.log(question.answer);
  if (question.description) {
    console.log("\n💬 Description (first 200 chars):");
    console.log(
      question.description.slice(0, 200) + (question.description.length > 200 ? "…" : ""),
    );
  }
  if (question.questionPreview?.length) {
    console.log("\n🖼️ Preview images:", question.questionPreview);
  }
  console.log("\n--- Generating hint via OpenRouter ---");
  console.log(`model:       ${process.env.OPENROUTER_HINT_MODEL ?? "(default)"}`);
  const configuredMaxTokens = Number(process.env.OPENROUTER_HINT_MAX_TOKENS);
  const effectiveMaxTokens =
    Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
      ? Math.min(Math.floor(configuredMaxTokens), 30)
      : 30;
  console.log(`max_tokens:  ${effectiveMaxTokens}`);

  const hint = await generateHint(
    question.question ?? "",
    question.answer ?? "",
    question.description,
    question.questionPreview ?? [],
  );

  console.log("\n💡 Hint:");
  console.log(hint);
}

main().catch((error) => {
  console.error("✗ Failed:", error);
  process.exit(1);
});
