/**
 * GotQuestions Online Authentication Service
 *
 * Handles JWT token acquisition and caching for gotquestions.online API.
 * 
 * Authentication Flow:
 *   1. Full login:  CSRF → Credentials → Session → JWT token (30-min session cookie, 1h JWT)
 *   2. Quick refresh: Session cookie (30d) → GET /api/auth/session → fresh JWT (1h)
 *   3. On 401: force full login
 * 
 * Caching strategy (reduces auth requests to ~1 per hour):
 *   - Session cookie (30d) stored in Redis → full login only once per month
 *   - JWT token (1h) cached in Redis + memory → session fetch once per hour
 *   - In-memory cache as fallback (per serverless invocation)
 */

const BASE_URL = 'https://gotquestions.online';

/** @type {{token: string, expires: number, sessionCookie?: string}|null} */
let memoryCache = null;

/**
 * Decode JWT token payload to extract expiry
 * @param {string} token - JWT token string
 * @returns {{exp: number, user_email?: string}|null} - Decoded payload or null
 */
function decodeToken(token) {
	try {
		const payload = token.split('.')[1];
		const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
		return decoded;
	} catch {
		return null;
	}
}

/**
 * Extract cookie key=value pairs from Set-Cookie header
 * @param {string} setCookieHeader - Raw Set-Cookie header value
 * @returns {string} - Cookie string for subsequent requests (semicolon-separated)
 */
function extractCookies(setCookieHeader) {
	if (!setCookieHeader) return '';
	return setCookieHeader
		.split(',')
		.map(c => c.split(';')[0].trim())
		.filter(Boolean)
		.join('; ');
}

/**
 * Full login flow — CSRF → credentials → session
 * Used only when no valid session cookie exists (~1 per month)
 * @returns {Promise<{token: string, expires: number, sessionCookie: string}>}
 */
async function login() {
	const email = process.env.GOTQUESTIONS_EMAIL;
	const password = process.env.GOTQUESTIONS_PASSWORD;
	if (!email || !password) {
		throw new Error('GOTQUESTIONS_EMAIL and GOTQUESTIONS_PASSWORD environment variables are required');
	}

	// Step 1: Get CSRF token + cookies
	const csrfResponse = await fetch(`${BASE_URL}/api/auth/csrf`);
	if (!csrfResponse.ok) {
		throw new Error(`Failed to get CSRF token: HTTP ${csrfResponse.status}`);
	}
	const { csrfToken } = await csrfResponse.json();
	let cookies = extractCookies(csrfResponse.headers.get('set-cookie'));

	// Step 2: Login with credentials (form-encoded — NextAuth requirement)
	const loginParams = new URLSearchParams();
	loginParams.append('email', email);
	loginParams.append('password', password);
	loginParams.append('csrfToken', csrfToken);
	loginParams.append('redirect', 'false');
	loginParams.append('json', 'true');
	loginParams.append('callbackUrl', `${BASE_URL}/search`);

	const loginResponse = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Cookie: cookies,
		},
		body: loginParams.toString(),
	});
	if (!loginResponse.ok) {
		throw new Error(`Login failed: HTTP ${loginResponse.status}`);
	}

	// Merge all cookies (CSRF + session)
	const loginCookies = extractCookies(loginResponse.headers.get('set-cookie'));
	cookies = cookies + '; ' + loginCookies;

	// Step 3: Get session with JWT access token
	const { token, expires } = await fetchSession(cookies);

	return { token, expires, sessionCookie: cookies };
}

/**
 * Fetch session to get a fresh JWT access token
 * Uses existing session cookie (no credentials needed)
 * @param {string} cookies - Session cookie string
 * @returns {Promise<{token: string, expires: number}>}
 */
async function fetchSession(cookies) {
	const sessionResponse = await fetch(`${BASE_URL}/api/auth/session`, {
		headers: { Cookie: cookies },
	});
	if (!sessionResponse.ok) {
		throw new Error(`Session fetch failed: HTTP ${sessionResponse.status}`);
	}
	const sessionData = await sessionResponse.json();

	if (!sessionData.accessToken) {
		throw new Error('No access token in session response');
	}

	const decoded = decodeToken(sessionData.accessToken);
	if (!decoded || !decoded.exp) {
		throw new Error('Invalid JWT token: cannot decode expiry');
	}

	return { token: sessionData.accessToken, expires: decoded.exp };
}

