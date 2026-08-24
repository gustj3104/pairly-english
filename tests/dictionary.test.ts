import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME, signSession } from '../src/services/auth/session.js';
import { getFeatureModelConfig } from '../src/services/mindlogic/feature-config.js';
import {
  AI_DICTIONARY_CACHE_SCHEMA_VERSION,
  DictionaryError,
  type DictionaryEntry,
} from '../src/services/dictionary/types.js';
import type {
  DictionaryRepository,
  CachedLookup,
  SavedVocabularyRow,
  SaveVocabularyInput,
} from '../src/services/dictionary/repository.js';
import { shouldSkipAutomaticRetry } from '../src/services/dictionary/repository.js';
import { DictionaryService } from '../src/services/dictionary/service.js';
import type { DictionaryAiLookup } from '../src/services/dictionary/ai-lookup.js';

const SECRET = 'dictionary-test-session-secret-at-least-32-chars';
const NOW = new Date('2026-08-24T00:00:00.000Z');

function sessionCookie(name: string) {
  const token = signSession({ name }, SECRET, 2592000);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function entry(overrides: Partial<DictionaryEntry> = {}): DictionaryEntry {
  return {
    query: 'robot',
    normalizedWord: 'robot',
    pronunciation: '/ˈroʊbɑːt/',
    koreanTranslations: ['로봇', '자동 기계'],
    meanings: [
      {
        senseId: 'a'.repeat(64),
        partOfSpeech: 'noun',
        definition: 'A machine that can perform tasks automatically.',
        example: 'The robot cleaned the floor.',
      },
    ],
    fetchedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 3650 * 86400_000),
    cacheSchemaVersion: AI_DICTIONARY_CACHE_SCHEMA_VERSION,
    ...overrides,
  };
}

/**
 * In-memory DictionaryRepository fake for HTTP/service-level tests. Mirrors
 * DrizzleDictionaryRepository's real contract (fresh-cache short-circuit, cooldown-gated
 * automatic retry, stale-on-failure fallback for an already-successful entry) closely enough to
 * exercise DictionaryService and the routes without a real Postgres advisory lock — true
 * concurrent-lock behavior is covered separately in tests/integration/dictionary.postgres.test.ts.
 * `inFlight` collapses concurrent getOrRefresh calls for the same word onto one `create()` call,
 * simulating the advisory lock's singleflight behavior.
 */
class MemoryDictionaryRepository implements DictionaryRepository {
  entries = new Map<string, DictionaryEntry>();
  attemptedAt = new Map<string, Date>();
  inFlight = new Map<string, Promise<CachedLookup>>();
  saved = new Map<string, SavedVocabularyRow>();
  articles = new Map<string, { id: string; title: string; content: string }>();

  async getOrRefresh(
    word: string,
    now: Date,
    create: () => Promise<DictionaryEntry>,
    options: { force?: boolean } = {},
  ): Promise<CachedLookup> {
    const existing = this.entries.get(word);
    if (existing && existing.expiresAt > now) {
      return { entry: existing, cached: true, stale: false };
    }
    const pending = this.inFlight.get(word);
    if (pending) return pending;
    if (shouldSkipAutomaticRetry(this.attemptedAt.get(word) ?? null, now, options.force)) {
      if (existing) return { entry: existing, cached: true, stale: true };
      throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
    }
    const attempt = (async (): Promise<CachedLookup> => {
      try {
        const fresh = await create();
        this.entries.set(word, fresh);
        this.attemptedAt.set(word, now);
        return { entry: fresh, cached: false, stale: false };
      } catch (error) {
        this.attemptedAt.set(word, now);
        if (error instanceof DictionaryError && existing) {
          return { entry: existing, cached: true, stale: true };
        }
        throw error;
      } finally {
        this.inFlight.delete(word);
      }
    })();
    this.inFlight.set(word, attempt);
    return attempt;
  }

  async findEntry(word: string): Promise<DictionaryEntry | null> {
    const found = this.entries.get(word);
    return found && found.cacheSchemaVersion >= AI_DICTIONARY_CACHE_SCHEMA_VERSION ? found : null;
  }

