const ChgkInfoQuestionLoader = require("./ChgkInfoQuestionLoader");
const GotQuestionsOnlineLoader = require("./GotQuestionsOnlineLoader");

/**
 * QuestionLoader - Factory class for creating question loaders based on target
 * @param {string} [target="gotquestions.online"] - The target source for questions
 * @returns {BaseQuestionLoader} - An instance of the appropriate question loader
 */
function QuestionLoader(target = "gotquestions.online") {
	const loaderMap = {
		"questions.chgk.info": ChgkInfoQuestionLoader,
		"gotquestions.online": GotQuestionsOnlineLoader,
	};

	const LoaderClass = loaderMap[target];

	if (!LoaderClass) {
		throw new Error(
			`Unknown target: ${target}. Available targets: ${Object.keys(loaderMap).join(", ")}`
		);
	}

	return new LoaderClass();
}

module.exports = QuestionLoader;