/**
 * Get a valid access token using cached session cookie and JWT
 * Cache hierarchy:
 *   1. JWT in memory (per invocation)
 *   2. JWT in Redis (across invocations)
 *   3. Session cookie in Redis → quick session fetch (1 req)
 *   4. Full login (3 req, once per month)
 * 
 * @param {import('redis').RedisClientType} [redis] - Optional Redis client for caching
 * @returns {Promise<string>} - Valid JWT access token
 */
async function getAccessToken(redis) {
	const bufferSeconds = 60; // 1 min buffer before JWT expiry

	// 1. Check in-memory cache (per invocation)
	if (memoryCache && memoryCache.token) {
		if (memoryCache.expires > Math.floor(Date.now() / 1000) + bufferSeconds) {
			return memoryCache.token;
		}
		// Token expired in memory, but we may have session cookie
		if (memoryCache.sessionCookie) {
			try {
				const { token, expires } = await fetchSession(memoryCache.sessionCookie);
				memoryCache = { token, expires, sessionCookie: memoryCache.sessionCookie };
				return token;
			} catch {
				memoryCache = null; // session cookie stale, force full login
			}
		}
	}

	const isRedis = redis && redis.isOpen;

	// 2. Try Redis — check for cached JWT
	if (isRedis) {
		try {
			const cachedToken = await redis.get('gotquestions:jwt_token');
			if (cachedToken) {
				const { token, expires } = JSON.parse(cachedToken);
				if (expires > Math.floor(Date.now() / 1000) + bufferSeconds) {
					memoryCache = { token, expires };
					return token;
				}
				// JWT expired, try session cookie
			}
		} catch (err) {
			console.warn('[Auth] Redis read error:', err.message);
		}

		// 3. Try Redis — use session cookie for quick refresh
		try {
			const sessionCookie = await redis.get('gotquestions:session_cookie');
			if (sessionCookie) {
				const { token, expires } = await fetchSession(sessionCookie);
				const ttl = Math.max(expires - Math.floor(Date.now() / 1000) - bufferSeconds, 60);
				await redis.setEx('gotquestions:jwt_token', ttl, JSON.stringify({ token, expires }));
				memoryCache = { token, expires, sessionCookie };
				return token;
			}
		} catch (err) {
			console.warn('[Auth] Redis session cookie error:', err.message);
		}
	}

	// 4. Full login (no valid session cookie anywhere)
	console.log('[Auth] Performing full login (no valid session)...');
	const { token, expires, sessionCookie } = await login();
	console.log(`[Auth] Login successful, JWT expires: ${new Date(expires * 1000).toISOString()}`);

	// Cache in memory
	memoryCache = { token, expires, sessionCookie };

	// Cache in Redis
	if (isRedis) {
		try {
			const jwtTtl = Math.max(expires - Math.floor(Date.now() / 1000) - bufferSeconds, 60);
			await redis.setEx('gotquestions:jwt_token', jwtTtl, JSON.stringify({ token, expires }));
			await redis.setEx('gotquestions:session_cookie', 86400 * 28, sessionCookie); // 28 days
			console.log(`[Auth] Cached in Redis: JWT ${jwtTtl}s, session 28d`);
		} catch (err) {
			console.warn('[Auth] Redis write error:', err.message);
		}
	}

	return token;
}

/**
 * Clear cached token (used after 401 response to force fresh login)
 * @param {import('redis').RedisClientType} [redis] - Optional Redis client
 */
async function clearCachedToken(redis) {
	memoryCache = null;
	if (redis && redis.isOpen) {
		try {
			await redis.del('gotquestions:jwt_token');
			await redis.del('gotquestions:session_cookie');
		} catch { /* ignore */ }
	}
	console.log('[Auth] Token and session cache cleared');
}

module.exports = { getAccessToken, clearCachedToken, login, decodeToken };
