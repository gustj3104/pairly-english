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
import { DiscussionFeedbackService } from '../../src/services/discussion-feedback/discussion-feedback-service.js';
import { DrizzleDiscussionFeedbackRepository } from '../../src/services/discussion-feedback/discussion-feedback-repository.js';
import { MindlogicClient } from '../../src/services/mindlogic/client.js';
import { SESSION_COOKIE_NAME, signSession } from '../../src/services/auth/session.js';
import {
  creditUsageRecords,
  studyDayComparisons,
  studyDayDiscussions,
} from '../../src/db/schema.js';

/**
 * Combines a real, throwaway PostgreSQL instance (Testcontainers) with a
 * mocked Mindlogic HTTP layer to prove the discussion-transcript +
 * feedback feature's real CHECK constraint, credit-ledger, and claim
 * locking behavior against real PostgreSQL — not just the single-threaded
 * in-memory fake used by tests/discussion-feedback.test.ts. Also asserts
 * study_day_comparisons is left completely untouched by any of this new
 * code. Never connects to a developer's local/remote database and never
 * calls the real Mindlogic API.
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

const SESSION_SECRET = 'integration-discussion-feedback-session-secret-32c';
const STUDY_DATE = '2026-08-17';
const FIXED_NOW = new Date('2026-08-18T03:00:00.000Z'); // 2026-08-18 12:00 KST
const VALID_REFLECTION =
  'This reflection is deliberately written to be well over fifty non-blank characters long so it passes validation.';

function sessionCookie(name: string) {
  const token = signSession({ name }, SESSION_SECRET, 2592000);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function reflectionBody(overrides: Record<string, unknown> = {}) {
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
      {
        question: 'q1?',
        reason: 'r1',
        difficulty: 'Intermediate',
        discussionGuide: { openingQuestion: 'o1?', followUpQuestions: ['f1?', 'f2?', 'f3?'] },
      },
      {
        question: 'q2?',
        reason: 'r2',
        difficulty: 'Advanced',
        discussionGuide: { openingQuestion: 'o2?', followUpQuestions: ['g1?', 'g2?', 'g3?'] },
      },
      {
        question: 'q3?',
        reason: 'r3',
        difficulty: 'Intermediate',
        discussionGuide: { openingQuestion: 'o3?', followUpQuestions: ['h1?', 'h2?', 'h3?'] },
      },
    ],
  };
}

function validFeedbackBody() {
  return {
    overallSummary: 'A good discussion overall.',
    topicCoverage: { score: 4, comment: 'Covered the topic well.' },
    participants: [
      {
        participantKey: 'hyunji',
        displayName: 'Hyunji',
        strengths: ['Used varied vocabulary.'],
        improvements: [
          {
            original: 'i think this is intresting',
            suggested: 'I think this is interesting',
            explanation: 'Spelling correction.',
          },
        ],
        usefulExpressions: ['in my opinion'],
      },
      {
        participantKey: 'hyeonseo',
        displayName: 'Hyeonseo',
        strengths: ['Clear pronunciation of key terms.'],
        improvements: [],
        usefulExpressions: ['that makes sense'],
      },
    ],
    sharedDiscussionTips: ['Try to ask more follow-up questions.'],
    nextQuestion: 'What surprised you most about this topic?',
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function smartMindlogicClient(
  onCall?: (feature: 'reflection_comparison' | 'discussion_feedback') => void,
) {
  const fetchImpl = async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as {
      response_format?: { json_schema?: { name?: string } };
    };
    const name = payload.response_format?.json_schema?.name;
    if (name === 'discussion_feedback') {
      onCall?.('discussion_feedback');
      return jsonResponse(200, {
        id: 'chatcmpl-feedback',
        model: 'gpt-5.6-luna',
        choices: [{ message: { role: 'assistant', content: JSON.stringify(validFeedbackBody()) } }],
        usage: { prompt_tokens: 400, completion_tokens: 300, total_tokens: 700 },
      });
    }
    onCall?.('reflection_comparison');
    return jsonResponse(200, {
      id: 'chatcmpl-compare',
      model: 'gpt-5.6-luna',
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

function delayedFeedbackMindlogicClient(onFeedbackCall?: () => void) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl = async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as {
      response_format?: { json_schema?: { name?: string } };
    };
    const name = payload.response_format?.json_schema?.name;
    if (name === 'discussion_feedback') {
      onFeedbackCall?.();
      await gate;
      return jsonResponse(200, {
        id: 'chatcmpl-feedback',
        model: 'gpt-5.6-luna',
        choices: [{ message: { role: 'assistant', content: JSON.stringify(validFeedbackBody()) } }],
        usage: { prompt_tokens: 400, completion_tokens: 300, total_tokens: 700 },
      });
    }
    return jsonResponse(200, {
      id: 'chatcmpl-compare',
      model: 'gpt-5.6-luna',
      choices: [{ message: { role: 'assistant', content: JSON.stringify(validComparisonBody()) } }],
      usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
    });
  };
  const client = new MindlogicClient({
    apiKey: 'test-fake-key',
    baseUrl: 'https://example.com/v1/gateway',
    fetchImpl,
  });
  return { client, release: () => release() };
}

function buildTestApp(overrides: Partial<{ mindlogicClient: MindlogicClient }> = {}) {
  return buildApp({
    checkDatabaseConnection: async () => true,
    creditService: new CreditService(new DrizzleCreditRepository(testDb.db), 5000),
    mindlogicClient: overrides.mindlogicClient ?? smartMindlogicClient(),
    dailyReflectionService: new DailyReflectionService(
      new DrizzleDailyReflectionRepository(testDb.db),
    ),
    comparisonService: new ComparisonService(new DrizzleComparisonRepository(testDb.db)),
    discussionFeedbackService: new DiscussionFeedbackService(
      new DrizzleDiscussionFeedbackRepository(testDb.db),
    ),
    studyDaysRoutesOptions: {
      sessionSecret: SESSION_SECRET,
      maxFutureDays: 1,
      now: () => FIXED_NOW,
    },
    discussionFeedbackRoutesOptions: {
      sessionSecret: SESSION_SECRET,
      maxFutureDays: 1,
      now: () => FIXED_NOW,
    },
  });
}

async function submit(
  app: ReturnType<typeof buildApp>,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/study-days/${STUDY_DATE}/reflection`,
    headers: { cookie: sessionCookie(name) },
    payload: reflectionBody(overrides),
  });
}

async function submitBoth(app: ReturnType<typeof buildApp>) {
  expect((await submit(app, 'hyunji')).statusCode).toBe(200);
  expect(
    (await submit(app, 'hyeonseo', { reflection: `${VALID_REFLECTION} A distinct partner take.` }))
      .statusCode,
  ).toBe(200);
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

function put(app: ReturnType<typeof buildApp>, path: string, name: string, payload: object) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/study-days/${STUDY_DATE}${path}`,
    headers: { cookie: sessionCookie(name) },
    payload,
  });
}

const HYUNJI_TEXT = 'I think this is intresting because it affects everyone.';
const HYEONSEO_TEXT = 'I agree with you, but I also worry about the cost.';

function validSegments() {
  return [
    { id: 'seg-1', startMs: 0, endMs: 4000, text: HYUNJI_TEXT, speakerKey: 'hyunji' as const },
    {
      id: 'seg-2',
      startMs: 4000,
      endMs: 9000,
      text: HYEONSEO_TEXT,
      speakerKey: 'hyeonseo' as const,
    },
  ];
}

async function setUpReadyComparison(app: ReturnType<typeof buildApp>) {
  await submitBoth(app);
  expect((await post(app, '/compare')).statusCode).toBe(200);
  expect((await put(app, '/discussion/topic', 'hyunji', { topicIndex: 0 })).statusCode).toBe(200);
}

describe('real transcript CRUD via the Drizzle repository', () => {
  it('persists a transcript across requests and both participants can read it', async () => {
    const app = buildTestApp();
    await submitBoth(app);

    const saved = await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });
    expect(saved.statusCode).toBe(200);

    const [row] = await testDb.db
      .select()
      .from(studyDayDiscussions)
      .where(eq(studyDayDiscussions.studyDate, STUDY_DATE));
    expect(row?.transcript?.segments).toHaveLength(2);
    expect(row?.topicIndex).toBe(0);
    expect(row?.transcriptFingerprint).toBeTruthy();

    const read = await get(app, '/discussion/transcript', 'hyeonseo');
    expect(read.json().segments).toHaveLength(2);

    await app.close();
  });
});

describe('real CHECK constraint enforcement', () => {
  it('rejects a completed feedback_status with a null feedback_result at the database level', async () => {
    const app = buildTestApp();
    await submitBoth(app);
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });

    await expect(
      testDb.pool.query(
        `update study_day_discussions set feedback_status = 'completed', feedback_result = NULL where study_date = $1`,
        [STUDY_DATE],
      ),
    ).rejects.toThrow(/study_day_discussions_completed_has_result/);

    await app.close();
  });
});

describe('real credit-reservation row locking and uniqueness', () => {
  it('generates feedback once, records exactly one credit_usage_records row, and reuses the result by fingerprint', async () => {
    let feedbackCalls = 0;
    const app = buildTestApp({
      mindlogicClient: smartMindlogicClient((feature) => {
        if (feature === 'discussion_feedback') feedbackCalls++;
      }),
    });
    await setUpReadyComparison(app);
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });

    const first = await post(app, '/discussion/feedback');
    expect(first.statusCode).toBe(200);
    expect(feedbackCalls).toBe(1);

    const [row] = await testDb.db
      .select()
      .from(studyDayDiscussions)
      .where(eq(studyDayDiscussions.studyDate, STUDY_DATE));
    expect(row?.status).toBe('completed');
    expect(row?.result).not.toBeNull();
    expect(row?.requestId).toBeTruthy();

    const creditRows = await testDb.db
      .select()
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.requestId, row!.requestId!));
    expect(creditRows).toHaveLength(1);
    expect(creditRows[0]?.feature).toBe('grammar_feedback');
    expect(creditRows[0]?.status).toBe('completed');

    const second = await post(app, '/discussion/feedback', 'hyeonseo');
    expect(second.statusCode).toBe(200);
    expect(feedbackCalls).toBe(1);

    const allCreditRows = await testDb.db
      .select()
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.feature, 'grammar_feedback'));
    expect(allCreditRows).toHaveLength(1);

    await app.close();
  });

  it('real concurrency: ~10 concurrent POST .../discussion/feedback calls result in exactly one Mindlogic call', async () => {
    let feedbackCalls = 0;
    const { client, release } = delayedFeedbackMindlogicClient(() => feedbackCalls++);
    const app = buildTestApp({ mindlogicClient: client });
    await setUpReadyComparison(app);
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });

    const responsesPromise = Promise.all(
      Array.from({ length: 10 }, () =>
        post(app, '/discussion/feedback', Math.random() < 0.5 ? 'hyunji' : 'hyeonseo'),
      ),
    );
    // Give every claim attempt a chance to land against the row lock before
    // the winner's Mindlogic call is allowed to resolve.
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    const responses = await responsesPromise;

    expect(feedbackCalls).toBe(1);
    for (const response of responses) {
      expect([200, 202]).toContain(response.statusCode);
    }

    const [row] = await testDb.db
      .select()
      .from(studyDayDiscussions)
      .where(eq(studyDayDiscussions.studyDate, STUDY_DATE));
    expect(row?.status).toBe('completed');

    const creditRows = await testDb.db
      .select()
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.feature, 'grammar_feedback'));
    expect(creditRows).toHaveLength(1);

    await app.close();
  });
});

describe('study_day_comparisons is completely untouched by discussion-transcript/feedback operations', () => {
  it('leaves the comparison row byte-for-byte unchanged after transcript + feedback flows', async () => {
    const app = buildTestApp();
    await setUpReadyComparison(app);

    const [beforeRow] = await testDb.db
      .select()
      .from(studyDayComparisons)
      .where(eq(studyDayComparisons.studyDate, STUDY_DATE));
    expect(beforeRow).toBeDefined();

    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });
    await post(app, '/discussion/feedback');
    // Edit the transcript again (goes stale) and regenerate, to exercise
    // more of the write path against the same comparison row.
    await put(app, '/discussion/transcript', 'hyeonseo', {
      topicIndex: 0,
      segments: [
        ...validSegments(),
        { id: 'seg-3', startMs: 9000, endMs: 10000, text: 'One more thing.', speakerKey: 'hyunji' },
      ],
    });
    await post(app, '/discussion/feedback');

    const [afterRow] = await testDb.db
      .select()
      .from(studyDayComparisons)
      .where(eq(studyDayComparisons.studyDate, STUDY_DATE));
    expect(afterRow).toEqual(beforeRow);
    expect((afterRow?.result as { selectedTopicIndex?: number })?.selectedTopicIndex).toBe(0);
    expect((afterRow?.result as { topics: unknown[] })?.topics).toHaveLength(3);
    expect((afterRow?.result as { commonGround: unknown[] })?.commonGround).toEqual(
      (beforeRow?.result as { commonGround: unknown[] })?.commonGround,
    );
    expect((afterRow?.result as { differences: unknown[] })?.differences).toEqual(
      (beforeRow?.result as { differences: unknown[] })?.differences,
    );

    await app.close();
  });
});
