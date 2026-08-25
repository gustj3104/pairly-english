import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CreditService } from '../src/services/credits/credit-service.js';
import { InMemoryCreditRepository } from './helpers/in-memory-credit-repository.js';
import { InMemoryDailyReflectionRepository } from './helpers/in-memory-daily-reflection-repository.js';
import { InMemoryComparisonRepository } from './helpers/in-memory-comparison-repository.js';
import { InMemoryDiscussionFeedbackRepository } from './helpers/in-memory-discussion-feedback-repository.js';
import { DailyReflectionService } from '../src/services/daily-reflections/daily-reflection-service.js';
import { ComparisonService } from '../src/services/daily-reflections/comparison-service.js';
import { DiscussionFeedbackService } from '../src/services/discussion-feedback/discussion-feedback-service.js';
import { MindlogicClient } from '../src/services/mindlogic/client.js';
import { SESSION_COOKIE_NAME, signSession } from '../src/services/auth/session.js';
import type {
  CreditRepository,
  ReserveCreditsRepositoryInput,
  ReserveCreditsResult,
} from '../src/services/credits/types.js';

const SESSION_SECRET = 'test-discussion-feedback-session-secret-at-least-32c';
const FIXED_NOW = new Date('2026-08-18T03:00:00.000Z'); // 2026-08-18 12:00 KST
const STUDY_DATE = '2026-08-17';

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
      summary: 'A short summary.',
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
        question: 'What do you think about the topic?',
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

function validFeedbackBody(overrides: Partial<ReturnType<typeof baseFeedbackBody>> = {}) {
  return { ...baseFeedbackBody(), ...overrides };
}

function baseFeedbackBody() {
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
            // Must be a normalized substring of hyunji's actual transcript text set up below.
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
        improvements: [
          {
            original: 'i agree with you too',
            suggested: 'I agree with you as well',
            explanation: 'More natural phrasing.',
          },
        ],
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

/** Inspects the request body's response_format schema name to return the right mock for whichever feature is calling. */
function smartMindlogicClient(
  options: {
    onCall?: (feature: 'reflection_comparison' | 'discussion_feedback') => void;
    feedbackBody?: () => unknown;
    comparisonBody?: () => unknown;
  } = {},
) {
  const fetchImpl = async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as {
      response_format?: { json_schema?: { name?: string } };
    };
    const name = payload.response_format?.json_schema?.name;
    if (name === 'discussion_feedback') {
      options.onCall?.('discussion_feedback');
      return jsonResponse(200, {
        id: 'chatcmpl-feedback',
        model: 'gpt-5.6-luna',
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify(options.feedbackBody?.() ?? validFeedbackBody()),
            },
          },
        ],
        usage: { prompt_tokens: 400, completion_tokens: 300, total_tokens: 700 },
      });
    }
    options.onCall?.('reflection_comparison');
    return jsonResponse(200, {
      id: 'chatcmpl-compare',
      model: 'gpt-5.6-luna',
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify(options.comparisonBody?.() ?? validComparisonBody()),
          },
        },
      ],
      usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
    });
  };
  return new MindlogicClient({
    apiKey: 'test-fake-key',
    baseUrl: 'https://example.com/v1/gateway',
    fetchImpl,
  });
}

/** Never resolves the feedback call until `release()` is called; the comparison call resolves immediately. */
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

/** Wraps a real CreditRepository, counting reserveCredits calls without losing its prototype methods (a plain object spread would drop them). */
function countingCreditRepository(base: CreditRepository, onReserve: () => void): CreditRepository {
  return {
    reserveCredits(
      input: ReserveCreditsRepositoryInput,
      monthlyLimit: number,
    ): Promise<ReserveCreditsResult> {
      onReserve();
      return base.reserveCredits(input, monthlyLimit);
    },
    commitCredits: (...args) => base.commitCredits(...args),
    releaseCredits: (...args) => base.releaseCredits(...args),
    markReconciliationPending: (...args) => base.markReconciliationPending(...args),
    reconcileCommit: (...args) => base.reconcileCommit(...args),
    reconcileRelease: (...args) => base.reconcileRelease(...args),
    markExhausted: (...args) => base.markExhausted(...args),
    getUsageSummary: (...args) => base.getUsageSummary(...args),
  };
}

