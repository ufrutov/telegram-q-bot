const QuestionLoader = require("../QuestionLoader");

async function testGotQuestionsOnline() {
	console.log("Testing GotQuestionsOnlineLoader with multiple samples...\n");

	const loader = QuestionLoader("gotquestions.online");

	for (let i = 1; i <= 3; i++) {
		console.log(`\n=== Sample ${i} ===`);
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
			console.log("\n" + "=".repeat(80));
		} catch (error) {
			console.error(`✗ Sample ${i} failed:`, error.message);
		}
	}
}

testGotQuestionsOnline();
