import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  startTestDatabase,
  stopTestDatabase,
  truncateCreditTables,
  truncateStudyDayTables,
  type TestDatabase,
} from './helpers/postgres-container.js';
import { buildApp } from '../../src/app.js';
import { CreditService } from '../../src/services/credits/credit-service.js';
import { DrizzleCreditRepository } from '../../src/services/credits/credit-repository.js';
import { DailyReflectionService } from '../../src/services/daily-reflections/daily-reflection-service.js';
import { DrizzleDailyReflectionRepository } from '../../src/services/daily-reflections/daily-reflection-repository.js';
import { ComparisonService } from '../../src/services/daily-reflections/comparison-service.js';
import { DrizzleComparisonRepository } from '../../src/services/daily-reflections/comparison-repository.js';
import { MindlogicClient } from '../../src/services/mindlogic/client.js';
import { SESSION_COOKIE_NAME, signSession } from '../../src/services/auth/session.js';
import { reflections } from '../../src/db/schema.js';

/**
 * Combines a real, throwaway PostgreSQL instance (Testcontainers) with a
 * mocked Mindlogic HTTP layer to exercise the full daily-reflections
 * feature end to end — real study_days/reflections rows, real
 * transaction + FOR UPDATE locking, fake AI responses. Never connects to
 * a developer's local/remote database and never calls the real Mindlogic
 * API.
 */

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, 180_000);

afterAll(async () => {
  if (testDb) await stopTestDatabase(testDb);
}, 60_000);

beforeEach(async () => {
  await truncateCreditTables(testDb.pool);
  await truncateStudyDayTables(testDb.pool);
});

const SESSION_SECRET = 'integration-study-days-session-secret-at-least-32c';
const STUDY_DATE = '2026-08-17';
const FIXED_NOW = new Date('2026-08-18T03:00:00.000Z'); // 2026-08-18 12:00 KST
const VALID_REFLECTION =
  'This reflection is deliberately written to be well over fifty non-blank characters long so it passes validation.';

function sessionCookie(name: string) {
  const token = signSession({ name }, SESSION_SECRET, 2592000);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    article: { id: 'article-1', title: 'The Quiet Revolution', sourceUrl: null, summary: null },
    reflection: VALID_REFLECTION,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildRealDailyReflectionService() {
  return new DailyReflectionService(new DrizzleDailyReflectionRepository(testDb.db));
}

function buildRealComparisonService() {
  return new ComparisonService(new DrizzleComparisonRepository(testDb.db));
}

function buildRealCreditService(monthlyLimit = 5000) {
  return new CreditService(new DrizzleCreditRepository(testDb.db), monthlyLimit);
}

function buildTestApp(
  overrides: Partial<{
    now: () => Date;
    maxFutureDays: number;
    dailyReflectionService: DailyReflectionService;
  }> = {},
) {
  return buildApp({
    checkDatabaseConnection: async () => true,
    creditService: buildRealCreditService(),
    mindlogicClient: new MindlogicClient({
      apiKey: 'test-fake-key',
      baseUrl: 'https://example.com/v1/gateway',
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse(200, {
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
      ),
    }),
    dailyReflectionService: overrides.dailyReflectionService ?? buildRealDailyReflectionService(),
    comparisonService: buildRealComparisonService(),
    studyDaysRoutesOptions: {
      sessionSecret: SESSION_SECRET,
      maxFutureDays: overrides.maxFutureDays ?? 1,
      now: overrides.now ?? (() => FIXED_NOW),
    },
  });
}

describe('daily reflections — real PostgreSQL end to end', () => {
  it('two real distinct submitters can both succeed and a genuine 3rd is rejected', async () => {
    const app = buildTestApp();

    const alex = await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: sessionCookie('Alex') },
      payload: validBody(),
    });
    expect(alex.statusCode).toBe(200);

    const sam = await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: sessionCookie('Sam') },
      payload: validBody({ reflection: `${VALID_REFLECTION} Sam's own distinct take.` }),
    });
    expect(sam.statusCode).toBe(200);

    const jordan = await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: sessionCookie('Jordan') },
      payload: validBody({ reflection: `${VALID_REFLECTION} Jordan is a genuine 3rd.` }),
    });
    expect(jordan.statusCode).toBe(409);
    expect(jordan.json().error.code).toBe('PARTICIPANT_LIMIT_REACHED');

    const rows = await testDb.db
      .select()
      .from(reflections)
      .where(eq(reflections.studyDate, STUDY_DATE));
    expect(rows).toHaveLength(2);

    await app.close();
  });

  it('status and compare reflect real database state, and compare calls the mocked Mindlogic client', async () => {
    const app = buildTestApp();

    await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: sessionCookie('Alex') },
      payload: validBody(),
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: sessionCookie('Sam') },
      payload: validBody({ reflection: `${VALID_REFLECTION} Sam's own distinct take.` }),
    });

    const status = await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/status`,
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(status.json().readyToCompare).toBe(true);

    const compare = await app.inject({
      method: 'POST',
      url: `/api/v1/study-days/${STUDY_DATE}/compare`,
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(compare.statusCode).toBe(200);
    expect(compare.json().status).toBe('completed');
    expect(compare.json().result.topics).toHaveLength(3);

    await app.close();
  });

  it('time-fixed: rejects a date further in the future than STUDY_DAY_MAX_FUTURE_DAYS, accepts the boundary', async () => {
    const app = buildTestApp({ maxFutureDays: 1 });

    // FIXED_NOW is 2026-08-18 in Asia/Seoul.
    const tooFar = await app.inject({
      method: 'GET',
      url: '/api/v1/study-days/2026-08-20/status',
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(tooFar.statusCode).toBe(400);

    const boundary = await app.inject({
      method: 'GET',
      url: '/api/v1/study-days/2026-08-19/status',
      headers: { cookie: sessionCookie('Alex') },
    });
    expect(boundary.statusCode).toBe(200);

    await app.close();
  });
});

describe('daily reflections — real concurrency race over the participant limit', () => {
  it('~20 concurrent PUT submissions for the same date collapse into exactly 2 reflections rows, no more', async () => {
    const app = buildTestApp();
    const names = Array.from({ length: 20 }, (_, i) => `Participant-${i}`);

    // Fired concurrently — not sequentially awaited — so all 20 genuinely
    // race for the same study_days row inside Postgres. This is the test
    // that actually proves the FOR UPDATE locking works under real
    // contention, not just in the single-threaded in-memory fake used by
    // tests/study-days.test.ts.
    const responses = await Promise.all(
      names.map((name) =>
        app.inject({
          method: 'PUT',
          url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
          headers: { cookie: sessionCookie(name) },
          payload: validBody({ reflection: `${VALID_REFLECTION} From ${name}.` }),
        }),
      ),
    );

    const statusCodes = responses.map((r) => r.statusCode);
    expect(statusCodes.filter((code) => code === 200)).toHaveLength(2);
    expect(statusCodes.filter((code) => code === 409)).toHaveLength(18);
    for (const response of responses) {
      if (response.statusCode === 409) {
        expect(response.json().error.code).toBe('PARTICIPANT_LIMIT_REACHED');
      }
    }

    const rows = await testDb.db
      .select()
      .from(reflections)
      .where(eq(reflections.studyDate, STUDY_DATE));
    expect(rows).toHaveLength(2);

    const distinctParticipants = new Set(rows.map((row) => row.participantKey));
    expect(distinctParticipants.size).toBe(2);

    await app.close();
  });
});
