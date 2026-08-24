import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CreditService } from '../src/services/credits/credit-service.js';
import { InMemoryCreditRepository } from './helpers/in-memory-credit-repository.js';
import { InMemoryDailyNewsRepository } from './helpers/in-memory-daily-news-repository.js';
import { DailyNewsService } from '../src/services/daily-news/service.js';
import { MindlogicClient } from '../src/services/mindlogic/client.js';
import { SESSION_COOKIE_NAME, signSession } from '../src/services/auth/session.js';

const SESSION_SECRET = 'test-daily-news-article-session-secret-at-least-32-chars';
// 2026-08-18T03:00:00Z is 2026-08-18 12:00 in Asia/Seoul (UTC+9).
const FIXED_NOW = new Date('2026-08-18T03:00:00.000Z');
// Monday in Asia/Seoul -> fixed weekday topic is 'Technology' (weekday-topics.ts).
const STUDY_DATE = '2026-08-17';

const VOCAB_WORDS = [
  'advance',
  'climate',
  'energy',
  'research',
  'global',
  'project',
  'future',
  'benefit',
];

function articleBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'A useful technology story',
    sourceName: 'Reuters',
    sourceUrl: 'https://www.reuters.com/technology/story',
    publishedAt: '2026-08-17T10:00:00Z',
    summary: 'Summary',
    content: VOCAB_WORDS.join(' '),
    vocabulary: VOCAB_WORDS.map((word) => ({ word, definition: word, example: word })),
    topic: 'Technology',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Sentinel default for mindlogicClientFor's `searchResults` param — `undefined` itself is a valid, meaningful value (a completion with no `search_results` field at all), so it can't double as "use the default". */
const SEARCH_RESULTS_MATCHING_SOURCE = Symbol('search-results-matching-source-url');

// Word-overlaps with articleBody()'s default content ("advance climate energy research global
// project future benefit"), so it satisfies the generator's title-correlation check.
const MATCHING_SEARCH_RESULT_TITLE = 'Global research project drives advance in energy';

/** Completion envelope: article body plus top-level `search_results` the daily-news generator
 * checks separately — provider-supplied {title, url} pairs, not the model's own free text. */
function completion(body: Record<string, unknown>, searchResults: unknown) {
  return {
    id: 'chatcmpl-1',
    model: 'sonar-pro',
    choices: [{ message: { role: 'assistant', content: JSON.stringify(body) } }],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    search_results: searchResults,
  };
}

function mindlogicClientFor(
  body: Record<string, unknown>,
  searchResults: unknown = SEARCH_RESULTS_MATCHING_SOURCE,
) {
  const resolvedSearchResults =
    searchResults === SEARCH_RESULTS_MATCHING_SOURCE
      ? [{ title: MATCHING_SEARCH_RESULT_TITLE, url: body.sourceUrl }]
      : searchResults;
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return jsonResponse(200, completion(body, resolvedSearchResults));
  };
  const client = new MindlogicClient({
    apiKey: 'test-fake-mindlogic-key',
    baseUrl: 'https://example.com/v1/gateway',
    fetchImpl,
  });
  return { client, callCount: () => calls };
}

