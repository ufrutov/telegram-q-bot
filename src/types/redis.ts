import { RedisClientType } from 'redis';

/**
 * Redis types
 */

export type RedisClient = RedisClientType | null;

export interface RedisKeyPair {
	answerKey: string;
	hintKey: string;
}

export const REDIS_TTL = 86400; // 24 hours in seconds