  async findArticle(id: string) {
    return this.articles.get(id) ?? null;
  }

  async findSaved(participantKey: string, normalizedWord: string) {
    return this.saved.get(`${participantKey}:${normalizedWord}`) ?? null;
  }

  async saveVocabulary(input: SaveVocabularyInput): Promise<SavedVocabularyRow> {
    const article = input.articleId ? (this.articles.get(input.articleId) ?? null) : null;
    const row: SavedVocabularyRow = {
      item: {
        id: `${input.participantKey}:${input.normalizedWord}`,
        word: input.word,
        normalizedWord: input.normalizedWord,
        senseId: input.senseId,
        pronunciation: input.pronunciation,
        partOfSpeech: input.partOfSpeech,
        definition: input.definition,
        example: input.example,
        koreanTranslations: input.koreanTranslations,
        articleId: input.articleId,
        contextSentence: input.contextSentence,
        savedAt: input.savedAt,
      },
      articleTitle: article?.title ?? null,
    };
    this.saved.set(`${input.participantKey}:${input.normalizedWord}`, row);
    return row;
  }

  async listVocabulary(participantKey: string) {
    return Array.from(this.saved.values()).filter((row) =>
      row.item.id.startsWith(`${participantKey}:`),
    );
  }

  async deleteVocabulary(participantKey: string, normalizedWord: string) {
    return this.saved.delete(`${participantKey}:${normalizedWord}`);
  }
}

function fakeAiLookup(impl: (word: string) => Promise<DictionaryEntry>) {
  const fetchEntry = vi.fn(impl);
  return { fetchEntry } as unknown as DictionaryAiLookup;
}

describe('Mindlogic model configuration', () => {
  it('pins the dictionary lookup feature to gpt-5.6-luna, not gpt-5.4-mini', () => {
    expect(getFeatureModelConfig('dictionary_translation').model).toBe('gpt-5.6-luna');
  });
});

