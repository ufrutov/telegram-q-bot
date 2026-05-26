/**
 * Redis utility functions
 */

import { RedisClient } from '@app-types/redis';

/**
 * Safely connect to Redis with error handling
 */
export async function ensureRedisConnected(client: RedisClient): Promise<void> {
	if (client && !client.isOpen) {
		try {
			await client.connect();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			console.error('Failed to connect to Redis:', errorMessage);
			// Don't throw - allow graceful degradation
		}
	}
}

/**
 * Get thread options for Telegram message
 */
export function getThreadOptions(threadId?: number): { message_thread_id?: number } {
	return threadId ? { message_thread_id: threadId } : {};
}
