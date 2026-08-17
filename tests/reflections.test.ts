import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CreditService } from '../src/services/credits/credit-service.js';
import { InMemoryCreditRepository } from './helpers/in-memory-credit-repository.js';
import { MindlogicClient } from '../src/services/mindlogic/client.js';
import { SESSION_COOKIE_NAME, signSession } from '../src/services/auth/session.js';

const VALID_REFLECTION =
  'I found this article compelling because it connects Korean cultural investment to genuine artistic ambition, and I appreciated how it grounded the claim in specific examples from film and television.';

const VALID_BODY = {
  article: { title: 'The Quiet Revolution', summary: 'A summary of the article.' },
  mine: { displayName: 'Alex', reflection: VALID_REFLECTION },
  partner: { displayName: 'Sam', reflection: `${VALID_REFLECTION} A slightly different take.` },
};

const DEV_TOKEN = 'test-http-layer-dev-token';
const SESSION_SECRET = 'test-http-layer-session-secret-at-least-32-chars-long';

function validSessionCookie(name = 'Alex') {
  const token = signSession({ name }, SESSION_SECRET, 2592000);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function validComparisonBody() {
  return {
    commonGround: [{ point: 'p', mine: 'm', partner: 'pt' }],
    differences: [
      { topic: 't', mine: { stance: 's1', quote: 'q1' }, partner: { stance: 's2', quote: 'q2' } },
    ],
    topics: [
      { question: 'q1?', reason: 'r1', difficulty: 'Intermediate' },
      { question: 'q2?', reason: 'r2', difficulty: 'Advanced' },
      { question: 'q3?', reason: 'r3', difficulty: 'Intermediate' },
    ],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function successfulMindlogicClient() {
  const fetchImpl = async () =>
    jsonResponse(200, {
      id: 'chatcmpl-1',
      model: 'claude-haiku-4-5-20251001',
      choices: [{ message: { role: 'assistant', content: JSON.stringify(validComparisonBody()) } }],
      usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
    });
  return new MindlogicClient({
    apiKey: 'test-fake-key',
    baseUrl: 'https://example.com/v1/gateway',
    fetchImpl,
  });
}

function buildTestApp(overrides: Parameters<typeof buildApp>[0] = {}) {
  const creditService =
    overrides.creditService ?? new CreditService(new InMemoryCreditRepository(), 5000);
  const mindlogicClient = overrides.mindlogicClient ?? successfulMindlogicClient();
  return buildApp({
    checkDatabaseConnection: async () => true,
    authGateOptions: {
      nodeEnv: 'development',
      sessionSecret: SESSION_SECRET,
      devAccessToken: DEV_TOKEN,
    },
    ...overrides,
    creditService,
    mindlogicClient,
  });
}

describe('POST /api/v1/reflections/compare — auth gate', () => {
  it('rejects a request with neither a session cookie nor a token with 401', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('accepts a valid session cookie', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { cookie: validSessionCookie() },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('accepts a valid session cookie in production too — the old blanket-404-in-production policy is gone', async () => {
    const app = buildTestApp({
      authGateOptions: { nodeEnv: 'production', sessionSecret: SESSION_SECRET },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { cookie: validSessionCookie() },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('rejects a tampered session cookie with 401', async () => {
    const app = buildTestApp();
    const cookie = validSessionCookie();
    const tampered = cookie.endsWith('a') ? `${cookie.slice(0, -1)}b` : `${cookie.slice(0, -1)}a`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { cookie: tampered },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a session cookie signed with the wrong secret with 401', async () => {
    const app = buildTestApp();
    const wrongSecretToken = signSession(
      { name: 'Alex' },
      'a-completely-different-32-char-secret!!',
      2592000,
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${wrongSecretToken}` },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an expired session cookie with 401', async () => {
    const app = buildTestApp();
    const expiredToken = signSession({ name: 'Alex' }, SESSION_SECRET, -1);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${expiredToken}` },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a missing or incorrect CLI dev token with 401 (no session cookie either)', async () => {
    const app = buildTestApp();

    const noToken = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      payload: VALID_BODY,
    });
    expect(noToken.statusCode).toBe(401);

    const wrongToken = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: 'Bearer wrong-token' },
      payload: VALID_BODY,
    });
    expect(wrongToken.statusCode).toBe(401);

    await app.close();
  });

  it('accepts the correct CLI dev token in development (no session cookie needed)', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('refuses the CLI dev token in production, even if correct — only a real session works there', async () => {
    const app = buildTestApp({
      authGateOptions: {
        nodeEnv: 'production',
        sessionSecret: SESSION_SECRET,
        devAccessToken: DEV_TOKEN,
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('POST /api/v1/reflections/compare — rate limiting', () => {
  it('returns 429 once the per-caller limit is exceeded, without ever exceeding it for a single caller', async () => {
    const app = buildTestApp();

    const responses = [];
    for (let i = 0; i < 11; i++) {
      responses.push(
        await app.inject({
          method: 'POST',
          url: '/api/v1/reflections/compare',
          headers: { authorization: `Bearer ${DEV_TOKEN}` },
          payload: VALID_BODY,
        }),
      );
    }

    const statusCodes = responses.map((r) => r.statusCode);
    expect(statusCodes.filter((code) => code === 200)).toHaveLength(10);
    expect(statusCodes.filter((code) => code === 429)).toHaveLength(1);

    await app.close();
  });
});

describe('POST /api/v1/reflections/compare — input validation', () => {
  it('returns 400 for a missing article.title', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: { ...VALID_BODY, article: { summary: 'no title' } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('returns 400 for a blank displayName', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: { ...VALID_BODY, mine: { displayName: '   ', reflection: VALID_REFLECTION } },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for a too-short reflection', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: { ...VALID_BODY, mine: { displayName: 'Alex', reflection: 'too short' } },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /api/v1/reflections/compare — happy path contract', () => {
  it('returns 200 with requestId + commonGround + differences + exactly 3 topics, no mine/partner-name-tied field names', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(typeof body.requestId).toBe('string');
    expect(Array.isArray(body.commonGround)).toBe(true);
    expect(Array.isArray(body.differences)).toBe(true);
    expect(body.topics).toHaveLength(3);

    const serialized = JSON.stringify(body);
    // Frontend-mock field names tied to specific display names must not
    // leak into the server contract.
    expect(serialized).not.toContain('"hj"');
    expect(serialized).not.toContain('"js"');

    await app.close();
  });
});

describe('POST /api/v1/reflections/compare — monthly limit blocks Mindlogic', () => {
  it('returns 402 and never calls Mindlogic when the monthly limit is already exhausted', async () => {
    let mindlogicCalled = false;
    const fetchImpl = async () => {
      mindlogicCalled = true;
      return jsonResponse(200, { id: 'x', model: 'x', choices: [], usage: undefined });
    };
    const creditService = new CreditService(new InMemoryCreditRepository(), 1);
    const mindlogicClient = new MindlogicClient({
      apiKey: 'test-fake-key',
      baseUrl: 'https://example.com/v1/gateway',
      fetchImpl,
    });
    const app = buildTestApp({ creditService, mindlogicClient });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(402);
    expect(response.json().error.code).toBe('CREDIT_LIMIT_EXCEEDED');
    expect(mindlogicCalled).toBe(false);

    await app.close();
  });
});

describe('POST /api/v1/reflections/compare — logging never contains sensitive content', () => {
  it('logs requestId/feature/model/tokens/credits but never reflection text, display names, or the API key', async () => {
    const logStream = new PassThrough();
    let logOutput = '';
    logStream.on('data', (chunk: Buffer) => {
      logOutput += chunk.toString('utf8');
    });

    const app = buildTestApp({ loggerStream: logStream });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(200);

    await app.close();
    // Give the stream a tick to flush pending writes after close.
    await new Promise((resolve) => setImmediate(resolve));

    expect(logOutput).not.toContain(VALID_REFLECTION);
    expect(logOutput).not.toContain('Alex');
    expect(logOutput).not.toContain('Sam');
    expect(logOutput).not.toContain('test-fake-key');
    expect(logOutput).not.toContain(DEV_TOKEN);
    expect(logOutput).not.toContain(`Bearer ${DEV_TOKEN}`);

    expect(logOutput).toContain('reflection_comparison');
    expect(logOutput).toContain('reflection comparison completed');
  });
});