function sessionCookie(name: string) {
  const token = signSession({ name }, SESSION_SECRET, 2592000);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function buildTestApp(
  mindlogicClient: MindlogicClient,
  extra: {
    loggerStream?: NodeJS.WritableStream;
    dailyNewsRepository?: InMemoryDailyNewsRepository;
  } = {},
) {
  const creditService = new CreditService(new InMemoryCreditRepository(), 5000);
  const dailyNewsRepository = extra.dailyNewsRepository ?? new InMemoryDailyNewsRepository();
  const dailyNewsService = new DailyNewsService(
    dailyNewsRepository,
    creditService,
    mindlogicClient,
  );
  return buildApp({
    checkDatabaseConnection: async () => true,
    studyDaysRoutesOptions: {
      sessionSecret: SESSION_SECRET,
      maxFutureDays: 1,
      now: () => FIXED_NOW,
    },
    creditService,
    mindlogicClient,
    dailyNewsService,
    loggerStream: extra.loggerStream,
  });
}

async function getArticle(app: ReturnType<typeof buildApp>) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/study-days/${STUDY_DATE}/article`,
    headers: { cookie: sessionCookie('hyunji') },
  });
}

describe('GET /api/v1/study-days/:date/article — success and caching', () => {
  it('generates and returns a fresh article matching the spec-compliant sonar-pro response', async () => {
    const { client } = mindlogicClientFor(articleBody());
    const app = buildTestApp(client);

    const response = await getArticle(app);
    await app.close();

    expect(response.statusCode).toBe(200);
    const parsed = response.json();
    expect(parsed).toMatchObject({
      title: 'A useful technology story',
      sourceName: 'Reuters',
      sourceUrl: 'https://www.reuters.com/technology/story',
      summary: 'Summary',
      cached: false,
    });
    expect(parsed.vocabulary).toHaveLength(8);
    // The model-response-only `topic` field must never reach the client.
    expect(parsed).not.toHaveProperty('topic');
  });

  it('serves the cached article on a second request with zero additional provider calls', async () => {
    const { client, callCount } = mindlogicClientFor(articleBody());
    const dailyNewsRepository = new InMemoryDailyNewsRepository();
    const app = buildTestApp(client, { dailyNewsRepository });

    const first = await getArticle(app);
    const second = await getArticle(app);
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(first.json().cached).toBe(false);
    expect(second.statusCode).toBe(200);
    expect(second.json().cached).toBe(true);
    expect(second.json().id).toBe(first.json().id);
    expect(callCount()).toBe(1);
  });

  it('collapses concurrent requests for the same date into a single provider call', async () => {
    const { client, callCount } = mindlogicClientFor(articleBody());
    const app = buildTestApp(client);

    const [a, b] = await Promise.all([getArticle(app), getArticle(app)]);
    await app.close();

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().id).toBe(b.json().id);
    expect(callCount()).toBe(1);
  });
});

describe('GET /api/v1/study-days/:date/article — source allowlist failures fail closed', () => {
  it('rejects with source_not_allowlisted when the model cites an off-allowlist host', async () => {
    const body = articleBody({ sourceUrl: 'https://www.cnn.com/technology/story' });
    const { client } = mindlogicClientFor(body);
    const logStream = new PassThrough();
    let logOutput = '';
    logStream.on('data', (chunk: Buffer) => (logOutput += chunk.toString('utf8')));

    const app = buildTestApp(client, { loggerStream: logStream });
    const response = await getArticle(app);
    await app.close();
    await new Promise((resolve) => setImmediate(resolve));

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('UPSTREAM_NEWS_FAILED');
    expect(logOutput).toContain('"reason":"source_not_allowlisted"');
    expect(logOutput).toContain('"sourceAllowlisted":false');
    expect(logOutput).toContain('"sourceHostname":"www.cnn.com"');
  });

  it('rejects with source_results_missing when the completion carries no search_results array', async () => {
    const body = articleBody();
    // `null`, not `undefined` — a bare `undefined` argument would fall through to
    // mindlogicClientFor's own default (SEARCH_RESULTS_MATCHING_SOURCE), since JS substitutes a
    // parameter default for an explicit `undefined` argument too. `null` survives as the real
    // search_results value, round-trips through JSON unchanged, and — like a genuinely absent
    // field — fails `Array.isArray`, exercising the same source_results_missing branch.
    const { client } = mindlogicClientFor(body, null);
    const logStream = new PassThrough();
    let logOutput = '';
    logStream.on('data', (chunk: Buffer) => (logOutput += chunk.toString('utf8')));

    const app = buildTestApp(client, { loggerStream: logStream });
    const response = await getArticle(app);
    await app.close();
    await new Promise((resolve) => setImmediate(resolve));

    expect(response.statusCode).toBe(502);
    expect(logOutput).toContain('"reason":"source_results_missing"');
    expect(logOutput).toContain('"searchResultsPresent":false');
  });

  it('rejects with source_results_mismatch when search_results are present but none match sourceUrl', async () => {
    const body = articleBody();
    const { client } = mindlogicClientFor(body, [
      { title: 'Unrelated story', url: 'https://www.bbc.com/news/other' },
    ]);
    const logStream = new PassThrough();
    let logOutput = '';
    logStream.on('data', (chunk: Buffer) => (logOutput += chunk.toString('utf8')));

    const app = buildTestApp(client, { loggerStream: logStream });
    const response = await getArticle(app);
    await app.close();
    await new Promise((resolve) => setImmediate(resolve));

    expect(response.statusCode).toBe(502);
    expect(logOutput).toContain('"reason":"source_results_mismatch"');
    expect(logOutput).toContain('"searchResultHostnames":["www.bbc.com"]');
  });

  it('rejects with source_title_uncorrelated when sourceUrl matches a real, allowlisted search_results entry about a different story (same domain is not enough)', async () => {
    const body = articleBody();
    const { client } = mindlogicClientFor(body, [
      // A real, allowlisted, same-domain result — its url matches sourceUrl exactly — but its
      // title has no correlation with the generated article's own content.
      { title: 'Pony.ai and Uber deploy robotaxis in Europe', url: body.sourceUrl },
    ]);
    const logStream = new PassThrough();
    let logOutput = '';
    logStream.on('data', (chunk: Buffer) => (logOutput += chunk.toString('utf8')));

    const app = buildTestApp(client, { loggerStream: logStream });
    const response = await getArticle(app);
    await app.close();
    await new Promise((resolve) => setImmediate(resolve));

    expect(response.statusCode).toBe(502);
    expect(logOutput).toContain('"reason":"source_title_uncorrelated"');
  });

  it('never logs the Mindlogic API key, an Authorization header, or the full article content', async () => {
    const body = articleBody({ sourceUrl: 'https://www.cnn.com/technology/story' });
    const { client } = mindlogicClientFor(body);
    const logStream = new PassThrough();
    let logOutput = '';
    logStream.on('data', (chunk: Buffer) => (logOutput += chunk.toString('utf8')));

    const app = buildTestApp(client, { loggerStream: logStream });
    const response = await getArticle(app);
    await app.close();
    await new Promise((resolve) => setImmediate(resolve));

    expect(response.statusCode).toBe(502);
    expect(logOutput).not.toContain('test-fake-mindlogic-key');
    expect(logOutput).not.toContain('Bearer');
    expect(logOutput).not.toContain(body.content as string);
    expect(logOutput).not.toContain('A useful technology story');
  });
});

describe('GET /api/v1/study-days/:date/article — auth', () => {
  it('returns 401 without a session cookie', async () => {
    const { client } = mindlogicClientFor(articleBody());
    const app = buildTestApp(client);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/study-days/${STUDY_DATE}/article`,
    });
    await app.close();
    expect(response.statusCode).toBe(401);
  });
});
