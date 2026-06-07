/**
 * Manual test script — run with `node test-got-questions.cjs` from this directory
 * after `npm run build` at the project root.
 *
 * Requires: dist/lib/QuestionLoader/QuestionLoader.js and
 *           dist/services/openrouter.js must exist.
 */

const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../../../.env.local"),
});

async function main() {
  const { default: QuestionLoader } =
    await import("../../../../dist/src/lib/QuestionLoader/QuestionLoader.js");
  const { generateHint, formatErrorMessage } =
    await import("../../../../dist/src/services/openrouter.js");

  async function testComplexity(complexity) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Testing complexity: ${complexity.toUpperCase()}`);
    console.log("=".repeat(80));

    const loader = QuestionLoader("gotquestions.online", complexity);

    try {
      const question = await loader.loadQuestion();

      console.log("\n📝 Question:");
      console.log(question.question);

      console.log("\n✅ Answer:");
      console.log(question.answer);

      if (["hard"].includes(complexity)) {
        try {
          const hint = await generateHint(question.question, question.answer, question.description);
          console.log("\n💡 Hint:");
          console.log(hint);
        } catch (hintError) {
          console.log("\n💡 Hint:");
          console.log(formatErrorMessage(hintError));
        }
      }

      if (question.description) {
        console.log("\n💬 Description:");
        console.log(question.description);
      }

      if (question.questionPreview && question.questionPreview.length > 0) {
        console.log("\n🖼️ Question Images:");
        question.questionPreview.forEach((img, idx) => {
          console.log(`  ${idx + 1}. ${img}`);
        });
      }

      if (question.answerPreview && question.answerPreview.length > 0) {
        console.log("\n🖼️ Answer Images:");
        question.answerPreview.forEach((img, idx) => {
          console.log(`  ${idx + 1}. ${img}`);
        });
      }
    } catch (error) {
      console.error(`✗ Failed:`, error.message);
    }
  }

  console.log("Testing GotQuestionsOnlineLoader with 4 complexity ranges...\n");

  const complexities = ["random", "easy", "medium", "hard"];
  for (const complexity of complexities) {
    await testComplexity(complexity);
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("All tests completed!");
  console.log("=".repeat(80));
}

main();
