import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleDictionaryRepository } from '../../src/services/dictionary/repository.js';
import type { DictionaryEntry } from '../../src/services/dictionary/types.js';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './helpers/postgres-container.js';

let testDb: TestDatabase;
let repository: DrizzleDictionaryRepository;

const now = new Date('2026-08-18T00:00:00.000Z');
const entry = (): DictionaryEntry => ({
  query: 'announce',
  normalizedWord: 'announce',
  pronunciation: '/əˈnaʊns/',
  audioUrl: null,
  koreanTranslations: [],
  meanings: [
    {
      senseId: 'a'.repeat(64),
      partOfSpeech: 'verb',
      definition: 'To give public notice.',
      example: 'They announce the result.',
      koreanTranslations: [],
    },
  ],
  sourceUrl: 'https://en.wiktionary.org/wiki/announce',
  fetchedAt: now,
  expiresAt: new Date(now.getTime() + 30 * 86400_000),
  cacheSchemaVersion: 2,
});

beforeAll(async () => {
  testDb = await startTestDatabase();
  repository = new DrizzleDictionaryRepository(testDb.db);
}, 180_000);

afterAll(async () => {
  if (testDb) await stopTestDatabase(testDb);
}, 60_000);

beforeEach(async () => {
  await testDb.pool.query(
    'TRUNCATE TABLE saved_vocabulary, dictionary_entries, daily_news_articles RESTART IDENTITY CASCADE',
  );
});

describe('dictionary PostgreSQL cache', () => {
  it('performs exactly one callback for 20 concurrent cache misses without deadlock', async () => {
    let calls = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        repository.getOrRefresh('announce', now, async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 15));
          return entry();
        }),
      ),
    );
    expect(calls).toBe(1);
    expect(results.every((result) => result.entry.normalizedWord === 'announce')).toBe(true);
    expect(new Set(results.map((result) => result.entry.meanings[0]!.senseId)).size).toBe(1);
    expect(results.filter((result) => !result.cached)).toHaveLength(1);
  }, 30_000);

  it('returns a fresh cache hit without invoking the callback', async () => {
    await repository.getOrRefresh('announce', now, async () => entry());
    let calls = 0;
    const result = await repository.getOrRefresh(
      'announce',
      new Date(now.getTime() + 1000),
      async () => {
        calls += 1;
        return entry();
      },
    );
    expect(calls).toBe(0);
    expect(result).toMatchObject({ cached: true, stale: false });
  });

  it('forces one refresh for 20 concurrent legacy-cache reads', async () => {
    await testDb.pool.query(
      `insert into dictionary_entries
        (query_word, normalized_word, meanings, source_url, fetched_at, expires_at, updated_at)
       values ('announce', 'announce', $1::jsonb, 'https://en.wiktionary.org/wiki/announce', $2, $3, $2)`,
      [
        JSON.stringify([
          {
            senseId: 'a'.repeat(64),
            partOfSpeech: 'verb',
            definition: 'To give public notice.',
            example: null,
          },
        ]),
        now,
        new Date(now.getTime() + 30 * 86400_000),
      ],
    );
    let calls = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        repository.getOrRefresh('announce', now, async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 15));
          return entry();
        }),
      ),
    );
    expect(calls).toBe(1);
    expect(
      results.every((result) => result.entry.meanings[0]!.koreanTranslations.length === 0),
    ).toBe(true);
  }, 30_000);

  it('treats a current-version empty translation array as a valid cache hit', async () => {
    await repository.getOrRefresh('announce', now, async () => entry());
    let calls = 0;
    const result = await repository.getOrRefresh('announce', now, async () => {
      calls += 1;
      return entry();
    });
    expect(calls).toBe(0);
    expect(result.entry.meanings[0]!.koreanTranslations).toEqual([]);
  });

  it('collapses 20 concurrent translation misses and permanently caches version 3', async () => {
    await repository.getOrRefresh('announce', now, async () => entry());
    let calls = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        repository.getOrCreateTranslation('announce', async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 15));
          return ['발표하다', '알리다'];
        }),
      ),
    );
    expect(calls).toBe(1);
    expect(results.every((value) => value.join(',') === '발표하다,알리다')).toBe(true);
    expect(await repository.getOrCreateTranslation('announce', async () => ['호출 금지'])).toEqual([
      '발표하다',
      '알리다',
    ]);
    const cached = await repository.findEntry('announce');
    expect(cached).toMatchObject({ cacheSchemaVersion: 3 });
  }, 30_000);

  it('does not promote a failed or empty translation to version 3', async () => {
    await repository.getOrRefresh('announce', now, async () => entry());
    expect(await repository.getOrCreateTranslation('announce', async () => [])).toEqual([]);
    expect((await repository.findEntry('announce'))?.cacheSchemaVersion).toBe(2);
    await expect(
      repository.getOrCreateTranslation('announce', async () => {
        throw new Error('mock failure');
      }),
    ).rejects.toThrow('mock failure');
    expect((await repository.findEntry('announce'))?.cacheSchemaVersion).toBe(2);
  });

  it('preserves a version 3 translation across an expired English refresh', async () => {
    await repository.getOrRefresh('announce', now, async () => entry());
    await repository.getOrCreateTranslation('announce', async () => ['발표하다']);
    const later = new Date(now.getTime() + 31 * 86400_000);
    const refreshed = entry();
    refreshed.fetchedAt = later;
    refreshed.expiresAt = new Date(later.getTime() + 30 * 86400_000);
    const result = await repository.getOrRefresh('announce', later, async () => refreshed);
    expect(result.entry.koreanTranslations).toEqual(['발표하다']);
    expect(result.entry.cacheSchemaVersion).toBe(3);
  });
});

