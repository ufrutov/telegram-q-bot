const QuestionLoader = require("../QuestionLoader");

async function testBothLoaders() {
	console.log("Testing ChgkInfoQuestionLoader...");
	try {
		const chgkLoader = QuestionLoader("questions.chgk.info");
		const chgkQuestion = await chgkLoader.loadQuestion();
		console.log("✓ ChgkInfoQuestionLoader works!");
		console.log("Sample question:", chgkQuestion.question?.substring(0, 100));
		console.log("Has answer:", !!chgkQuestion.answer);
		console.log("Has description:", !!chgkQuestion.description);
		console.log("Has preview:", !!chgkQuestion.preview);
		console.log();
	} catch (error) {
		console.error("✗ ChgkInfoQuestionLoader failed:", error.message);
	}

	console.log("Testing GotQuestionsOnlineLoader...");
	try {
		const gotLoader = QuestionLoader("gotquestions.online");
		const gotQuestion = await gotLoader.loadQuestion();
		console.log("✓ GotQuestionsOnlineLoader works!");
		console.log("Sample question:", gotQuestion.question?.substring(0, 100));
		console.log("Has answer:", !!gotQuestion.answer);
		console.log("Has description:", !!gotQuestion.description);
		console.log("Has preview:", !!gotQuestion.preview);
		console.log();
		console.log("Full question data:");
		console.log(JSON.stringify(gotQuestion, null, 2));
	} catch (error) {
		console.error("✗ GotQuestionsOnlineLoader failed:", error.message);
	}
}

testBothLoaders();
