const QuestionLoader = require("../QuestionLoader");

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

async function testGotQuestionsOnline() {
	console.log("Testing GotQuestionsOnlineLoader with 4 complexity ranges...\n");

	const complexities = ["random", "easy", "medium", "hard"];

	for (const complexity of complexities) {
		await testComplexity(complexity);
	}

	console.log(`\n${"=".repeat(80)}`);
	console.log("All tests completed!");
	console.log("=".repeat(80));
}

testGotQuestionsOnline();
