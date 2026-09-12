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
const BROWSER_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
};

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
function extractSessionCookie(setCookieHeaders: string[]): string | null {
  const sessionCookie = setCookieHeaders
    .flatMap((header) => header.split(/,(?=\s*[^;,=]+=[^;,]+)/))
    .map((cookie) => cookie.trim())
    .find((cookie) => /session_token/i.test(cookie));
  return sessionCookie ? (sessionCookie.split(";")[0] ?? null) : null;
}

function getSetCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") {
    return getSetCookie.call(headers);
  }
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function sessionCookieFromToken(token: string): string {
  return `__Secure-better-auth.session_token=${encodeURIComponent(token)}`;
}

function parseAuthCache(value: string): AuthCache {
  const parsed = JSON.parse(value) as Partial<AuthCache>;
  if (typeof parsed.cookie !== "string" || typeof parsed.expires !== "number") {
    throw new Error("Invalid cached auth session format");
  }
  return { cookie: parsed.cookie, expires: parsed.expires };
}

function parseLoginToken(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { token?: unknown };
    return typeof parsed.token === "string" && parsed.token ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}

function loginError(status: number, body: string): Error {
  const details = body.trim().replace(/\s+/g, " ").slice(0, 200);
  return new Error(`Login failed: HTTP ${status}${details ? ` - ${details}` : ""}`);
}

/**
 * Fetch current session info using a session cookie.
 * Returns the session expiry (epoch seconds). Throws if the session is invalid.
 */
async function fetchSession(cookie: string): Promise<{ expires: number }> {
  const sessionResponse = await fetch(`${BASE_URL}/api/auth/get-session`, {
    headers: { ...BROWSER_HEADERS, Cookie: cookie },
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
    headers: { ...BROWSER_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const responseBody = await loginResponse.text();
  if (!loginResponse.ok) {
    throw loginError(loginResponse.status, responseBody);
  }

  const token = parseLoginToken(responseBody);
  const setCookieCookie = extractSessionCookie(getSetCookieHeaders(loginResponse.headers));
  const fallbackCookie = token ? sessionCookieFromToken(token) : null;
  const cookie = setCookieCookie ?? fallbackCookie;
  if (!cookie) {
    throw new Error("Login response contained neither a session cookie nor a token");
  }

  console.log(
    `[Auth] Login response: status=${loginResponse.status}, set-cookie=${setCookieCookie ? "present" : "absent"}, ` +
      `json-token=${token ? "present" : "absent"}, ` +
      `cookie-source=${cookie === setCookieCookie ? "set-cookie" : "json-token"}`,
  );

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
        let parsed: AuthCache;
        try {
          parsed = parseAuthCache(cached);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            "[Auth] Removing invalid Redis session cache:",
            message,
            `value=${JSON.stringify(cached.slice(0, 48))}`,
          );
          await redis.del(REDIS_KEY_SESSION);
          parsed = { cookie: "", expires: 0 };
        }
        if (parsed.cookie && parsed.expires > nowSec + bufferSeconds) {
          memoryCache = parsed;
          return parsed.cookie;
        }
        // Cookie expired — try a quick session refresh
        try {
          const { expires } = await fetchSession(parsed.cookie);
          const ttl = Math.max(expires - nowSec - bufferSeconds, 60);
          await redis.setEx(
            REDIS_KEY_SESSION,
            ttl,
            JSON.stringify({ cookie: parsed.cookie, expires }),
          );
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
  console.log(
    `[Auth] Login successful, session expires: ${new Date(expires * 1000).toISOString()}`,
  );

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
