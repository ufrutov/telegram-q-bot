import { getRedisClient } from "@/bot/botClient.js";
import type { RedisClientType } from "redis";
let connecting: Promise<unknown> | null = null;
/** Share connection establishment between settings and dashboard delivery. */
export async function getConnectedRedis(): Promise<RedisClientType | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  if (connecting) await connecting;
  else if (!redis.isOpen) {
    connecting = redis.connect();
    try {
      await connecting;
    } finally {
      connecting = null;
    }
  }
  return redis;
}
