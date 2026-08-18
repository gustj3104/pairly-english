import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME, signSession } from '../src/services/auth/session.js';
import { fetchDictionaryEntry } from '../src/services/dictionary/provider.js';
import { DICTIONARY_SOURCE } from '../src/services/dictionary/types.js';
import type {
  DictionaryRepository,
  SavedVocabularyRow,
} from '../src/services/dictionary/repository.js';
import type { DictionaryEntry } from '../src/services/dictionary/types.js';
import { DictionaryService } from '../src/services/dictionary/service.js';

const SECRET = 'dictionary-test-session-secret-at-least-32-chars';
const NOW = new Date('2026-08-18T00:00:00.000Z');

function providerBody(overrides: Record<string, unknown> = {}) {
  return {
    word: 'announce',
    entries: [
      {
        language: { code: 'en', name: 'English' },
        partOfSpeech: 'verb',
        pronunciations: [{ type: 'phonemic', text: '/əˈnaʊns/', tags: [] }],
        senses: [
          { definition: 'To give public notice.', examples: ['They announce the result.'] },
          { definition: 'To give public notice.', examples: ['duplicate'] },
          { definition: 'To make known.', examples: [] },
          { definition: 'To proclaim.', examples: [] },
          { definition: 'A fourth unique definition.', examples: [] },
        ],
      },
    ],
    source: {
      url: 'https://en.wiktionary.org/wiki/announce',
      license: {
        name: 'CC BY-SA 4.0',
        url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      },
    },
    ...overrides,
  };
}

const jsonResponse = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('FreeDictionaryAPI provider mapping', () => {
  it('uses the fixed HTTPS endpoint, normalizes at most three unique meanings and stable sense IDs', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://freedictionaryapi.com/api/v1/entries/en/announce');
      expect(init?.redirect).toBe('manual');
      return jsonResponse(providerBody());
    });
    const first = await fetchDictionaryEntry('announce', fetchMock, () => NOW);
    const second = await fetchDictionaryEntry('announce', fetchMock, () => NOW);
    expect(first.meanings).toHaveLength(3);
    expect(new Set(first.meanings.map((meaning) => meaning.definition)).size).toBe(3);
    expect(first.meanings.map((meaning) => meaning.senseId)).toEqual(
      second.meanings.map((meaning) => meaning.senseId),
    );
    expect(first.pronunciation).toBe('/əˈnaʊns/');
    expect(first.audioUrl).toBeNull();
    expect(first.expiresAt.getTime() - first.fetchedAt.getTime()).toBe(30 * 86400_000);
  });

  it.each([
    ['empty entries', providerBody({ entries: [] }), 'WORD_NOT_FOUND', 404],
    ['invalid JSON', '{', 'DICTIONARY_INVALID_RESPONSE', 502],
    [
      'HTML in definition',
      providerBody({
        entries: [
          { partOfSpeech: 'verb', pronunciations: [], senses: [{ definition: '<b>bad</b>' }] },
        ],
      }),
      'DICTIONARY_INVALID_RESPONSE',
      502,
    ],
    [
      'wrong source host',
      providerBody({
        source: {
          url: 'https://evil.example/announce',
          license: {
            name: 'CC BY-SA 4.0',
            url: 'https://creativecommons.org/licenses/by-sa/4.0/',
          },
        },
      }),
      'DICTIONARY_INVALID_RESPONSE',
      502,
    ],
  ])('rejects %s', async (_label, body, code, status) => {
    const response = typeof body === 'string' ? new Response(body) : jsonResponse(body);
    await expect(fetchDictionaryEntry('announce', async () => response)).rejects.toMatchObject({
      code,
      statusCode: status,
    });
  });

  it('maps 429 with retry-after and 5xx without exposing bodies', async () => {
    await expect(
      fetchDictionaryEntry(
        'announce',
        async () => new Response('secret', { status: 429, headers: { 'retry-after': '10' } }),
      ),
    ).rejects.toMatchObject({ code: 'DICTIONARY_RATE_LIMITED', statusCode: 503, retryAfter: '10' });
    await expect(
      fetchDictionaryEntry('announce', async () => new Response('secret', { status: 500 })),
    ).rejects.toMatchObject({ code: 'DICTIONARY_UPSTREAM_ERROR', statusCode: 503 });
  });
});

class MemoryRepository implements DictionaryRepository {
  entry: DictionaryEntry | null = null;
  saved: SavedVocabularyRow[] = [];
  async getOrRefresh(word: string, _now: Date, create: () => Promise<DictionaryEntry>) {
    if (this.entry) return { entry: this.entry, cached: true, stale: false };
    this.entry = await create();
    return { entry: this.entry, cached: false, stale: false };
  }
  async findEntry() {
    return this.entry;
  }
  async findArticle() {
    return null;
  }
  async findSaved() {
    return null;
  }
  async saveVocabulary(): Promise<SavedVocabularyRow> {
    throw new Error('unused');
  }
  async listVocabulary() {
    return this.saved;
  }
  async deleteVocabulary() {
    return false;
  }
}

describe('dictionary HTTP authentication and validation', () => {
  it('requires a session and returns normalized attribution without leaking provider fields', async () => {
    const repo = new MemoryRepository();
    const service = new DictionaryService(
      repo,
      async () => jsonResponse(providerBody()),
      () => NOW,
    );
    const app = buildApp({
      dictionaryService: service,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
      checkDatabaseConnection: async () => true,
    });
    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=announce',
    });
    expect(unauthorized.statusCode).toBe(401);
    const token = signSession({ name: ' Alice ' }, SECRET, 3600);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=%EF%BC%A1nnounce',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      normalizedWord: 'announce',
      source: DICTIONARY_SOURCE,
      cached: false,
      stale: false,
    });
    expect(JSON.stringify(response.json())).not.toContain('entries');
    await app.close();
  });

  it.each(['', '123', 'https://evil.test', '<b>word</b>', 'two words', 'a--b'])(
    'rejects invalid word %s',
    async (word) => {
      const app = buildApp({
        dictionaryService: new DictionaryService(new MemoryRepository()),
        studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
      });
      const token = signSession({ name: 'Alice' }, SECRET, 3600);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/dictionary/lookup?word=${encodeURIComponent(word)}`,
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
      expect(response.statusCode).toBe(400);
      await app.close();
    },
  );
});
