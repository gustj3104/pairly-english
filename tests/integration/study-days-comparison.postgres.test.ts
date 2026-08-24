import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { creditUsageRecords, studyDayComparisons } from '../../src/db/schema.js';

/**
 * Combines a real, throwaway PostgreSQL instance (Testcontainers) with a
 * mocked Mindlogic HTTP layer to prove the two-phase claim/generate design
 * (README "Study-day comparison") is actually race-safe under real
 * concurrent load — not just correct against the single-threaded in-memory
 * fake used by tests/study-days-comparison.test.ts. Never connects to a
 * developer's local/remote database and never calls the real Mindlogic
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

const SESSION_SECRET = 'integration-comparison-session-secret-at-least-32c';
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
    article: {
      id: 'article-1',
      title: 'The Quiet Revolution',
      sourceUrl: null,
      summary: 'A summary that must never appear in any log line.',
    },
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

function successfulMindlogicClient(onCall?: () => void, delayMs = 0) {
  const fetchImpl = async () => {
    onCall?.();
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
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

function failingMindlogicClient(onCall?: () => void, delayMs = 0) {
  const fetchImpl = async () => {
    onCall?.();
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return jsonResponse(401, { message: 'unauthorized' });
  };
  return new MindlogicClient({
    apiKey: 'test-fake-key',
    baseUrl: 'https://example.com/v1/gateway',
    fetchImpl,
  });
}

function timingOutMindlogicClient(onCall?: () => void) {
  const fetchImpl = (_url: unknown, init?: RequestInit) => {
    onCall?.();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        reject(abortError);
      });
    });
  };
  return new MindlogicClient({
    apiKey: 'test-fake-key',
    baseUrl: 'https://example.com/v1/gateway',
    timeoutMs: 5,
    fetchImpl,
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
    mindlogicClient: MindlogicClient;
    loggerStream: NodeJS.WritableStream;
  }> = {},
) {
  return buildApp({
    checkDatabaseConnection: async () => true,
    creditService: buildRealCreditService(),
    mindlogicClient: overrides.mindlogicClient ?? successfulMindlogicClient(),
    dailyReflectionService: buildRealDailyReflectionService(),
    comparisonService: buildRealComparisonService(),
    loggerStream: overrides.loggerStream,
    studyDaysRoutesOptions: {
      sessionSecret: SESSION_SECRET,
      maxFutureDays: 1,
      now: () => FIXED_NOW,
    },
  });
}

async function submit(app: ReturnType<typeof buildApp>, name: string, reflectionSuffix = '') {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
    headers: { cookie: sessionCookie(name) },
    payload: validBody({ reflection: `${VALID_REFLECTION}${reflectionSuffix}` }),
  });
}

async function submitBoth(app: ReturnType<typeof buildApp>) {
  expect((await submit(app, 'hyunji')).statusCode).toBe(200);
  expect((await submit(app, 'hyeonseo', " Sam's own distinct take.")).statusCode).toBe(200);
}

function post(app: ReturnType<typeof buildApp>, path: string, name = 'hyunji') {
  return app.inject({
    method: 'POST',
    url: `/api/v1/study-days/${STUDY_DATE}${path}`,
    headers: { cookie: sessionCookie(name) },
  });
}

function get(app: ReturnType<typeof buildApp>, path: string, name = 'hyunji') {
  return app.inject({
    method: 'GET',
    url: `/api/v1/study-days/${STUDY_DATE}${path}`,
    headers: { cookie: sessionCookie(name) },
  });
}

describe('real concurrency: ~20 concurrent POST /compare for the same date', () => {
  it('the provider is called exactly once, and exactly one credit reservation exists for the winning request_id', async () => {
    let callCount = 0;
    // A small artificial delay widens the race window so followers reliably
    // observe 'processing' (in_progress) rather than 'completed' — the call
    // count assertion holds either way, but this makes the race itself real.
    const mindlogicClient = successfulMindlogicClient(() => callCount++, 50);
    const app = buildTestApp({ mindlogicClient });
    await submitBoth(app);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        post(app, '/compare', Math.random() < 0.5 ? 'hyunji' : 'hyeonseo'),
      ),
    );

    expect(callCount).toBe(1);

    const statusCodes = responses.map((r) => r.statusCode).sort();
    // Every response must be one of: 200 (claimed-and-completed or
    // cached), or 202 (in_progress) — never an error.
    for (const code of statusCodes) {
      expect([200, 202]).toContain(code);
    }

    const [comparisonRow] = await testDb.db
      .select()
      .from(studyDayComparisons)
      .where(eq(studyDayComparisons.studyDate, STUDY_DATE));
    expect(comparisonRow).toBeDefined();
    expect(comparisonRow?.status).toBe('completed');

    const creditRows = await testDb.db
      .select()
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.requestId, comparisonRow!.requestId));
    expect(creditRows).toHaveLength(1);

    // No other credit_usage_records row was created by this race either.
    const allCreditRows = await testDb.db.select().from(creditUsageRecords);
    expect(allCreditRows).toHaveLength(1);

    await app.close();
  });
});

describe('real concurrency: reflection edits versus comparison generation', () => {
  it('rejects an edit while the shared comparison row is processing', async () => {
    const app = buildTestApp({ mindlogicClient: successfulMindlogicClient(undefined, 200) });
    await submitBoth(app);
    const comparison = post(app, '/compare', 'hyunji');
    await new Promise((resolve) => setTimeout(resolve, 40));

    const edit = await submit(app, 'hyeonseo', ' Edited while processing.');
    expect(edit.statusCode).toBe(409);
    expect(edit.json().error.code).toBe('COMPARISON_IN_PROGRESS');
    await comparison;
    await app.close();
  });
});

describe('caching', () => {
  it('completed result is persisted and re-querying does not call the provider again', async () => {
    let callCount = 0;
    const mindlogicClient = successfulMindlogicClient(() => callCount++);
    const app = buildTestApp({ mindlogicClient });
    await submitBoth(app);

    const first = await post(app, '/compare');
    expect(first.statusCode).toBe(200);
    expect(first.json().cached).toBe(false);
    expect(callCount).toBe(1);

    const [row] = await testDb.db
      .select()
      .from(studyDayComparisons)
      .where(eq(studyDayComparisons.studyDate, STUDY_DATE));
    expect(row?.status).toBe('completed');
    expect(row?.result).not.toBeNull();

    const second = await post(app, '/compare', 'hyeonseo');
    expect(second.statusCode).toBe(200);
    expect(second.json().cached).toBe(true);
    expect(second.json().result).toEqual(first.json().result);
    expect(callCount).toBe(1);

    const getResponse = await get(app, '/comparison');
    expect(getResponse.json()).toEqual({ status: 'completed', result: first.json().result });

    await app.close();
  });
});

describe('failed is never auto-retried; explicit retry re-attempts with a new request_id', () => {
  it('POST /compare never re-calls the provider after a failure; POST .../retry does, with a new request_id, leaving the old credit_usage_records row untouched', async () => {
    let callCount = 0;
    const failing = failingMindlogicClient(() => callCount++);
    const app = buildTestApp({ mindlogicClient: failing });
    await submitBoth(app);

    const first = await post(app, '/compare');
    expect(first.statusCode).toBe(502);
    expect(callCount).toBe(1);

    const [failedRow] = await testDb.db
      .select()
      .from(studyDayComparisons)
      .where(eq(studyDayComparisons.studyDate, STUDY_DATE));
    expect(failedRow?.status).toBe('failed');
    const oldRequestId = failedRow!.requestId;

    // Repeated plain POSTs never re-call the provider.
    await post(app, '/compare');
    await post(app, '/compare');
    expect(callCount).toBe(1);

    const [oldCreditRow] = await testDb.db
      .select()
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.requestId, oldRequestId));
    expect(oldCreditRow).toBeDefined();
    expect(oldCreditRow?.status).toBe('released');

    const retry = await post(app, '/comparison/retry');
    expect(retry.statusCode).toBe(502);
    expect(callCount).toBe(2);

    const [retriedRow] = await testDb.db
      .select()
      .from(studyDayComparisons)
      .where(eq(studyDayComparisons.studyDate, STUDY_DATE));
    expect(retriedRow?.requestId).not.toBe(oldRequestId);
    expect(retriedRow?.status).toBe('failed');

    // The old failed attempt's credit_usage_records row is untouched —
    // still present, still exactly as it was.
    const [stillThere] = await testDb.db
      .select()
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.requestId, oldRequestId));
    expect(stillThere).toBeDefined();
    expect(stillThere?.status).toBe('released');

    // And a separate row now exists for the new request_id.
    const [newCreditRow] = await testDb.db
      .select()
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.requestId, retriedRow!.requestId));
    expect(newCreditRow).toBeDefined();

    const allCreditRows = await testDb.db.select().from(creditUsageRecords);
    expect(allCreditRows).toHaveLength(2);

    await app.close();
  });
});

describe('concurrent retries on the same failed row', () => {
  it('the provider is called exactly once more, not once per concurrent retry request', async () => {
    let callCount = 0;
    // Delayed so all 10 concurrent retries' claimRetry() calls land while
    // the winner's phase 2 is still in flight — otherwise the winner could
    // finish (flipping the row back to 'failed') before a slow-to-start
    // follower even attempts its claim, which would let that follower
    // legitimately re-claim too and make the "exactly once more" assertion
    // flaky rather than a real proof of the locking.
    const failing = failingMindlogicClient(() => callCount++, 50);
    const app = buildTestApp({ mindlogicClient: failing });
    await submitBoth(app);

    await post(app, '/compare');
    expect(callCount).toBe(1);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => post(app, '/comparison/retry')),
    );
    expect(callCount).toBe(2);

    const statusCodes = responses.map((r) => r.statusCode).sort();
    // Exactly one winner reaches phase 2 (502, since the mock still
    // fails); everyone else sees 202 ('processing', since the winner's
    // delayed phase 2 hadn't settled yet when they checked) — nobody but
    // the winner ever triggers a provider call.
    for (const code of statusCodes) {
      expect([202, 502]).toContain(code);
    }
    expect(statusCodes.filter((code) => code === 502)).toHaveLength(1);
    expect(statusCodes.filter((code) => code === 202)).toHaveLength(9);

    await app.close();
  });
});

describe('reconciliation_pending', () => {
  it('a timeout settles the comparison to reconciliation_pending, and a subsequent POST /compare never calls the provider again', async () => {
    let callCount = 0;
    const timingOut = timingOutMindlogicClient(() => callCount++);
    const app = buildTestApp({ mindlogicClient: timingOut });
    await submitBoth(app);

    const first = await post(app, '/compare');
    expect(first.statusCode).toBe(409);
    expect(first.json()).toEqual({ status: 'reconciliation_pending' });
    expect(callCount).toBe(1);

    const [row] = await testDb.db
      .select()
      .from(studyDayComparisons)
      .where(eq(studyDayComparisons.studyDate, STUDY_DATE));
    expect(row?.status).toBe('reconciliation_pending');

    const second = await post(app, '/compare');
    expect(second.statusCode).toBe(409);
    expect(callCount).toBe(1);

    const retry = await post(app, '/comparison/retry');
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe('RECONCILIATION_PENDING');
    expect(callCount).toBe(1);

    await app.close();
  });
});

describe('corrupted stored result', () => {
  it('GET .../comparison detects a corrupted result JSONB and does not return it as a valid completed response', async () => {
    const app = buildTestApp();
    await submitBoth(app);

    const compareResponse = await post(app, '/compare');
    expect(compareResponse.statusCode).toBe(200);

    // Bypass the app entirely — manually corrupt the stored result, the
    // way a bad manual DB operation or a future bug might.
    await testDb.pool.query(
      `update study_day_comparisons set result = '{"totally": "wrong shape"}'::jsonb where study_date = $1`,
      [STUDY_DATE],
    );

    const getResponse = await get(app, '/comparison');
    expect(getResponse.statusCode).toBe(500);
    expect(getResponse.json()).toEqual({ status: 'failed', code: 'CORRUPTED_RESULT' });
    // Never the malformed blob passed through as if valid.
    expect(JSON.stringify(getResponse.json())).not.toContain('totally');

    await app.close();
  });
});

describe('logging never contains reflection text, article summary, or the AI result', () => {
  it('captures the full lifecycle and asserts on the log stream', async () => {
    const logStream = new PassThrough();
    let logOutput = '';
    logStream.on('data', (chunk: Buffer) => {
      logOutput += chunk.toString('utf8');
    });

    const app = buildTestApp({ loggerStream: logStream });
    await submitBoth(app);
    await post(app, '/compare');
    await get(app, '/comparison');
    await post(app, '/comparison/retry').catch(() => undefined); // ALREADY_COMPLETED, fine either way

    await app.close();
    await new Promise((resolve) => setImmediate(resolve));

    expect(logOutput).not.toContain('hyunji');
    expect(logOutput).not.toContain('hyeonseo');
    expect(logOutput).not.toContain(VALID_REFLECTION);
    expect(logOutput).not.toContain('A summary that must never appear in any log line');
    expect(logOutput).not.toContain('commonGround');
    expect(logOutput).not.toContain('differences');
  });
});
