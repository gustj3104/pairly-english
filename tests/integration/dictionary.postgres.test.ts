import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DrizzleDictionaryRepository,
  AUTOMATIC_RETRY_COOLDOWN_MS,
} from '../../src/services/dictionary/repository.js';
import {
  AI_DICTIONARY_CACHE_SCHEMA_VERSION,
  DictionaryError,
} from '../../src/services/dictionary/types.js';
import type { DictionaryEntry } from '../../src/services/dictionary/types.js';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './helpers/postgres-container.js';

let testDb: TestDatabase;
let repository: DrizzleDictionaryRepository;

const now = new Date('2026-08-24T00:00:00.000Z');
const entry = (): DictionaryEntry => ({
  query: 'robot',
  normalizedWord: 'robot',
  pronunciation: '/ˈroʊbɑːt/',
  koreanTranslations: ['로봇', '자동 기계'],
  meanings: [
    {
      senseId: 'a'.repeat(64),
      partOfSpeech: 'noun',
      koreanTranslations: ['로봇', '자동 기계'],
      definition: 'A machine that can perform tasks automatically.',
      example: 'The robot cleaned the floor.',
    },
  ],
  fetchedAt: now,
  expiresAt: new Date(now.getTime() + 3650 * 86400_000),
  cacheSchemaVersion: AI_DICTIONARY_CACHE_SCHEMA_VERSION,
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
  it('performs exactly one AI call for 20 concurrent cache misses without deadlock', async () => {
    let calls = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        repository.getOrRefresh('robot', now, async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 15));
          return entry();
        }),
      ),
    );
    expect(calls).toBe(1);
    expect(results.every((result) => result.entry.normalizedWord === 'robot')).toBe(true);
    expect(new Set(results.map((result) => result.entry.meanings[0]!.senseId)).size).toBe(1);
    expect(results.filter((result) => !result.cached)).toHaveLength(1);
  }, 30_000);

  it('returns a fresh cache hit without invoking the callback', async () => {
    await repository.getOrRefresh('robot', now, async () => entry());
    let calls = 0;
    const result = await repository.getOrRefresh(
      'robot',
      new Date(now.getTime() + 1000),
      async () => {
        calls += 1;
        return entry();
      },
    );
    expect(calls).toBe(0);
    expect(result).toMatchObject({ cached: true, stale: false });
  });

  it('forces one regeneration for 20 concurrent reads of a legacy (pre-AI) cache row', async () => {
    await testDb.pool.query(
      `insert into dictionary_entries
        (query_word, normalized_word, meanings, source_url, cache_schema_version, fetched_at, expires_at, updated_at)
       values ('robot', 'robot', $1::jsonb, 'https://en.wiktionary.org/wiki/robot', 4, $2, $3, $2)`,
      [
        JSON.stringify([
          {
            senseId: 'a'.repeat(64),
            partOfSpeech: 'noun',
            definition: 'A serf under forced labor.',
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
        repository.getOrRefresh('robot', now, async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 15));
          return entry();
        }),
      ),
    );
    expect(calls).toBe(1);
    expect(results.every((result) => result.entry.koreanTranslations.length > 0)).toBe(true);
    expect((await repository.findEntry('robot'))?.cacheSchemaVersion).toBe(
      AI_DICTIONARY_CACHE_SCHEMA_VERSION,
    );
  }, 30_000);

  it('persists no successful-looking row for 20 concurrent cache misses when the AI call fails, and never calls it again within the cooldown', async () => {
    let calls = 0;
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        repository.getOrRefresh('life', now, async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 15));
          throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
        }),
      ),
    );
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(calls).toBe(1); // the 20 concurrent attempts collapse onto one AI call
    expect(await repository.findEntry('life')).toBeNull();

    // A later plain (non-forced) lookup within the cooldown must not spend another AI call.
    let secondCalls = 0;
    await expect(
      repository.getOrRefresh('life', new Date(now.getTime() + 1000), async () => {
        secondCalls += 1;
        return entry();
      }),
    ).rejects.toMatchObject({ code: 'DICTIONARY_AI_UNAVAILABLE' });
    expect(secondCalls).toBe(0);

    // An explicit user retry bypasses the cooldown.
    const retried = await repository.getOrRefresh(
      'life',
      new Date(now.getTime() + 1000),
      async () => ({ ...entry(), query: 'life', normalizedWord: 'life' }),
      { force: true },
    );
    expect(retried.cached).toBe(false);
  }, 30_000);

  it('allows a fresh AI call once the cooldown has elapsed', async () => {
    await expect(
      repository.getOrRefresh('life', now, async () => {
        throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
      }),
    ).rejects.toMatchObject({ code: 'DICTIONARY_AI_UNAVAILABLE' });
    const later = new Date(now.getTime() + AUTOMATIC_RETRY_COOLDOWN_MS + 1000);
    const result = await repository.getOrRefresh('life', later, async () => ({
      ...entry(),
      query: 'life',
      normalizedWord: 'life',
    }));
    expect(result.cached).toBe(false);
  });

  it('serves the last-known-good AI entry as stale when a rare post-expiry refresh fails', async () => {
    await repository.getOrRefresh('robot', now, async () => entry());
    const muchLater = new Date(now.getTime() + 3651 * 86400_000); // past the ~10-year TTL
    const result = await repository.getOrRefresh('robot', muchLater, async () => {
      throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
    });
    expect(result).toMatchObject({ cached: true, stale: true });
    expect(result.entry.koreanTranslations).toEqual(['로봇', '자동 기계']);
  });
});

