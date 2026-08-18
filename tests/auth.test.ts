import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME, signSession, verifySession } from '../src/services/auth/session.js';
import { timingSafeEqualPassword } from '../src/services/auth/password.js';

const SHARED_PASSWORD = 'test-shared-password-123';
const SESSION_SECRET = 'test-auth-route-session-secret-at-least-32-chars';

function buildTestApp(overrides: Parameters<typeof buildApp>[0] = {}) {
  return buildApp({
    checkDatabaseConnection: async () => true,
    authRoutesOptions: {
      nodeEnv: 'development',
      sharedPassword: SHARED_PASSWORD,
      sessionSecret: SESSION_SECRET,
      sessionMaxAgeSeconds: 2592000,
    },
    authGateOptions: { nodeEnv: 'development', sessionSecret: SESSION_SECRET },
    ...overrides,
  });
}

/** Parses a single `Set-Cookie` header value into its attribute map, lower-cased keys. */
function parseSetCookie(setCookieHeader: string) {
  const parts = setCookieHeader.split(';').map((p) => p.trim());
  const [nameValue, ...attrs] = parts;
  const [name, value] = nameValue!.split('=');
  const attrMap: Record<string, string | true> = {};
  for (const attr of attrs) {
    const [key, val] = attr.split('=');
    attrMap[key!.toLowerCase()] = val ?? true;
  }
  return { name, value, attrs: attrMap };
}

describe('POST /api/v1/auth/login', () => {
  it('returns 200 with the normalized name and sets an HttpOnly session cookie on the correct password', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { name: '  Alex  ', password: SHARED_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: 'Alex' });

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookie = parseSetCookie(Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string));
    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.attrs.httponly).toBe(true);
    expect(cookie.attrs.samesite?.toString().toLowerCase()).toBe('lax');
    expect(cookie.attrs.path).toBe('/');
    expect(cookie.attrs['max-age']).toBeDefined();
    // Local dev is plain http:// — Secure would silently drop the cookie there.
    expect(cookie.attrs.secure).toBeUndefined();

    await app.close();
  });

  it('sets Secure on the session cookie in production', async () => {
    const app = buildTestApp({
      authRoutesOptions: {
        nodeEnv: 'production',
        sharedPassword: SHARED_PASSWORD,
        sessionSecret: SESSION_SECRET,
        sessionMaxAgeSeconds: 2592000,
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { name: 'Alex', password: SHARED_PASSWORD },
    });

    const setCookie = response.headers['set-cookie'];
    const cookie = parseSetCookie(Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string));
    expect(cookie.attrs.secure).toBe(true);

    await app.close();
  });

  it('returns 401 with a generic message for the wrong password — never echoes the password', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { name: 'Alex', password: 'totally-wrong' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
    expect(body.error.message).toBe('Invalid name or password');
    expect(JSON.stringify(body)).not.toContain('totally-wrong');
    expect(JSON.stringify(body)).not.toContain(SHARED_PASSWORD);
    expect(response.headers['set-cookie']).toBeUndefined();

    await app.close();
  });

  it('gives the same 401 shape regardless of what name was submitted alongside the wrong password', async () => {
    const app = buildTestApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { name: 'Alex', password: 'wrong' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { name: 'SomeoneElse', password: 'wrong' },
    });

    expect(first.statusCode).toBe(second.statusCode);
    expect(first.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
    expect(second.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });

    await app.close();
  });

  it.each([
    ['blank name', { name: '   ', password: SHARED_PASSWORD }],
    ['name over 40 chars', { name: 'x'.repeat(41), password: SHARED_PASSWORD }],
    ['name with a control character', { name: 'Alex', password: SHARED_PASSWORD }],
    ['blank password', { name: 'Alex', password: '' }],
    ['missing name', { password: SHARED_PASSWORD }],
  ])('returns 400 for %s', async (_label, payload) => {
    const app = buildTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('rate-limits repeated login attempts', async () => {
    const app = buildTestApp();
    const responses = [];
    for (let i = 0; i < 6; i++) {
      responses.push(
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { name: 'Alex', password: 'wrong' },
        }),
      );
    }
    const statusCodes = responses.map((r) => r.statusCode);
    expect(statusCodes.filter((c) => c === 401)).toHaveLength(5);
    expect(statusCodes.filter((c) => c === 429)).toHaveLength(1);
    await app.close();
  });

  it('never logs the password, the shared password, or the session secret', async () => {
    const logStream = new PassThrough();
    let logOutput = '';
    logStream.on('data', (chunk: Buffer) => {
      logOutput += chunk.toString('utf8');
    });
    const app = buildTestApp({ loggerStream: logStream });

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { name: 'Alex', password: SHARED_PASSWORD },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { name: 'Alex', password: 'wrong-guess' },
    });

    await app.close();
    await new Promise((resolve) => setImmediate(resolve));

    expect(logOutput).not.toContain(SHARED_PASSWORD);
    expect(logOutput).not.toContain('wrong-guess');
    expect(logOutput).not.toContain(SESSION_SECRET);
  });
});

