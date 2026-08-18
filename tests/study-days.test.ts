import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CreditService } from '../src/services/credits/credit-service.js';
import { InMemoryCreditRepository } from './helpers/in-memory-credit-repository.js';
import { InMemoryDailyReflectionRepository } from './helpers/in-memory-daily-reflection-repository.js';
import { InMemoryComparisonRepository } from './helpers/in-memory-comparison-repository.js';
import { DailyReflectionService } from '../src/services/daily-reflections/daily-reflection-service.js';
import { ComparisonService } from '../src/services/daily-reflections/comparison-service.js';
import { MindlogicClient } from '../src/services/mindlogic/client.js';
import { SESSION_COOKIE_NAME, signSession } from '../src/services/auth/session.js';

const SESSION_SECRET = 'test-study-days-session-secret-at-least-32-chars-long';
// 2026-08-18T03:00:00Z is 2026-08-18 12:00 in Asia/Seoul (UTC+9).
const FIXED_NOW = new Date('2026-08-18T03:00:00.000Z');
const STUDY_DATE = '2026-08-17';

const VALID_REFLECTION =
  'This reflection is deliberately written to be well over fifty non-blank characters long so it passes validation.';

function sessionCookie(name: string, secret = SESSION_SECRET) {
  const token = signSession({ name }, secret, 2592000);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    article: { id: 'article-1', title: 'The Quiet Revolution', sourceUrl: null, summary: null },
    reflection: VALID_REFLECTION,
    ...overrides,
  };
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

function successfulMindlogicClient(onCall?: () => void) {
  const fetchImpl = async () => {
    onCall?.();
    return jsonResponse(200, {
      id: 'chatcmpl-1',
      model: 'claude-haiku-4-5-20251001',
      choices: [{ message: { role: 'assistant', content: JSON.stringify(validComparisonBody()) } }],
      usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
    });
  };
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
  const dailyReflectionRepository = new InMemoryDailyReflectionRepository();
  const dailyReflectionService =
    overrides.dailyReflectionService ?? new DailyReflectionService(dailyReflectionRepository);
  const comparisonService =
    overrides.comparisonService ??
    new ComparisonService(new InMemoryComparisonRepository(dailyReflectionRepository));
  return buildApp({
    checkDatabaseConnection: async () => true,
    studyDaysRoutesOptions: {
      sessionSecret: SESSION_SECRET,
      maxFutureDays: 1,
      now: () => FIXED_NOW,
    },
    ...overrides,
    creditService,
    mindlogicClient,
    dailyReflectionService,
    comparisonService,
  });
}

async function submit(
  app: ReturnType<typeof buildApp>,
  name: string,
  body: Record<string, unknown> = validBody(),
) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
    headers: { cookie: sessionCookie(name) },
    payload: body,
  });
}

