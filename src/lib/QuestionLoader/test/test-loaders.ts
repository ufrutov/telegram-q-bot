import { createQuestionLoader, QuestionSource } from '../QuestionLoader';

async function testBothLoaders() {
	console.log('Testing ChgkInfoQuestionLoader...');
	try {
		const chgkLoader = createQuestionLoader('questions.chgk.info' as QuestionSource);
		const chgkQuestion = await chgkLoader.loadQuestion();
		console.log('✓ ChgkInfoQuestionLoader works!');
		console.log('Sample question:', chgkQuestion.question?.substring(0, 100));
		console.log('Has answer:', !!chgkQuestion.answer);
		console.log('Has description:', !!chgkQuestion.description);
		console.log('Has preview:', !!chgkQuestion.preview);
		console.log();
	} catch (error) {
		console.error('✗ ChgkInfoQuestionLoader failed:', (error as Error).message);
	}

	console.log('Testing GotQuestionsOnlineLoader...');
	try {
		const gotLoader = createQuestionLoader('gotquestions.online' as QuestionSource);
		const gotQuestion = await gotLoader.loadQuestion();
		console.log('✓ GotQuestionsOnlineLoader works!');
		console.log('Sample question:', gotQuestion.question?.substring(0, 100));
		console.log('Has answer:', !!gotQuestion.answer);
		console.log('Has description:', !!gotQuestion.description);
		console.log('Has preview:', !!gotQuestion.preview);
		console.log();
		console.log('Full question data:');
		console.log(JSON.stringify(gotQuestion, null, 2));
	} catch (error) {
		console.error('✗ GotQuestionsOnlineLoader failed:', (error as Error).message);
	}
}

testBothLoaders();
