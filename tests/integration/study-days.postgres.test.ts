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
import { reflections, studyDays } from '../../src/db/schema.js';

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
  it('loads a manually inserted submitted reflection and updates the same id', async () => {
    const originalId = crypto.randomUUID();
    await testDb.db.insert(studyDays).values({
      studyDate: STUDY_DATE,
      articleId: 'article-1',
      articleTitle: 'The Quiet Revolution',
    });
    await testDb.db.insert(reflections).values({
      id: originalId,
      studyDate: STUDY_DATE,
      participantKey: 'hyunji',
      displayName: 'A display name that is not an identity',
      content: VALID_REFLECTION,
      status: 'submitted',
      submittedAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    const app = buildTestApp();
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(read.json().reflection).toMatchObject({ id: originalId, content: VALID_REFLECTION });

    const update = await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: sessionCookie('hyunji') },
      payload: validBody({ reflection: `${VALID_REFLECTION} Updated.` }),
    });
    expect(update.json()).toMatchObject({ id: originalId, updated: true });
    const rows = await testDb.db.select().from(reflections).where(eq(reflections.studyDate, STUDY_DATE));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.submittedAt).toEqual(FIXED_NOW);
    expect(rows[0]?.updatedAt.getTime()).toBeGreaterThanOrEqual(FIXED_NOW.getTime());
    await app.close();
  });

  it('the two real production participants can both succeed via the real HTTP+DB path', async () => {
    const app = buildTestApp();

    const hyunji = await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: sessionCookie('hyunji') },
      payload: validBody(),
    });
    expect(hyunji.statusCode).toBe(200);

    const hyeonseo = await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: sessionCookie('hyeonseo') },
      payload: validBody({ reflection: `${VALID_REFLECTION} hyeonseo's own distinct take.` }),
    });
    expect(hyeonseo.statusCode).toBe(200);

    const rows = await testDb.db
      .select()
      .from(reflections)
      .where(eq(reflections.studyDate, STUDY_DATE));
    expect(rows).toHaveLength(2);

    await app.close();
  });

  // A genuine 3rd HTTP-authenticated participant is no longer reachable in
  // production (the session-gate allow-list only admits hyunji/hyeonseo —
  // see src/plugins/session-gate.ts), so this exercises the real
  // Postgres-backed repository's participant-limit enforcement directly,
  // independent of who can authenticate. The 20-concurrent-caller version
  // below covers the FOR UPDATE locking under real contention.
  it('the real Postgres repository still rejects a genuine 3rd participant with participant_limit_reached', async () => {
    const repository = new DrizzleDailyReflectionRepository(testDb.db);
    const article = {
      id: 'article-1',
      title: 'The Quiet Revolution',
      sourceUrl: null,
      summary: null,
    };
    const submission = (participantKey: string, displayName: string, content: string) => ({
      studyDate: STUDY_DATE,
      article,
      participantKey,
      displayName,
      content,
      submittedAt: new Date(),
    });

    const first = await repository.submitReflection(
      submission('hyunji', 'hyunji', VALID_REFLECTION),
    );
    expect(first).toMatchObject({ ok: true });

    const second = await repository.submitReflection(
      submission('hyeonseo', 'hyeonseo', `${VALID_REFLECTION} hyeonseo's own distinct take.`),
    );
    expect(second).toMatchObject({ ok: true });

    const third = await repository.submitReflection(
      submission('a-genuine-third-participant', 'Third', `${VALID_REFLECTION} a genuine 3rd.`),
    );
    expect(third).toEqual({ ok: false, reason: 'participant_limit_reached' });

    const rows = await testDb.db
      .select()
      .from(reflections)
      .where(eq(reflections.studyDate, STUDY_DATE));
    expect(rows).toHaveLength(2);
  });

  it('status and compare reflect real database state, and compare calls the mocked Mindlogic client', async () => {
    const app = buildTestApp();

    await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: sessionCookie('hyunji') },
      payload: validBody(),
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
      headers: { cookie: sessionCookie('hyeonseo') },
      payload: validBody({ reflection: `${VALID_REFLECTION} hyeonseo's own distinct take.` }),
    });

    const status = await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/status`,
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(status.json().readyToCompare).toBe(true);

    const compare = await app.inject({
      method: 'POST',
      url: `/api/v1/study-days/${STUDY_DATE}/compare`,
      headers: { cookie: sessionCookie('hyunji') },
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
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(tooFar.statusCode).toBe(400);

    const boundary = await app.inject({
      method: 'GET',
      url: '/api/v1/study-days/2026-08-19/status',
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(boundary.statusCode).toBe(200);

    await app.close();
  });
});

describe('daily reflections — real concurrency race over the participant limit', () => {
  // Exercises the repository directly (not through HTTP/session-gate): a
  // real 20-distinct-caller race is no longer reachable via the production
  // auth path (only hyunji/hyeonseo can authenticate at all), but the
  // Postgres-backed FOR UPDATE locking in DrizzleDailyReflectionRepository
  // must still hold under real contention regardless of who's calling it.
  it('~20 concurrent submitReflection calls for the same date collapse into exactly 2 reflections rows, no more', async () => {
    const repository = new DrizzleDailyReflectionRepository(testDb.db);
    const article = {
      id: 'article-1',
      title: 'The Quiet Revolution',
      sourceUrl: null,
      summary: null,
    };
    const participantKeys = Array.from({ length: 20 }, (_, i) => `participant-${i}`);

    // Fired concurrently — not sequentially awaited — so all 20 genuinely
    // race for the same study_days row inside Postgres. This is the test
    // that actually proves the FOR UPDATE locking works under real
    // contention, not just in the single-threaded in-memory fake used by
    // tests/study-days.test.ts / tests/daily-reflection-repository.test.ts.
    const results = await Promise.all(
      participantKeys.map((participantKey) =>
        repository.submitReflection({
          studyDate: STUDY_DATE,
          article,
          participantKey,
          displayName: participantKey,
          content: `${VALID_REFLECTION} From ${participantKey}.`,
          submittedAt: new Date(),
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok)).toHaveLength(18);
    for (const result of results) {
      if (!result.ok) expect(result.reason).toBe('participant_limit_reached');
    }

    const rows = await testDb.db
      .select()
      .from(reflections)
      .where(eq(reflections.studyDate, STUDY_DATE));
    expect(rows).toHaveLength(2);

    const distinctParticipants = new Set(rows.map((row) => row.participantKey));
    expect(distinctParticipants.size).toBe(2);
  });
});
