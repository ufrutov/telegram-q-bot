/**
 * Bot Constants - Centralized strings and configuration
 */
module.exports = {
	TARGET_DOMAIN: 'gotquestions.online',
	
	// Complexity emoji mapping
	COMPLEXITY_EMOJI: {
		'random': '🌀',
		'easy': '🎯',
		'medium': '💡',
		'hard': '🤯',
	},
	
	MESSAGES: {
		MENU_TITLE: '❓ Выбор категории вопроса:',
		DIFFICULTY_EASY: '🎯 Лёгкий вопрос',
		DIFFICULTY_MEDIUM: '💡 Стандартный вопрос',
		DIFFICULTY_HARD: '🤯 Сложный вопрос',
		DIFFICULTY_RANDOM: '🌀 Случайный вопрос',
		
		ANSWER_EXPIRED: '⏰ Время ответа истекло.\\nУвидеть ответ можно по ссылке ниже ↗️',
		HINT_EXPIRED: '⏰ Время подсказки истекло.',
		HINT_LOADING: '✨ Загружаю подсказку...',
		
		ERROR_LOADING_QUESTION: '❌ Ошибка при загрузке вопроса',
		ERROR_LOADING_ANSWER: '❌ Ошибка при загрузке ответа',
		ERROR_LOADING_HINT: '❌ Ошибка при загрузке подсказки',
	},
};