describe('PUT /api/v1/study-days/:date/reflection — auth', () => {
  it('returns 401 without a session cookie', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      payload: validBody(),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /api/v1/study-days/:date/status — auth', () => {
  it('returns 401 without a session cookie', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/status`,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('POST /api/v1/study-days/:date/compare — auth', () => {
  it('returns 401 without a session cookie', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/study-days/${STUDY_DATE}/compare`,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('PUT /api/v1/study-days/:date/reflection — successful submission', () => {
  it('returns 200 with the expected shape', async () => {
    const app = buildTestApp();
    const response = await submit(app, 'Alex');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({
      studyDate: STUDY_DATE,
      submitted: true,
      submittedAt: expect.any(String),
    });
    expect(() => new Date(body.submittedAt).toISOString()).not.toThrow();
    await app.close();
  });

  it('derives the submitter from the session name, not any client-supplied field', async () => {
    const app = buildTestApp();
    const response = await submit(app, 'Alex');
    expect(response.statusCode).toBe(200);

    const status = await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/status`,
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(status.json().mine).toEqual({ submitted: true, displayName: 'Alex' });
    await app.close();
  });

  it('rejects a request body that tries to supply a displayName/participant field (schema is strict)', async () => {
    const app = buildTestApp();
    const response = await submit(app, 'Alex', validBody({ displayName: 'NotAlex' }));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });
});

describe('PUT /api/v1/study-days/:date/reflection — reflection validation', () => {
  it('returns 400 for a too-short reflection', async () => {
    const app = buildTestApp();
    const response = await submit(app, 'Alex', validBody({ reflection: 'too short' }));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('returns 400 for a too-long reflection', async () => {
    const app = buildTestApp();
    const response = await submit(app, 'Alex', validBody({ reflection: 'a'.repeat(6001) }));
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for a blank reflection', async () => {
    const app = buildTestApp();
    const response = await submit(app, 'Alex', validBody({ reflection: '   ' }));
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for a missing article.id', async () => {
    const app = buildTestApp();
    const response = await submit(app, 'Alex', {
      article: { title: 'No id' },
      reflection: VALID_REFLECTION,
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('PUT /api/v1/study-days/:date/reflection — idempotent resubmission', () => {
  it('the same user submitting twice does not duplicate or overwrite content', async () => {
    const app = buildTestApp();
    const first = await submit(app, 'Alex', validBody({ reflection: VALID_REFLECTION }));
    expect(first.statusCode).toBe(200);
    const firstSubmittedAt = first.json().submittedAt;

    const second = await submit(
      app,
      'Alex',
      validBody({ reflection: `${VALID_REFLECTION} A different follow-up thought entirely.` }),
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().submittedAt).toBe(firstSubmittedAt);

    await app.close();
  });
});

describe('PUT /api/v1/study-days/:date/reflection — article mismatch', () => {
  it('returns 409 ARTICLE_MISMATCH when a different article is submitted for an already-registered date', async () => {
    const app = buildTestApp();
    const first = await submit(
      app,
      'Alex',
      validBody({ article: { id: 'article-1', title: 'A' } }),
    );
    expect(first.statusCode).toBe(200);

    const second = await submit(
      app,
      'Sam',
      validBody({ article: { id: 'article-2', title: 'B' } }),
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('ARTICLE_MISMATCH');

    await app.close();
  });
});

describe('PUT /api/v1/study-days/:date/reflection — participant limit', () => {
  it('rejects a 3rd distinct name with 409 PARTICIPANT_LIMIT_REACHED', async () => {
    const app = buildTestApp();
    expect((await submit(app, 'Alex')).statusCode).toBe(200);
    expect((await submit(app, 'Sam')).statusCode).toBe(200);

    const third = await submit(app, 'Jordan');
    expect(third.statusCode).toBe(409);
    expect(third.json().error.code).toBe('PARTICIPANT_LIMIT_REACHED');

    await app.close();
  });
});

describe('GET /api/v1/study-days/:date/status', () => {
  it('reflects submission state before and after the partner submits, never exposing partner content', async () => {
    const app = buildTestApp();

    const beforeAny = await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/status`,
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(beforeAny.json()).toEqual({
      studyDate: STUDY_DATE,
      mine: { submitted: false, displayName: null },
      partner: { submitted: false, displayName: null },
      readyToCompare: false,
    });

    expect((await submit(app, 'Alex')).statusCode).toBe(200);

    const afterMine = await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/status`,
      headers: { cookie: sessionCookie('Alex') },
    });
    const afterMineBody = afterMine.json();
    expect(afterMineBody.mine).toEqual({ submitted: true, displayName: 'Alex' });
    expect(afterMineBody.partner).toEqual({ submitted: false, displayName: null });
    expect(afterMineBody.readyToCompare).toBe(false);

    expect(
      (await submit(app, 'Sam', validBody({ reflection: `${VALID_REFLECTION} Sam's own take.` })))
        .statusCode,
    ).toBe(200);

    const afterBoth = await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/status`,
      headers: { cookie: sessionCookie('Alex') },
    });
    const afterBothBody = afterBoth.json();
    expect(afterBothBody.mine).toEqual({ submitted: true, displayName: 'Alex' });
    expect(afterBothBody.partner).toEqual({ submitted: true, displayName: 'Sam' });
    expect(afterBothBody.readyToCompare).toBe(true);

    // Partner's reflection content must never appear anywhere in the response.
    const serialized = JSON.stringify(afterBothBody);
    expect(serialized).not.toContain(VALID_REFLECTION);
    expect(serialized).not.toContain("Sam's own take");
    expect(Object.keys(afterBothBody.partner)).toEqual(['submitted', 'displayName']);

    await app.close();
  });
});

describe('POST /api/v1/study-days/:date/compare', () => {
  it('returns 409 PARTNER_NOT_READY when only one participant has submitted', async () => {
    const app = buildTestApp();
    expect((await submit(app, 'Alex')).statusCode).toBe(200);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/study-days/${STUDY_DATE}/compare`,
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('PARTNER_NOT_READY');
    await app.close();
  });

  it('returns 409 PARTNER_NOT_READY when nobody has submitted', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/study-days/${STUDY_DATE}/compare`,
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('PARTNER_NOT_READY');
    await app.close();
  });

  it('succeeds once both participants have submitted, calling the mocked Mindlogic client (never a real one)', async () => {
    let mindlogicCalled = false;
    const mindlogicClient = successfulMindlogicClient(() => {
      mindlogicCalled = true;
    });
    const app = buildTestApp({ mindlogicClient });

    expect((await submit(app, 'Alex')).statusCode).toBe(200);
    expect(
      (await submit(app, 'Sam', validBody({ reflection: `${VALID_REFLECTION} Sam's own take.` })))
        .statusCode,
    ).toBe(200);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/study-days/${STUDY_DATE}/compare`,
      headers: { cookie: sessionCookie('Alex') },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('completed');
    expect(body.cached).toBe(false);
    expect(body.result.topics).toHaveLength(3);
    expect(mindlogicCalled).toBe(true);

    await app.close();
  });

  it('a second POST for the same date is served from cache with cached: true and no additional provider call', async () => {
    let mindlogicCallCount = 0;
    const mindlogicClient = successfulMindlogicClient(() => {
      mindlogicCallCount++;
    });
    const app = buildTestApp({ mindlogicClient });

    expect((await submit(app, 'Alex')).statusCode).toBe(200);
    expect(
      (await submit(app, 'Sam', validBody({ reflection: `${VALID_REFLECTION} Sam's own take.` })))
        .statusCode,
    ).toBe(200);

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/study-days/${STUDY_DATE}/compare`,
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().cached).toBe(false);

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/study-days/${STUDY_DATE}/compare`,
      headers: { cookie: sessionCookie('Sam') },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.status).toBe('completed');
    expect(secondBody.cached).toBe(true);
    expect(secondBody.result).toEqual(first.json().result);

    expect(mindlogicCallCount).toBe(1);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/comparison`,
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({ status: 'completed', result: first.json().result });

    await app.close();
  });
});

describe('date validation', () => {
  it('rejects a malformed date with 400', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/study-days/2026-13-40/status',
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('rejects a date further in the future than STUDY_DAY_MAX_FUTURE_DAYS', async () => {
    const app = buildTestApp();
    // FIXED_NOW is 2026-08-18 in Asia/Seoul; maxFutureDays is 1, so
    // 2026-08-20 is 2 days ahead and must be rejected.
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/study-days/2026-08-20/status',
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('accepts a date exactly at the future boundary', async () => {
    const app = buildTestApp();
    // 2026-08-19 is exactly 1 day ahead of 2026-08-18 (the fixed "today").
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/study-days/2026-08-19/status',
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('accepts an arbitrarily old past date', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/study-days/2000-01-01/status',
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});

describe('logging never contains sensitive content', () => {
  it('logs requestId/studyDate/participantKeyHash/durationMs but never displayName, content, or raw participantKey', async () => {
    const logStream = new PassThrough();
    let logOutput = '';
    logStream.on('data', (chunk: Buffer) => {
      logOutput += chunk.toString('utf8');
    });

    const app = buildTestApp({ loggerStream: logStream });

    expect((await submit(app, 'Alex')).statusCode).toBe(200);
    expect(
      (await submit(app, 'Sam', validBody({ reflection: `${VALID_REFLECTION} Sam's own take.` })))
        .statusCode,
    ).toBe(200);

    await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/status`,
      headers: { cookie: sessionCookie('Alex') },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/study-days/${STUDY_DATE}/compare`,
      headers: { cookie: sessionCookie('Alex') },
    });

    await app.close();
    await new Promise((resolve) => setImmediate(resolve));

    expect(logOutput).not.toContain('Alex');
    expect(logOutput).not.toContain('Sam');
    expect(logOutput).not.toContain(VALID_REFLECTION);
    expect(logOutput).not.toContain("Sam's own take");
    // The raw (unhashed) normalized participant key must never appear either.
    expect(logOutput).not.toContain('alex');
    expect(logOutput).not.toContain('sam');

    expect(logOutput).toContain('daily reflection submitted');
    expect(logOutput).toContain(STUDY_DATE);
  });
});