describe('DictionaryService — single-call AI lookup', () => {
  it('looks up "robot" and returns Korean meaning, English definition, part of speech, and example all from one AI call', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async (word) => entry({ query: word, normalizedWord: word }));
    const service = new DictionaryService(repository, aiLookup, () => NOW);
    const result = await service.lookup('robot');
    expect(result.koreanTranslations).toEqual(['로봇', '자동 기계']);
    expect(result.meanings[0]).toMatchObject({
      partOfSpeech: 'noun',
      definition: 'A machine that can perform tasks automatically.',
      example: 'The robot cleaned the floor.',
    });
    expect(result.cached).toBe(false);
    expect(aiLookup.fetchEntry as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('"problem" resolves to a Korean meaning containing 문제', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async () =>
      entry({
        query: 'problem',
        normalizedWord: 'problem',
        koreanTranslations: ['문제'],
        meanings: [
          {
            senseId: 'b'.repeat(64),
            partOfSpeech: 'noun',
            definition: 'A matter that needs to be resolved.',
            example: 'We solved the problem.',
          },
        ],
      }),
    );
    const service = new DictionaryService(repository, aiLookup, () => NOW);
    const result = await service.lookup('problem');
    expect(result.koreanTranslations).toContain('문제');
  });

  it('"communication" resolves to a Korean meaning containing 의사소통', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async () =>
      entry({
        query: 'communication',
        normalizedWord: 'communication',
        koreanTranslations: ['의사소통'],
        meanings: [
          {
            senseId: 'c'.repeat(64),
            partOfSpeech: 'noun',
            definition: 'The exchange of information.',
            example: 'Good communication matters.',
          },
        ],
      }),
    );
    const service = new DictionaryService(repository, aiLookup, () => NOW);
    const result = await service.lookup('communication');
    expect(result.koreanTranslations).toContain('의사소통');
  });

  it('never touches global fetch — no FreeDictionaryAPI/Wiktionary HTTP call remains', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async (word) => entry({ query: word, normalizedWord: word }));
    const service = new DictionaryService(repository, aiLookup, () => NOW);
    await service.lookup('robot');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('makes exactly one AI call for a cache miss and zero calls on the next lookup of the same word (cache hit)', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async (word) => entry({ query: word, normalizedWord: word }));
    const service = new DictionaryService(repository, aiLookup, () => NOW);
    const first = await service.lookup('robot');
    const second = await service.lookup('robot');
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(aiLookup.fetchEntry as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('collapses 20 concurrent lookups of an uncached word into exactly one AI call', async () => {
    const repository = new MemoryDictionaryRepository();
    let calls = 0;
    const aiLookup = fakeAiLookup(async (word) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return entry({ query: word, normalizedWord: word });
    });
    const service = new DictionaryService(repository, aiLookup, () => NOW);
    const results = await Promise.all(Array.from({ length: 20 }, () => service.lookup('robot')));
    expect(calls).toBe(1);
    expect(results.every((result) => result.koreanTranslations.length > 0)).toBe(true);
  });

  it('rejects an AI response with an empty koreanTranslations array rather than a partial English-only success', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async () => {
      throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502);
    });
    const service = new DictionaryService(repository, aiLookup, () => NOW);
    await expect(service.lookup('robot')).rejects.toMatchObject({
      code: 'DICTIONARY_INVALID_RESPONSE',
    });
  });

  it('propagates an AI/upstream failure as an error — never a meaningless English-only success', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async () => {
      throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
    });
    const service = new DictionaryService(repository, aiLookup, () => NOW);
    await expect(service.lookup('robot')).rejects.toMatchObject({
      code: 'DICTIONARY_AI_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('does not persist a failed lookup as a normal cache entry, and does not auto-retry within the cooldown', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async () => {
      throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
    });
    const service = new DictionaryService(repository, aiLookup, () => NOW);
    await expect(service.lookup('robot')).rejects.toMatchObject({
      code: 'DICTIONARY_AI_UNAVAILABLE',
    });
    expect(await repository.findEntry('robot')).toBeNull();
    // A second plain (non-retry) lookup moments later must not spend another AI call.
    await expect(service.lookup('robot')).rejects.toMatchObject({
      code: 'DICTIONARY_AI_UNAVAILABLE',
    });
    expect(aiLookup.fetchEntry as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('an explicit user Retry bypasses the cooldown', async () => {
    const repository = new MemoryDictionaryRepository();
    let attempt = 0;
    const aiLookup = fakeAiLookup(async (word) => {
      attempt += 1;
      if (attempt === 1) throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
      return entry({ query: word, normalizedWord: word });
    });
    const service = new DictionaryService(repository, aiLookup, () => NOW);
    await expect(service.lookup('robot')).rejects.toMatchObject({
      code: 'DICTIONARY_AI_UNAVAILABLE',
    });
    const retried = await service.lookup('robot', { forceRetry: true });
    expect(retried.koreanTranslations.length).toBeGreaterThan(0);
    expect(aiLookup.fetchEntry as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
  });

  it('the public lookup response carries no Wiktionary/CC BY-SA source or attribution field', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async (word) => entry({ query: word, normalizedWord: word }));
    const service = new DictionaryService(repository, aiLookup, () => NOW);
    const result = await service.lookup('robot');
    expect(result).not.toHaveProperty('source');
    expect(result).not.toHaveProperty('audioUrl');
    expect(JSON.stringify(result)).not.toMatch(/wiktionary|CC BY-SA|freedictionaryapi/i);
  });
});