describe('GET /api/v1/auth/session', () => {
  it('returns authenticated:false with no cookie', async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
    await app.close();
  });

  it('returns authenticated:true and the name for a valid session cookie', async () => {
    const app = buildTestApp();
    const token = signSession({ name: 'Alex' }, SESSION_SECRET, 2592000);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: true, name: 'Alex' });
    await app.close();
  });

  it('returns authenticated:false for an expired session cookie', async () => {
    const app = buildTestApp();
    const token = signSession({ name: 'Alex' }, SESSION_SECRET, -1);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.json()).toEqual({ authenticated: false });
    await app.close();
  });

  it('returns authenticated:false for a tampered session cookie', async () => {
    const app = buildTestApp();
    const token = signSession({ name: 'Alex' }, SESSION_SECRET, 2592000);
    const tampered = token.endsWith('a') ? `${token.slice(0, -1)}b` : `${token.slice(0, -1)}a`;
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${tampered}` },
    });
    expect(response.json()).toEqual({ authenticated: false });
    await app.close();
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('returns 204 and clears the session cookie', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `${SESSION_COOKIE_NAME}=whatever` },
    });

    expect(response.statusCode).toBe(204);
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookie = parseSetCookie(Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string));
    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    // Clearing sets an empty value with an already-past expiry.
    expect(cookie.value).toBe('');
    await app.close();
  });

  it('a session obtained from logout no longer authenticates against /auth/session', async () => {
    const app = buildTestApp();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { name: 'Alex', password: SHARED_PASSWORD },
    });
    const sessionCookieHeader = Array.isArray(login.headers['set-cookie'])
      ? login.headers['set-cookie'][0]!
      : (login.headers['set-cookie'] as string);
    const cookieValue = sessionCookieHeader.split(';')[0]!;

    const beforeLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: cookieValue },
    });
    expect(beforeLogout.json()).toMatchObject({ authenticated: true });

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookieValue },
    });
    const clearedCookieHeader = Array.isArray(logout.headers['set-cookie'])
      ? logout.headers['set-cookie'][0]!
      : (logout.headers['set-cookie'] as string);
    const clearedCookieValue = clearedCookieHeader.split(';')[0]!;

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: clearedCookieValue },
    });
    expect(afterLogout.json()).toEqual({ authenticated: false });

    await app.close();
  });
});

describe('timingSafeEqualPassword', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqualPassword('correct-password', 'correct-password')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(timingSafeEqualPassword('correct-password', 'wrongg-password')).toBe(false);
  });

  it('returns false for strings of different lengths without throwing', () => {
    expect(() => timingSafeEqualPassword('short', 'a-much-longer-password-guess')).not.toThrow();
    expect(timingSafeEqualPassword('short', 'a-much-longer-password-guess')).toBe(false);
  });

  it('returns false for an empty guess', () => {
    expect(timingSafeEqualPassword('', 'correct-password')).toBe(false);
  });
});

describe('session integration: a real login session can access the AI route', () => {
  it('POST /auth/login then PUT reflections + POST /study-days/:date/compare with the resulting cookies succeeds — the date-based route, not the now dev-token-only /reflections/compare (see section 10)', async () => {
    const { CreditService } = await import('../src/services/credits/credit-service.js');
    const { InMemoryCreditRepository } = await import('./helpers/in-memory-credit-repository.js');
    const { MindlogicClient } = await import('../src/services/mindlogic/client.js');
    const { DailyReflectionService } =
      await import('../src/services/daily-reflections/daily-reflection-service.js');
    const { InMemoryDailyReflectionRepository } =
      await import('./helpers/in-memory-daily-reflection-repository.js');
    const { ComparisonService } =
      await import('../src/services/daily-reflections/comparison-service.js');
    const { InMemoryComparisonRepository } =
      await import('./helpers/in-memory-comparison-repository.js');

    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          model: 'claude-haiku-4-5-20251001',
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  commonGround: [{ point: 'p', mine: 'm', partner: 'pt' }],
                  differences: [
                    {
                      topic: 't',
                      mine: { stance: 's1', quote: 'q1' },
                      partner: { stance: 's2', quote: 'q2' },
                    },
                  ],
                  topics: [
                    { question: 'q1?', reason: 'r1', difficulty: 'Intermediate' },
                    { question: 'q2?', reason: 'r2', difficulty: 'Advanced' },
                    { question: 'q3?', reason: 'r3', difficulty: 'Intermediate' },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const dailyReflectionRepository = new InMemoryDailyReflectionRepository();
    const STUDY_DATE = '2026-08-17';
    const FIXED_NOW = new Date('2026-08-18T03:00:00.000Z'); // 2026-08-18 12:00 KST

    const app = buildTestApp({
      creditService: new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient: new MindlogicClient({
        apiKey: 'test-fake-key',
        baseUrl: 'https://example.com/v1/gateway',
        fetchImpl,
      }),
      dailyReflectionService: new DailyReflectionService(dailyReflectionRepository),
      comparisonService: new ComparisonService(
        new InMemoryComparisonRepository(dailyReflectionRepository),
      ),
      studyDaysRoutesOptions: {
        sessionSecret: SESSION_SECRET,
        maxFutureDays: 1,
        now: () => FIXED_NOW,
      },
    });

    async function loginCookie(name: string) {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { name, password: SHARED_PASSWORD },
      });
      expect(login.statusCode).toBe(200);
      const sessionCookieHeader = Array.isArray(login.headers['set-cookie'])
        ? login.headers['set-cookie'][0]!
        : (login.headers['set-cookie'] as string);
      return sessionCookieHeader.split(';')[0]!;
    }

    const alexCookie = await loginCookie('Alex');
    const samCookie = await loginCookie('Sam');

    const reflectionBody = (reflection: string) => ({
      article: { id: 'article-1', title: 'The Quiet Revolution', sourceUrl: null, summary: null },
      reflection,
    });

    const alexPut = await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: alexCookie },
      payload: reflectionBody(
        'I found this article compelling because it connects Korean cultural investment to genuine artistic ambition.',
      ),
    });
    expect(alexPut.statusCode).toBe(200);

    const samPut = await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: samCookie },
      payload: reflectionBody(
        'I found this article compelling because it connects Korean cultural investment to genuine artistic ambition too.',
      ),
    });
    expect(samPut.statusCode).toBe(200);

    const compareResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/study-days/${STUDY_DATE}/compare`,
      headers: { cookie: alexCookie },
    });

    expect(compareResponse.statusCode).toBe(200);
    const body = compareResponse.json();
    expect(body.status).toBe('completed');
    expect(body.result.topics).toHaveLength(3);

    // The now dev-token-only /reflections/compare route must reject this
    // same real session cookie (section 10).
    const oldRouteResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { cookie: alexCookie },
      payload: {
        article: { title: 'The Quiet Revolution', summary: 'A summary.' },
        mine: { displayName: 'Alex', reflection: 'x'.repeat(60) },
        partner: { displayName: 'Sam', reflection: 'y'.repeat(60) },
      },
    });
    expect(oldRouteResponse.statusCode).toBe(401);

    await app.close();
  });
});

describe('verifySession', () => {
  it('returns null (never throws) for a malformed token', () => {
    expect(verifySession('not-a-jwt', SESSION_SECRET)).toBeNull();
  });
});