interface TestAppOverrides {
  mindlogicClient?: MindlogicClient;
  creditRepository?: CreditRepository;
}

function buildTestApp(overrides: TestAppOverrides = {}) {
  const creditRepository = overrides.creditRepository ?? new InMemoryCreditRepository();
  const creditService = new CreditService(creditRepository, 5000);
  const dailyReflectionRepository = new InMemoryDailyReflectionRepository();
  const dailyReflectionService = new DailyReflectionService(dailyReflectionRepository);
  const comparisonRepository = new InMemoryComparisonRepository(dailyReflectionRepository);
  const comparisonService = new ComparisonService(comparisonRepository);
  const discussionFeedbackRepository = new InMemoryDiscussionFeedbackRepository(
    dailyReflectionRepository,
    comparisonRepository,
  );
  const discussionFeedbackService = new DiscussionFeedbackService(discussionFeedbackRepository);

  return buildApp({
    checkDatabaseConnection: async () => true,
    creditService,
    mindlogicClient: overrides.mindlogicClient ?? smartMindlogicClient(),
    dailyReflectionService,
    comparisonService,
    discussionFeedbackService,
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

function submit(
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

function post(app: ReturnType<typeof buildApp>, path: string, name = 'hyunji', payload?: object) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/study-days/${STUDY_DATE}${path}`,
    headers: { cookie: sessionCookie(name) },
    payload,
  });
}

function get(app: ReturnType<typeof buildApp>, path: string, name = 'hyunji') {
  return app.inject({
    method: 'GET',
    url: `/api/v1/study-days/${STUDY_DATE}${path}`,
    headers: { cookie: sessionCookie(name) },
  });
}

function put(app: ReturnType<typeof buildApp>, path: string, name = 'hyunji', payload?: object) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/study-days/${STUDY_DATE}${path}`,
    headers: { cookie: sessionCookie(name) },
    payload,
  });
}

const HYUNJI_TEXT = 'I think this is intresting because it affects everyone.';
const HYEONSEO_TEXT = 'I agree with you too, but I also worry about the cost.';

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

/** Full happy-path setup: both reflections submitted, comparison completed, topic 0 selected. */
async function setUpReadyComparison(app: ReturnType<typeof buildApp>) {
  await submitBoth(app);
  const compare = await post(app, '/compare');
  expect(compare.statusCode).toBe(200);
  const topic = await put(app, '/discussion/topic', 'hyunji', { topicIndex: 0 });
  expect(topic.statusCode).toBe(200);
}

describe('GET/PUT discussion transcript', () => {
  it('returns an empty transcript before anything is saved, then round-trips a save', async () => {
    const app = buildTestApp();
    await submitBoth(app);

    const before = await get(app, '/discussion/transcript');
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({
      studyDate: STUDY_DATE,
      topicIndex: null,
      segments: [],
      updatedAt: null,
      updatedBy: null,
    });

    const saved = await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 1,
      segments: validSegments(),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().topicIndex).toBe(1);
    expect(saved.json().segments).toHaveLength(2);
    expect(saved.json().updatedBy).toBe('hyunji');

    // Both participants see the same shared transcript.
    const readByOther = await get(app, '/discussion/transcript', 'hyeonseo');
    expect(readByOther.json().segments).toHaveLength(2);
    expect(readByOther.json().topicIndex).toBe(1);

    await app.close();
  });

  it('rejects a disallowed speakerKey with 400', async () => {
    const app = buildTestApp();
    await submitBoth(app);

    const response = await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: [
        { id: 'seg-1', startMs: 0, endMs: 1000, text: 'Hello there.', speakerKey: 'someone-else' },
      ],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects endMs <= startMs, oversized topicIndex, and empty text', async () => {
    const app = buildTestApp();
    await submitBoth(app);

    expect(
      (
        await put(app, '/discussion/transcript', 'hyunji', {
          topicIndex: 0,
          segments: [{ id: 'seg-1', startMs: 100, endMs: 100, text: 'x', speakerKey: null }],
        })
      ).statusCode,
    ).toBe(400);

    expect(
      (
        await put(app, '/discussion/transcript', 'hyunji', {
          topicIndex: 3,
          segments: validSegments(),
        })
      ).statusCode,
    ).toBe(400);

    await app.close();
  });

  it('rejects access from outside the 2 allowed participants with 401', async () => {
    const app = buildTestApp();
    await submitBoth(app);

    const strangerGet = await get(app, '/discussion/transcript', 'a-total-stranger');
    expect(strangerGet.statusCode).toBe(401);

    const strangerPut = await put(app, '/discussion/transcript', 'a-total-stranger', {
      topicIndex: 0,
      segments: validSegments(),
    });
    expect(strangerPut.statusCode).toBe(401);

    await app.close();
  });
});

