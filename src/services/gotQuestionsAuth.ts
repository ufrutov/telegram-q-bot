/**
 * GotQuestions Online Authentication Service
 *
 * The site now uses "Better Auth" (Next.js) with cookie-based sessions
 * instead of the old NextAuth JWT flow.
 *
 * Authentication Flow:
 *   1. Full login:  POST /api/auth/sign-in/email {email, password}
 *                   → session cookie `__Secure-better-auth.session_token` (7 days)
 *   2. Quick refresh: GET /api/auth/get-session with cookie → session.expiresAt
 *   3. On 401: force full login
 *
 * Caching strategy (reduces auth requests to ~1 per week):
 *   - Session cookie (7d) cached in Redis + memory
 *   - In-memory cache as fallback (per serverless invocation)
 */

import type { RedisClientType } from "redis";

const BASE_URL = "https://gotquestions.online";

const REDIS_KEY_SESSION = "gotquestions:session_cookie";

interface AuthCache {
  cookie: string;
  expires: number;
}

let memoryCache: AuthCache | null = null;

/**
 * Extract the Better Auth session cookie (`*session_token=value`) from Set-Cookie.
 * The value is kept exactly as returned (URL-encoded signature) and later sent
 * verbatim as the `Cookie` header.
 */
function extractSessionCookie(setCookieHeader: string | null): string {
  if (!setCookieHeader) {
    throw new Error("No Set-Cookie header in sign-in response");
  }
  const matches = setCookieHeader.split(",").map((c) => c.trim());
  const sessionCookie = matches.find((c) => /session_token/i.test(c));
  if (!sessionCookie) {
    throw new Error("No session_token cookie in sign-in response");
  }
  return sessionCookie.split(";")[0] ?? "";
}

/**
 * Fetch current session info using a session cookie.
 * Returns the session expiry (epoch seconds). Throws if the session is invalid.
 */
async function fetchSession(cookie: string): Promise<{ expires: number }> {
  const sessionResponse = await fetch(`${BASE_URL}/api/auth/get-session`, {
    headers: { Cookie: cookie },
  });
  if (!sessionResponse.ok) {
    throw new Error(`Session fetch failed: HTTP ${sessionResponse.status}`);
  }
  const data = (await sessionResponse.json().catch(() => null)) as {
    session?: { expiresAt?: string };
  } | null;

  if (!data?.session?.expiresAt) {
    throw new Error("No active session");
  }

  const expires = Math.floor(Date.parse(data.session.expiresAt) / 1000);
  if (!Number.isFinite(expires)) {
    throw new Error("Invalid session expiry");
  }

  return { expires };
}

/**
 * Full login flow — sign-in with credentials, then validate via get-session.
 * Used only when no valid session cookie exists (~1 per week).
 */
async function login(): Promise<{ cookie: string; expires: number }> {
  const email = process.env.GOTQUESTIONS_EMAIL;
  const password = process.env.GOTQUESTIONS_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "GOTQUESTIONS_EMAIL and GOTQUESTIONS_PASSWORD environment variables are required",
    );
  }

  const loginResponse = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginResponse.ok) {
    throw new Error(`Login failed: HTTP ${loginResponse.status}`);
  }

  const cookie = extractSessionCookie(loginResponse.headers.get("set-cookie"));
  const { expires } = await fetchSession(cookie);

  return { cookie, expires };
}

/**
 * Get a valid Better Auth session cookie.
 *
 * Cache hierarchy:
 *   1. Session cookie in memory (per invocation)
 *   2. Session cookie in Redis (across invocations)
 *   3. Full login (~1 per week)
 *
 * @param redis - Optional Redis client for caching
 * @returns Better Auth session cookie header value (`name=value`)
 */
export async function getSessionCookie(redis?: RedisClientType | null): Promise<string> {
  const bufferSeconds = 60;
  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Check in-memory cache
  if (memoryCache && memoryCache.cookie) {
    if (memoryCache.expires > nowSec + bufferSeconds) {
      return memoryCache.cookie;
    }
    // Cookie expired in memory — try a quick session refresh
    try {
      const { expires } = await fetchSession(memoryCache.cookie);
      memoryCache = { cookie: memoryCache.cookie, expires };
      return memoryCache.cookie;
    } catch {
      memoryCache = null;
    }
  }

  const isRedis = !!(redis && redis.isOpen);

  // 2. Try Redis cache
  if (isRedis && redis) {
    try {
      const cached = await redis.get(REDIS_KEY_SESSION);
      if (cached) {
        const parsed = JSON.parse(cached) as AuthCache;
        if (parsed.cookie && parsed.expires > nowSec + bufferSeconds) {
          memoryCache = parsed;
          return parsed.cookie;
        }
        // Cookie expired — try a quick session refresh
        try {
          const { expires } = await fetchSession(parsed.cookie);
          const ttl = Math.max(expires - nowSec - bufferSeconds, 60);
          await redis.setEx(REDIS_KEY_SESSION, ttl, JSON.stringify({ cookie: parsed.cookie, expires }));
          memoryCache = { cookie: parsed.cookie, expires };
          return parsed.cookie;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[Auth] Redis session cookie stale, re-login needed:", message);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[Auth] Redis read error:", message);
    }
  }

  // 3. Full login (no valid session cookie anywhere)
  console.log("[Auth] Performing full login (no valid session)...");
  const { cookie, expires } = await login();
  console.log(`[Auth] Login successful, session expires: ${new Date(expires * 1000).toISOString()}`);

  memoryCache = { cookie, expires };

  if (isRedis && redis) {
    try {
      const ttl = Math.max(expires - nowSec - bufferSeconds, 60);
      await redis.setEx(REDIS_KEY_SESSION, ttl, JSON.stringify({ cookie, expires }));
      console.log(`[Auth] Cached in Redis: session ${ttl}s`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[Auth] Redis write error:", message);
    }
  }

  return cookie;
}

/**
 * Clear cached session cookie (used after 401 response to force fresh login)
 */
export async function clearCachedToken(redis?: RedisClientType | null): Promise<void> {
  memoryCache = null;
  if (redis && redis.isOpen) {
    try {
      await redis.del(REDIS_KEY_SESSION);
    } catch {
      /* ignore */
    }
  }
  console.log("[Auth] Session cache cleared");
}

export { login };