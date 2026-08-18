import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME, signSession } from '../src/services/auth/session.js';
import { fetchDictionaryEntry } from '../src/services/dictionary/provider.js';
import { DICTIONARY_SOURCE } from '../src/services/dictionary/types.js';
import type {
  DictionaryRepository,
  DictionaryTranslationRepository,
  SavedVocabularyRow,
} from '../src/services/dictionary/repository.js';
import type { DictionaryEntry } from '../src/services/dictionary/types.js';
import { DictionaryService } from '../src/services/dictionary/service.js';
import type { DictionaryTranslator } from '../src/services/dictionary/translation.js';

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
          {
            definition: 'To give public notice.',
            examples: ['They announce the result.'],
            translations: [
              { language: { code: 'ko', name: 'Korean' }, word: '  발표하다  ' },
              { language: { code: 'kor', name: 'Korean' }, word: '발표하다' },
              { language: { code: 'ja', name: 'Japanese' }, word: '発表する' },
              { language: { code: 'kor', name: 'Korean' }, word: '알리다' },
            ],
          },
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
      expect(String(input)).toBe(
        'https://freedictionaryapi.com/api/v1/entries/en/announce?translations=true',
      );
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
    expect(first.meanings[0]!.koreanTranslations).toEqual(['발표하다', '알리다']);
    expect(first.meanings[1]!.koreanTranslations).toEqual([]);
    // Pinned from the pre-translation implementation: translations must never change sense IDs.
    expect(first.meanings[0]!.senseId).toBe(
      '90361fd1260b0648b2d6c8c4f61057045722232420a9168aeb626c07fd715a83',
    );
    expect(first.expiresAt.getTime() - first.fetchedAt.getTime()).toBe(30 * 86400_000);
  });

  it('extracts ko and kor in order, normalizes/deduplicates, excludes other languages, and caps at five', async () => {
    const translations = [
      { language: { code: 'ko', name: 'Korean' }, word: '  하나  ' },
      { language: { code: 'kor', name: 'Korean' }, word: '하나' },
      { language: { code: 'fr', name: 'French' }, word: 'un' },
      ...['둘', '셋', '넷', '다섯', '여섯'].map((word) => ({
        language: { code: 'ko', name: 'Korean' },
        word,
      })),
    ];
    const body = providerBody({
      entries: [
        {
          partOfSpeech: 'noun',
          pronunciations: [],
          senses: [{ definition: 'A number.', examples: [], translations }],
        },
      ],
    });
    const result = await fetchDictionaryEntry('one', async () => jsonResponse(body));
    expect(result.meanings[0]!.koreanTranslations).toEqual(['하나', '둘', '셋', '넷', '다섯']);
  });

  it('accepts a sense with no translations as a successful empty array', async () => {
    const result = await fetchDictionaryEntry('announce', async () => jsonResponse(providerBody()));
    expect(result.meanings[1]!.koreanTranslations).toEqual([]);
  });

  it.each([
    { language: { code: 'korean', name: 'Korean' }, word: '뜻' },
    { language: { code: 'ko', name: 'Korean' }, word: '<b>뜻</b>' },
    { language: { code: 'ko', name: 'Korean' }, word: 'x'.repeat(121) },
  ])('rejects malformed translation data', async (translation) => {
    const body = providerBody({
      entries: [
        {
          partOfSpeech: 'noun',
          pronunciations: [],
          senses: [{ definition: 'Meaning.', translations: [translation] }],
        },
      ],
    });
    await expect(
      fetchDictionaryEntry('meaning', async () => jsonResponse(body)),
    ).rejects.toMatchObject({ code: 'DICTIONARY_INVALID_RESPONSE', statusCode: 502 });
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
  async findSaved(participantKey: string, normalizedWord: string) {
    return (
      this.saved.find(
        (row) =>
          row.item.participantKey === participantKey && row.item.normalizedWord === normalizedWord,
      ) ?? null
    );
  }
  async saveVocabulary(
    input: Parameters<DictionaryRepository['saveVocabulary']>[0],
  ): Promise<SavedVocabularyRow> {
    const existing = await this.findSaved(input.participantKey, input.normalizedWord);
    const row = {
      item: {
        id: existing?.item.id ?? '11111111-1111-1111-1111-111111111111',
        participantKey: input.participantKey,
        word: input.word,
        normalizedWord: input.normalizedWord,
        senseId: input.senseId,
        pronunciation: input.pronunciation ?? null,
        audioUrl: input.audioUrl ?? null,
        partOfSpeech: input.partOfSpeech,
        definition: input.definition,
        example: input.example ?? null,
        koreanTranslations: input.koreanTranslations ?? [],
        sourceUrl: input.sourceUrl,
        articleId: input.articleId ?? null,
        contextSentence: input.contextSentence ?? null,
        savedAt: input.savedAt,
      },
      articleTitle: null,
    } satisfies SavedVocabularyRow;
    this.saved = [row];
    return row;
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

describe('saved vocabulary Korean translation contract', () => {
  const dictionaryEntry = (): DictionaryEntry => ({
    query: 'announce',
    normalizedWord: 'announce',
    pronunciation: null,
    audioUrl: null,
    koreanTranslations: ['발표하다', '알리다'],
    meanings: [
      {
        senseId: 'a'.repeat(64),
        partOfSpeech: 'verb',
        definition: 'To give public notice.',
        example: null,
        koreanTranslations: ['발표하다'],
      },
      {
        senseId: 'b'.repeat(64),
        partOfSpeech: 'verb',
        definition: 'To make known.',
        example: null,
        koreanTranslations: ['알리다'],
      },
    ],
    sourceUrl: 'https://en.wiktionary.org/wiki/announce',
    fetchedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 30 * 86400_000),
    cacheSchemaVersion: 2,
  });

  it('snapshots canonical word-level translations independently of the selected sense', async () => {
    const repository = new MemoryRepository();
    repository.entry = dictionaryEntry();
    const service = new DictionaryService(repository, fetch, () => NOW);
    const first = await service.save('alice', 'announce', { senseId: 'a'.repeat(64) });
    expect(first.koreanTranslations).toEqual(['발표하다', '알리다']);
    const second = await service.save('alice', 'announce', { senseId: 'b'.repeat(64) });
    expect(second.koreanTranslations).toEqual(['발표하다', '알리다']);
    expect((await service.list('alice'))[0]!.koreanTranslations).toEqual(['발표하다', '알리다']);
  });

  it('rejects client-supplied Korean translations at the strict HTTP request schema', async () => {
    const repository = new MemoryRepository();
    repository.entry = dictionaryEntry();
    const app = buildApp({
      dictionaryService: new DictionaryService(repository),
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const token = signSession({ name: 'Alice' }, SECRET, 3600);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/vocabulary/announce',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { senseId: 'a'.repeat(64), koreanTranslations: ['조작'] },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.saved).toHaveLength(0);
    await app.close();
  });
});

function captureLogLines() {
  const stream = new PassThrough();
  const lines: Record<string, unknown>[] = [];
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) lines.push(JSON.parse(line));
    }
  });
  return { stream, lines };
}

