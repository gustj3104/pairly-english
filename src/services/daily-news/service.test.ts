import { describe, expect, it, vi } from 'vitest';
import { CreditService } from '../credits/credit-service.js';
import { InMemoryCreditRepository } from '../../../tests/helpers/in-memory-credit-repository.js';
import { MindlogicClient } from '../mindlogic/client.js';
import { DailyNewsService } from './service.js';
import type { DailyNewsRepository, DailyNewsToStore } from './repository.js';
import type { DailyNewsArticle } from './schema.js';

const words = [
  'advance',
  'climate',
  'energy',
  'research',
  'global',
  'project',
  'future',
  'benefit',
];

function cachedArticle(studyDate: string): DailyNewsArticle {
  return {
    id: 'cached-article-id',
    studyDate,
    title: 'Cached article',
    sourceName: 'Reuters',
    sourceUrl: 'https://www.reuters.com/world/story',
    publishedAt: '2026-08-17T10:00:00.000Z',
    generatedAt: '2026-08-17T10:05:00.000Z',
    summary: 'Summary',
    content: words.join(' '),
    vocabulary: words.map((word) => ({ word, definition: word, example: word })),
  };
}

/** Minimal fake — only what DailyNewsService actually calls. */
class FakeDailyNewsRepository implements DailyNewsRepository {
  constructor(private readonly existing: DailyNewsArticle | null) {}
  async find(): Promise<DailyNewsArticle | null> {
    return this.existing;
  }
  async getOrCreate(
    studyDate: string,
    create: () => Promise<DailyNewsToStore>,
  ): Promise<{ article: DailyNewsArticle; cached: boolean }> {
    const created = await create();
    return {
      article: {
        id: 'new-article-id',
        studyDate,
        ...created,
        generatedAt: created.generatedAt.toISOString(),
      },
      cached: false,
    };
  }
}

function mindlogicClientWithCallCounter(response: object) {
  const onCall = vi.fn();
  const client = new MindlogicClient({
    apiKey: 'fake',
    baseUrl: 'https://gateway.test',
    fetchImpl: async () => {
      onCall();
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, onCall };
}

describe('DailyNewsService.getOrGenerate — cache hit', () => {
  it('serves the cached article without calling the provider at all', async () => {
    const now = () => new Date('2026-08-18T03:00:00Z');
    const { client: mindlogicClient, onCall } = mindlogicClientWithCallCounter({});
    const repository = new FakeDailyNewsRepository(cachedArticle('2026-08-18'));
    const service = new DailyNewsService(
      repository,
      new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
    );

    const result = await service.getOrGenerate('2026-08-18', now);

    expect(result.cached).toBe(true);
    expect(result.article.id).toBe('cached-article-id');
    expect(onCall).not.toHaveBeenCalled();
  });
});

describe('DailyNewsService.getOrGenerate — cache miss', () => {
  it('calls the provider exactly once and stores the generated article', async () => {
    const now = () => new Date('2026-08-18T03:00:00Z');
    // 2026-08-18 is a Tuesday → required topic is 'Business & Economy'.
    const body = { ...cachedArticle('2026-08-18'), topic: 'Business & Economy' } as Record<
      string,
      unknown
    >;
    delete body.id;
    delete body.studyDate;
    delete body.generatedAt;
    const { client: mindlogicClient, onCall } = mindlogicClientWithCallCounter({
      id: 'x',
      model: 'sonar-pro',
      choices: [{ message: { role: 'assistant', content: JSON.stringify(body) } }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      search_results: [
        { title: 'Global energy research project shows advance', url: body.sourceUrl },
      ],
    });
    const repository = new FakeDailyNewsRepository(null);
    const service = new DailyNewsService(
      repository,
      new CreditService(new InMemoryCreditRepository(), 5000),
      mindlogicClient,
    );

    const result = await service.getOrGenerate('2026-08-18', now);

    expect(result.cached).toBe(false);
    expect(onCall).toHaveBeenCalledTimes(1);
  });
});