describe('saved vocabulary PostgreSQL constraints', () => {
  it('upserts one row per participant and word while isolating participant lists', async () => {
    await repository.getOrRefresh('announce', now, async () => entry());
    const base = {
      word: 'announce',
      normalizedWord: 'announce',
      senseId: 'a'.repeat(64),
      pronunciation: null,
      audioUrl: null,
      partOfSpeech: 'verb',
      definition: 'To give public notice.',
      example: null,
      koreanTranslations: ['발표하다'],
      sourceUrl: 'https://en.wiktionary.org/wiki/announce',
      articleId: null,
      contextSentence: null,
      savedAt: now,
    };
    const first = await repository.saveVocabulary({ ...base, participantKey: 'alice' });
    const again = await repository.saveVocabulary({ ...base, participantKey: 'alice' });
    await repository.saveVocabulary({ ...base, participantKey: 'bob' });
    expect(again.item.id).toBe(first.item.id);
    expect(again.item.koreanTranslations).toEqual(['발표하다']);
    expect(await repository.listVocabulary('alice')).toHaveLength(1);
    expect(await repository.listVocabulary('bob')).toHaveLength(1);
    expect(await repository.deleteVocabulary('alice', 'announce')).toBe(true);
    expect(await repository.listVocabulary('bob')).toHaveLength(1);
  });

  it('enforces dictionary and article foreign keys and nonblank checks', async () => {
    await expect(
      testDb.pool.query(
        `insert into saved_vocabulary
        (participant_key, word, normalized_word, sense_id, part_of_speech, definition, source_url, saved_at)
        values ('alice', 'missing', 'missing', $1, 'verb', 'definition', 'https://en.wiktionary.org/wiki/missing', now())`,
        ['a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      testDb.pool.query(`insert into dictionary_entries
        (query_word, normalized_word, meanings, source_url, fetched_at, expires_at, updated_at)
        values (' ', ' ', '[]'::jsonb, 'https://en.wiktionary.org/wiki/x', now(), now() + interval '30 days', now())`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a non-array saved Korean translation snapshot', async () => {
    await repository.getOrRefresh('announce', now, async () => entry());
    await expect(
      testDb.pool.query(
        `insert into saved_vocabulary
          (participant_key, word, normalized_word, sense_id, part_of_speech, definition,
           korean_translations, source_url, saved_at)
         values ('alice', 'announce', 'announce', $1, 'verb', 'definition',
           '{}'::jsonb, 'https://en.wiktionary.org/wiki/announce', now())`,
        ['a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
