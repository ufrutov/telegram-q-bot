/**
 * Environment variable types
 */

export interface EnvConfig {
	TELEGRAM_BOT_TOKEN: string;
	REDIS_URL?: string;
	OPENROUTER_API_KEY?: string;
	CRON_TARGET_CHATS?: string;
	CRON_SECRET?: string;
	QUESTION_SOURCE?: string;
}

declare global {
	namespace NodeJS {
		interface ProcessEnv extends Partial<EnvConfig> {
			TELEGRAM_BOT_TOKEN?: string;
		}
	}
}

export {};