describe('saved vocabulary PostgreSQL constraints', () => {
  it('upserts one row per participant and word while isolating participant lists', async () => {
    await repository.getOrRefresh('robot', now, async () => entry());
    const base = {
      word: 'robot',
      normalizedWord: 'robot',
      senseId: 'a'.repeat(64),
      pronunciation: null,
      partOfSpeech: 'noun',
      definition: 'A machine that can perform tasks automatically.',
      example: 'The robot cleaned the floor.',
      koreanTranslations: ['로봇'],
      articleId: null,
      contextSentence: null,
      savedAt: now,
    };
    const first = await repository.saveVocabulary({ ...base, participantKey: 'alice' });
    const again = await repository.saveVocabulary({ ...base, participantKey: 'alice' });
    await repository.saveVocabulary({ ...base, participantKey: 'bob' });
    expect(again.item.id).toBe(first.item.id);
    expect(again.item.koreanTranslations).toEqual(['로봇']);
    expect(await repository.listVocabulary('alice')).toHaveLength(1);
    expect(await repository.listVocabulary('bob')).toHaveLength(1);
    expect(await repository.deleteVocabulary('alice', 'robot')).toBe(true);
    expect(await repository.listVocabulary('bob')).toHaveLength(1);
  });

  it('stores different senses independently and rejects a duplicate sense row', async () => {
    await repository.getOrRefresh('robot', now, async () => entry());
    const base = {
      participantKey: 'alice',
      word: 'robot',
      normalizedWord: 'robot',
      pronunciation: null,
      partOfSpeech: 'noun',
      example: 'The robot moved.',
      articleId: null,
      contextSentence: null,
      savedAt: now,
    };
    await repository.saveVocabulary({
      ...base,
      senseId: 'a'.repeat(64),
      definition: 'An automatic machine.',
      koreanTranslations: ['로봇'],
    });
    await repository.saveVocabulary({
      ...base,
      senseId: 'b'.repeat(64),
      definition: 'A humanlike machine.',
      koreanTranslations: ['인간형 기계'],
    });
    await repository.saveVocabulary({
      ...base,
      senseId: 'a'.repeat(64),
      definition: 'An automatic machine.',
      koreanTranslations: ['로봇'],
    });
    expect(await repository.listVocabulary('alice')).toHaveLength(2);
    await repository.deleteVocabulary('alice', 'robot', 'a'.repeat(64));
    const remaining = await repository.listVocabulary('alice');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.item.senseId).toBe('b'.repeat(64));
  });

  it('enforces the dictionary foreign key and nonblank checks', async () => {
    await expect(
      testDb.pool.query(
        `insert into saved_vocabulary
        (participant_key, word, normalized_word, sense_id, part_of_speech, definition, source_url, saved_at)
        values ('alice', 'missing', 'missing', $1, 'noun', 'definition', 'internal:mindlogic-ai-generated', now())`,
        ['a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      testDb.pool.query(`insert into dictionary_entries
        (query_word, normalized_word, meanings, source_url, fetched_at, expires_at, updated_at)
        values (' ', ' ', '[]'::jsonb, 'internal:mindlogic-ai-generated', now(), now() + interval '30 days', now())`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a non-array saved Korean translation snapshot', async () => {
    await repository.getOrRefresh('robot', now, async () => entry());
    await expect(
      testDb.pool.query(
        `insert into saved_vocabulary
          (participant_key, word, normalized_word, sense_id, part_of_speech, definition,
           korean_translations, source_url, saved_at)
         values ('alice', 'robot', 'robot', $1, 'noun', 'definition',
           '{}'::jsonb, 'internal:mindlogic-ai-generated', now())`,
        ['a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
