import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleDailyNewsRepository } from '../../src/services/daily-news/repository.js';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './helpers/postgres-container.js';

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await startTestDatabase();
}, 180_000);
afterAll(async () => {
  if (testDb) await stopTestDatabase(testDb);
}, 60_000);

function article() {
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
  return {
    title: 'Science news',
    sourceName: 'Reuters',
    sourceUrl: 'https://www.reuters.com/world/story',
    publishedAt: '2026-08-17T10:00:00.000Z',
    generatedAt: new Date('2026-08-18T03:00:00Z'),
    summary: 'Summary',
    content: words.join(' '),
    vocabulary: words.map((word) => ({ word, definition: word, example: word })),
  };
}

describe('daily news PostgreSQL locking', () => {
  it('collapses 20 concurrent misses into one creation and one shared id', async () => {
    const repository = new DrizzleDailyNewsRepository(testDb.db);
    let calls = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        repository.getOrCreate('2026-08-18', async () => {
          calls++;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return article();
        }),
      ),
    );
    expect(calls).toBe(1);
    expect(new Set(results.map((result) => result.article.id)).size).toBe(1);
  });
  it('rolls back without leaving an incomplete row when creation fails', async () => {
    const repository = new DrizzleDailyNewsRepository(testDb.db);
    await expect(
      repository.getOrCreate('2026-08-19', async () => {
        throw new Error('provider failed');
      }),
    ).rejects.toThrow('provider failed');
    expect(await repository.find('2026-08-19')).toBeNull();
  });
});
