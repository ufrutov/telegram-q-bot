const ChgkInfoQuestionLoader = require("./ChgkInfoQuestionLoader");
const GotQuestionsOnlineLoader = require("./GotQuestionsOnlineLoader");

/**
 * QuestionLoader - Factory class for creating question loaders based on target
 * @param {string} [target="gotquestions.online"] - The target source for questions
 * @param {string} [complexity="random"] - The complexity level (random, easy, medium, hard)
 * @returns {BaseQuestionLoader} - An instance of the appropriate question loader
 */
function QuestionLoader(target = "gotquestions.online", complexity = "random") {
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

	return new LoaderClass(complexity);
}

module.exports = QuestionLoader;