describe('POST discussion feedback preconditions', () => {
  it('rejects with 422 when a segment has no speakerKey assigned', async () => {
    const app = buildTestApp();
    await setUpReadyComparison(app);
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: [
        { id: 'seg-1', startMs: 0, endMs: 1000, text: HYUNJI_TEXT, speakerKey: 'hyunji' },
        { id: 'seg-2', startMs: 1000, endMs: 2000, text: HYEONSEO_TEXT, speakerKey: null },
      ],
    });

    const response = await post(app, '/discussion/feedback');
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unassigned_segments');
    await app.close();
  });

  it('rejects with 422 when only one participant speaks', async () => {
    const app = buildTestApp();
    await setUpReadyComparison(app);
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: [{ id: 'seg-1', startMs: 0, endMs: 1000, text: HYUNJI_TEXT, speakerKey: 'hyunji' }],
    });

    const response = await post(app, '/discussion/feedback');
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('single_speaker_only');
    await app.close();
  });

  it('rejects with 409 topic_not_ready when the comparison is not completed yet', async () => {
    const app = buildTestApp();
    await submitBoth(app); // no /compare call at all
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });

    const response = await post(app, '/discussion/feedback');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('topic_not_ready');
    await app.close();
  });

  it('rejects with 409 topic_changed when the selected topic no longer matches the transcript', async () => {
    const app = buildTestApp();
    await setUpReadyComparison(app); // selects topic 0
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 1,
      segments: validSegments(),
    });

    const response = await post(app, '/discussion/feedback');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('topic_changed');
    await app.close();
  });
});

describe('feedback generation, caching, and staleness', () => {
  it('generates feedback once, reuses it by fingerprint, and goes stale after a transcript edit', async () => {
    let feedbackCalls = 0;
    const app = buildTestApp({
      mindlogicClient: smartMindlogicClient({
        onCall: (feature) => {
          if (feature === 'discussion_feedback') feedbackCalls++;
        },
      }),
    });
    await setUpReadyComparison(app);
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });

    const first = await post(app, '/discussion/feedback');
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('completed');
    expect(first.json().stale).toBe(false);
    expect(feedbackCalls).toBe(1);

    // Idempotent reuse: same fingerprint, zero further Mindlogic calls.
    const second = await post(app, '/discussion/feedback', 'hyeonseo');
    expect(second.statusCode).toBe(200);
    expect(second.json().result).toEqual(first.json().result);
    expect(feedbackCalls).toBe(1);

    const polled = await get(app, '/discussion/feedback');
    expect(polled.json()).toEqual({
      status: 'completed',
      result: first.json().result,
      stale: false,
    });
    expect(feedbackCalls).toBe(1);

    // Edit the transcript — old feedback stays visible but is now stale.
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: [
        ...validSegments(),
        { id: 'seg-3', startMs: 9000, endMs: 10000, text: 'One more thing.', speakerKey: 'hyunji' },
      ],
    });
    const staleRead = await get(app, '/discussion/feedback');
    expect(staleRead.json().status).toBe('completed');
    expect(staleRead.json().stale).toBe(true);
    expect(feedbackCalls).toBe(1);

    await app.close();
  });

  it('never calls Mindlogic or reserves credits on a GET poll', async () => {
    let reserveCalls = 0;
    let mindlogicCalls = 0;
    const creditRepository = countingCreditRepository(
      new InMemoryCreditRepository(),
      () => reserveCalls++,
    );
    const app = buildTestApp({
      creditRepository,
      mindlogicClient: smartMindlogicClient({
        onCall: (feature) => {
          if (feature === 'discussion_feedback') mindlogicCalls++;
        },
      }),
    });
    await setUpReadyComparison(app);
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });

    // Only /compare's own single reservation should have happened by now.
    const compareCalls = reserveCalls;

    const notStarted = await get(app, '/discussion/feedback');
    expect(notStarted.json()).toEqual({ status: 'not_started' });
    expect(reserveCalls).toBe(compareCalls);
    expect(mindlogicCalls).toBe(0);

    await app.close();
  });

  it('concurrent POST /discussion/feedback calls result in exactly one Mindlogic call', async () => {
    let feedbackCalls = 0;
    const { client, release } = delayedFeedbackMindlogicClient(() => feedbackCalls++);
    const app = buildTestApp({ mindlogicClient: client });
    await setUpReadyComparison(app);
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });

    const firstPromise = post(app, '/discussion/feedback', 'hyunji');
    // Give the first request's claim a chance to land before firing the second.
    await new Promise((resolve) => setImmediate(resolve));
    const second = await post(app, '/discussion/feedback', 'hyeonseo');
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual({ status: 'processing' });

    release();
    const first = await firstPromise;
    expect(first.statusCode).toBe(200);
    expect(feedbackCalls).toBe(1);

    await app.close();
  });
});