describe('dictionary provider failure isolation (life-502 regression)', () => {
  it('maps every FreeDictionaryAPI failure code to one public DICTIONARY_PROVIDER_ERROR and logs only safe fields', async () => {
    const { stream, lines } = captureLogLines();
    const repo = new MemoryRepository();
    // Invalid JSON body -> DICTIONARY_INVALID_RESPONSE (502) inside fetchDictionaryEntry —
    // the exact internal code the production DB evidence for "life" narrows down to.
    const service = new DictionaryService(
      repo,
      async () => new Response('not json', { status: 200 }),
      () => NOW,
    );
    const app = buildApp({
      dictionaryService: service,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
      loggerStream: stream,
    });
    const token = signSession({ name: 'Alice' }, SECRET, 3600);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=life',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: { code: 'DICTIONARY_PROVIDER_ERROR' } });
    await app.close();

    const failureLog = lines.find((line) => line.failureStage === 'english_provider');
    expect(failureLog).toMatchObject({
      feature: 'dictionary_lookup',
      internalErrorCode: 'DICTIONARY_INVALID_RESPONSE',
      httpStatus: 502,
    });
    // No provider origin, no secrets, anywhere in what got logged.
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain('freedictionaryapi.com');
    expect(serialized).not.toContain('MINDLOGIC');
    expect(serialized).not.toContain('not json');
  });

  it('keeps WORD_NOT_FOUND as its own public code, not the provider-failure bucket', async () => {
    const repo = new MemoryRepository();
    const service = new DictionaryService(
      repo,
      async () => jsonResponse(providerBody({ entries: [] })),
      () => NOW,
    );
    const app = buildApp({
      dictionaryService: service,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const token = signSession({ name: 'Alice' }, SECRET, 3600);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=zzznotaword',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'WORD_NOT_FOUND' } });
    await app.close();
  });

  it('returns 200 with the English result and koreanTranslationStatus unavailable when translation storage fails after a successful English lookup', async () => {
    const repo = new MemoryRepository();
    const translationRepository: DictionaryTranslationRepository = {
      getOrCreateTranslation: async () => {
        throw new Error('translation storage failure');
      },
    };
    const service = new DictionaryService(
      repo,
      async () => jsonResponse(providerBody()),
      () => NOW,
      translationRepository,
      { translate: async () => ['발표하다'] } as unknown as DictionaryTranslator,
    );
    const app = buildApp({
      dictionaryService: service,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const token = signSession({ name: 'Alice' }, SECRET, 3600);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=announce',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      koreanTranslations: string[];
      koreanTranslationStatus: string;
      meanings: unknown[];
      pronunciation: string | null;
      source: unknown;
    };
    expect(body.koreanTranslations).toEqual([]);
    expect(body.koreanTranslationStatus).toBe('unavailable');
    expect(body.meanings.length).toBeGreaterThan(0);
    expect(body.pronunciation).toBeTruthy();
    expect(body.source).toMatchObject(DICTIONARY_SOURCE);
    await app.close();
  });

  it('never calls the provider or reserves credit on a cache hit', async () => {
    const repo = new MemoryRepository();
    repo.entry = {
      query: 'announce',
      normalizedWord: 'announce',
      pronunciation: null,
      audioUrl: null,
      koreanTranslations: ['발표하다'],
      meanings: [
        {
          senseId: 'a'.repeat(64),
          partOfSpeech: 'verb',
          definition: 'To give public notice.',
          example: null,
          koreanTranslations: [],
        },
      ],
      sourceUrl: 'https://en.wiktionary.org/wiki/announce',
      fetchedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * 86400_000),
      cacheSchemaVersion: 3,
    };
    const fetchSpy = vi.fn(async () => jsonResponse(providerBody()));
    // Mirrors DrizzleDictionaryRepository.getOrCreateTranslation's version-3 short-circuit:
    // returns the cached snapshot directly, never invoking the `create` callback it's given.
    const translate = vi.fn(async () => ['조작됨']);
    const getOrCreateTranslation = vi.fn(async () => repo.entry!.koreanTranslations);
    const service = new DictionaryService(repo, fetchSpy, () => NOW, { getOrCreateTranslation }, {
      translate,
    } as unknown as DictionaryTranslator);
    const app = buildApp({
      dictionaryService: service,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const token = signSession({ name: 'Alice' }, SECRET, 3600);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=announce',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ koreanTranslations: ['발표하다'] });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
    await app.close();
  });
});