describe('dictionary HTTP authentication and validation', () => {
  it('requires a session and validates the word', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async (word) => entry({ query: word, normalizedWord: word }));
    const dictionaryService = new DictionaryService(repository, aiLookup, () => NOW);
    const app = buildApp({
      checkDatabaseConnection: async () => true,
      dictionaryService,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });

    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=robot',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const invalidWord = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=%3Cscript%3E',
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(invalidWord.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=robot',
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.koreanTranslations).toEqual(['로봇', '자동 기계']);
    expect(body).not.toHaveProperty('source');
  });

  it('maps an AI failure to the public DICTIONARY_PROVIDER_ERROR code without leaking internal detail', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async () => {
      throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
    });
    const dictionaryService = new DictionaryService(repository, aiLookup, () => NOW);
    const app = buildApp({
      checkDatabaseConnection: async () => true,
      dictionaryService,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=robot',
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('DICTIONARY_PROVIDER_ERROR');
  });

  it('only sends a retry when ?retry=true is set', async () => {
    const repository = new MemoryDictionaryRepository();
    let attempt = 0;
    const aiLookup = fakeAiLookup(async (word) => {
      attempt += 1;
      if (attempt === 1) throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
      return entry({ query: word, normalizedWord: word });
    });
    const dictionaryService = new DictionaryService(repository, aiLookup, () => NOW);
    const app = buildApp({
      checkDatabaseConnection: async () => true,
      dictionaryService,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=robot',
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(first.statusCode).toBe(503);
    const plain = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=robot',
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(plain.statusCode).toBe(503); // still cooling down, no retry flag
    const retried = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=robot&retry=true',
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(retried.statusCode).toBe(200);
  });
});

describe('saved vocabulary — word-level Korean translations', () => {
  it('snapshots the word-level koreanTranslations independently of the selected sense, and keeps them on later retrieval', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async (word) => entry({ query: word, normalizedWord: word }));
    const dictionaryService = new DictionaryService(repository, aiLookup, () => NOW);
    const app = buildApp({
      checkDatabaseConnection: async () => true,
      dictionaryService,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=robot',
      headers: { cookie: sessionCookie('hyunji') },
    });
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/v1/vocabulary/robot',
      headers: { cookie: sessionCookie('hyunji') },
      payload: { senseId: 'a'.repeat(64) },
    });
    expect(saveResponse.statusCode).toBe(200);
    const saved = saveResponse.json();
    expect(saved.koreanTranslations).toEqual(['로봇', '자동 기계']);
    expect(saved.example).toBe('The robot cleaned the floor.');
    expect(saved).not.toHaveProperty('source');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/vocabulary',
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(list.json()).toEqual([
      expect.objectContaining({ koreanTranslations: ['로봇', '자동 기계'] }),
    ]);
  });

  it('still serves a pre-AI-redesign saved row (null example, empty koreanTranslations) without breaking the whole list', async () => {
    // Deploy compatibility: a word saved under the old FreeDictionaryAPI-backed flow could have a
    // null example and an empty koreanTranslations array — the new backend must keep reading
    // these back rather than crashing GET /vocabulary for a user with pre-existing saved words.
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async (word) => entry({ query: word, normalizedWord: word }));
    const dictionaryService = new DictionaryService(repository, aiLookup, () => NOW);
    repository.saved.set('hyunji:legacyword', {
      item: {
        id: 'hyunji:legacyword',
        word: 'legacyword',
        normalizedWord: 'legacyword',
        senseId: 'b'.repeat(64),
        pronunciation: null,
        partOfSpeech: 'noun',
        definition: 'A word saved before the AI-only redesign.',
        example: null,
        koreanTranslations: [],
        articleId: null,
        contextSentence: null,
        savedAt: NOW,
      },
      articleTitle: null,
    });
    const app = buildApp({
      checkDatabaseConnection: async () => true,
      dictionaryService,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/vocabulary',
      headers: { cookie: sessionCookie('hyunji') },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([
      expect.objectContaining({ word: 'legacyword', example: null, koreanTranslations: [] }),
    ]);
  });

  it('rejects saving a word that was never looked up (no cached AI entry)', async () => {
    const repository = new MemoryDictionaryRepository();
    const aiLookup = fakeAiLookup(async (word) => entry({ query: word, normalizedWord: word }));
    const dictionaryService = new DictionaryService(repository, aiLookup, () => NOW);
    const app = buildApp({
      checkDatabaseConnection: async () => true,
      dictionaryService,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/vocabulary/robot',
      headers: { cookie: sessionCookie('hyunji') },
      payload: { senseId: 'a'.repeat(64) },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('DICTIONARY_ENTRY_NOT_CACHED');
  });
});