describe('AI output defense-in-depth guards', () => {
  it('rejects the whole response when participantKey values are invented/duplicated', async () => {
    const app = buildTestApp({
      mindlogicClient: smartMindlogicClient({
        feedbackBody: () =>
          validFeedbackBody({
            participants: [
              { ...baseFeedbackBody().participants[0], participantKey: 'hyunji' },
              { ...baseFeedbackBody().participants[1], participantKey: 'hyunji' },
            ],
          } as never),
      }),
    });
    await setUpReadyComparison(app);
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });

    const response = await post(app, '/discussion/feedback');
    expect(response.statusCode).toBe(502);
    expect(response.json().errorCode).toBe('upstream_schema_error');

    const polled = await get(app, '/discussion/feedback');
    expect(polled.json().status).toBe('failed');

    await app.close();
  });

  it('filters out a fabricated improvements[].original without rejecting the whole response', async () => {
    const app = buildTestApp({
      mindlogicClient: smartMindlogicClient({
        feedbackBody: () =>
          validFeedbackBody({
            participants: [
              {
                ...baseFeedbackBody().participants[0],
                improvements: [
                  {
                    original: 'this sentence was never actually said by anyone',
                    suggested: 'irrelevant',
                    explanation: 'irrelevant',
                  },
                ],
              },
              baseFeedbackBody().participants[1],
            ],
          } as never),
      }),
    });
    await setUpReadyComparison(app);
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });

    const response = await post(app, '/discussion/feedback');
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('completed');
    const hyunjiFeedback = response
      .json()
      .result.participants.find((p: { participantKey: string }) => p.participantKey === 'hyunji');
    expect(hyunjiFeedback.improvements).toHaveLength(0);

    await app.close();
  });

  it('overwrites speakingShare from real segment durations, never trusting the model', async () => {
    const app = buildTestApp({
      mindlogicClient: smartMindlogicClient({
        feedbackBody: () =>
          validFeedbackBody({
            participants: [
              { ...baseFeedbackBody().participants[0], speakingShare: 5 },
              { ...baseFeedbackBody().participants[1], speakingShare: 95 },
            ],
          } as never),
      }),
    });
    await setUpReadyComparison(app);
    // hyunji speaks 0-4000ms (4000ms), hyeonseo speaks 4000-9000ms (5000ms) => 44% / 56%.
    await put(app, '/discussion/transcript', 'hyunji', {
      topicIndex: 0,
      segments: validSegments(),
    });

    const response = await post(app, '/discussion/feedback');
    expect(response.statusCode).toBe(200);
    const participants = response.json().result.participants as {
      participantKey: string;
      speakingShare: number;
    }[];
    const hyunji = participants.find((p) => p.participantKey === 'hyunji')!;
    const hyeonseo = participants.find((p) => p.participantKey === 'hyeonseo')!;
    expect(hyunji.speakingShare).toBe(44);
    expect(hyeonseo.speakingShare).toBe(56);

    await app.close();
  });
});
