import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME, signSession } from '../src/services/auth/session.js';
import { createSenseId, fetchDictionaryEntry } from '../src/services/dictionary/provider.js';
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
  it('requests the fixed HTTPS endpoint with no translations query param, normalizes at most three unique meanings and stable sense IDs', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const requested = new URL(String(input));
      expect(requested.origin + requested.pathname).toBe(
        'https://freedictionaryapi.com/api/v1/entries/en/announce',
      );
      expect(requested.searchParams.has('translations')).toBe(false);
      expect(Array.from(requested.searchParams.keys())).toHaveLength(0);
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
    // Never requested from FreeDictionaryAPI; word-level Korean meanings come from Mindlogic
    // (DictionaryService.lookup), so every meaning-level array is empty for API compatibility.
    expect(first.meanings.every((meaning) => meaning.koreanTranslations.length === 0)).toBe(true);
    // Pinned across the translations-removal change: senseId was already independent of
    // translations before this fix and must remain so.
    expect(first.meanings[0]!.senseId).toBe(
      '90361fd1260b0648b2d6c8c4f61057045722232420a9168aeb626c07fd715a83',
    );
    expect(first.expiresAt.getTime() - first.fetchedAt.getTime()).toBe(30 * 86400_000);
  });

  it('ignores a translations field on the raw response, however shaped, without failing or affecting koreanTranslations or senseId', async () => {
    const wellFormed = [
      { language: { code: 'ko', name: 'Korean' }, word: '하나' },
      { language: { code: 'kor', name: 'Korean' }, word: '알리다' },
    ];
    const malformed = [{ language: { code: 'korean', name: 'x' }, word: '<b>뜻</b>'.repeat(50) }];
    for (const translations of [wellFormed, malformed]) {
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
      expect(result.meanings[0]!.koreanTranslations).toEqual([]);
      expect(result.meanings[0]!.senseId).toBe(
        createSenseId('one', { partOfSpeech: 'noun', definition: 'A number.', example: null }),
      );
    }
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
        // Mirrors the DB column's own DEFAULT (see schema.ts) for callers that omit it.
        attribution: input.attribution ?? {
          provider: 'FreeDictionaryAPI.com',
          name: 'Wiktionary',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        },
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
    const token = signSession({ name: ' hyunji ' }, SECRET, 3600);
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
      const token = signSession({ name: 'hyunji' }, SECRET, 3600);
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
    attribution: {
      provider: 'FreeDictionaryAPI.com',
      name: 'Wiktionary',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    },
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
    const token = signSession({ name: 'hyunji' }, SECRET, 3600);
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
    const token = signSession({ name: 'hyunji' }, SECRET, 3600);
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
    const token = signSession({ name: 'hyunji' }, SECRET, 3600);
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
    const token = signSession({ name: 'hyunji' }, SECRET, 3600);
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

  it('a plain lookup never forces a translation retry; only ?retryTranslation=true does', async () => {
    const receivedForce: Array<boolean | undefined> = [];
    const repo = new MemoryRepository();
    const translationRepository: DictionaryTranslationRepository = {
      getOrCreateTranslation: async (_word, create, options) => {
        receivedForce.push(options?.force);
        return create(repo.entry!);
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
    const token = signSession({ name: 'hyunji' }, SECRET, 3600);

    const plain = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=announce',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(plain.statusCode).toBe(200);

    const retried = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=announce&retryTranslation=true',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(retried.statusCode).toBe(200);

    expect(receivedForce).toEqual([false, true]);
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
      attribution: {
        provider: 'FreeDictionaryAPI.com',
        name: 'Wiktionary',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      },
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
    const token = signSession({ name: 'hyunji' }, SECRET, 3600);
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

  it('looks up a large polysemous word (life-shaped fixture) end to end: English result, one Mindlogic call, then a cache hit with no extra calls', async () => {
    const lifeBody = providerBody({
      word: 'life',
      entries: [
        {
          language: { code: 'en', name: 'English' },
          partOfSpeech: 'noun',
          pronunciations: [{ type: 'phonemic', text: '/laɪf/', tags: [] }],
          senses: [
            {
              definition: 'The condition distinguishing organisms from inorganic matter.',
              examples: ['Life on Earth began billions of years ago.'],
            },
            { definition: 'The existence of an individual human being.', examples: [] },
            { definition: 'A particular aspect of existence.', examples: [] },
            { definition: 'The period from birth to death.', examples: [] },
            { definition: 'Liveliness or vitality.', examples: [] },
          ],
        },
        {
          language: { code: 'en', name: 'English' },
          partOfSpeech: 'verb',
          pronunciations: [],
          senses: [{ definition: 'To imprison for a life sentence (slang).', examples: [] }],
        },
        {
          language: { code: 'en', name: 'English' },
          partOfSpeech: 'interjection',
          pronunciations: [],
          senses: [{ definition: 'Used to express resigned acceptance.', examples: [] }],
        },
      ],
    });
    const repo = new MemoryRepository();
    const fetchSpy = vi.fn(async () => jsonResponse(lifeBody));
    const translate = vi.fn(async () => ['생명', '인생']);
    let stored: string[] | null = null;
    const translationRepository: DictionaryTranslationRepository = {
      getOrCreateTranslation: async (_word, create) => {
        if (stored) return stored;
        stored = await create(repo.entry!);
        return stored;
      },
    };
    const service = new DictionaryService(repo, fetchSpy, () => NOW, translationRepository, {
      translate,
    } as unknown as DictionaryTranslator);
    const app = buildApp({
      dictionaryService: service,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const token = signSession({ name: 'hyunji' }, SECRET, 3600);

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=life',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      normalizedWord: string;
      koreanTranslations: string[];
      koreanTranslationStatus: string;
      meanings: Array<{ koreanTranslations: string[] }>;
      cached: boolean;
    };
    expect(firstBody.normalizedWord).toBe('life');
    expect(firstBody.meanings).toHaveLength(3);
    expect(firstBody.meanings.every((meaning) => meaning.koreanTranslations.length === 0)).toBe(
      true,
    );
    expect(firstBody.koreanTranslations).toEqual(['생명', '인생']);
    expect(firstBody.koreanTranslationStatus).toBe('available');
    expect(firstBody.cached).toBe(false);

    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=life',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { cached: boolean; koreanTranslations: string[] };
    expect(secondBody.cached).toBe(true);
    expect(secondBody.koreanTranslations).toEqual(['생명', '인생']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledTimes(1);
    await app.close();
  });

  function emergencySecondaryBody() {
    return [
      {
        word: 'emergency',
        phonetic: '/ɪˈmɜːdʒənsi/',
        phonetics: [],
        meanings: [
          {
            partOfSpeech: 'noun',
            definitions: [
              {
                definition: 'A sudden serious event requiring immediate action.',
                example: 'Call for help in an emergency.',
              },
            ],
          },
          {
            partOfSpeech: 'noun',
            definitions: [{ definition: 'A state of exceptional danger or difficulty.' }],
          },
          {
            partOfSpeech: 'adjective',
            definitions: [{ definition: 'Used or done in an emergency.' }],
          },
        ],
        license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0' },
        sourceUrls: ['https://en.wiktionary.org/wiki/emergency'],
      },
    ];
  }
  function routedFetchSpy(secondaryBody: unknown = emergencySecondaryBody()) {
    return vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('freedictionaryapi.com'))
        return new Response('gateway timeout', { status: 504 });
      if (url.includes('api.dictionaryapi.dev')) return jsonResponse(secondaryBody);
      throw new Error(`unexpected URL: ${url}`);
    });
  }

  it('falls back to the secondary provider for an emergency-shaped fixture: correct real attribution, Mindlogic called once, second lookup a cache hit with zero extra provider/credit calls', async () => {
    const fetchSpy = routedFetchSpy();
    const repo = new MemoryRepository();
    const translate = vi.fn(async () => ['비상']);
    let stored: string[] | null = null;
    const translationRepository: DictionaryTranslationRepository = {
      getOrCreateTranslation: async (_word, create) => {
        if (stored) return stored;
        stored = await create(repo.entry!);
        return stored;
      },
    };
    const service = new DictionaryService(repo, fetchSpy, () => NOW, translationRepository, {
      translate,
    } as unknown as DictionaryTranslator);
    const app = buildApp({
      dictionaryService: service,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const token = signSession({ name: 'hyunji' }, SECRET, 3600);

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=emergency',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      normalizedWord: string;
      koreanTranslations: string[];
      meanings: unknown[];
      source: { provider: string; name: string; license: string; licenseUrl: string; url: string };
      cached: boolean;
    };
    expect(firstBody.normalizedWord).toBe('emergency');
    expect(firstBody.meanings.length).toBeGreaterThan(0);
    expect(firstBody.koreanTranslations).toEqual(['비상']);
    // Real dictionaryapi.dev attribution — never the primary's FreeDictionaryAPI/CC BY-SA 4.0.
    expect(firstBody.source).toMatchObject({
      provider: 'DictionaryAPI.dev',
      name: 'Wiktionary',
      license: 'CC BY-SA 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
    });
    expect(firstBody.cached).toBe(false);

    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=emergency',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { cached: boolean; koreanTranslations: string[] };
    expect(secondBody.cached).toBe(true);
    expect(secondBody.koreanTranslations).toEqual(['비상']);

    // First lookup: 1 primary (failed) + 1 secondary call. Second lookup: cache hit, no more.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(translate).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('reuses the DB-backed cache across a fresh DictionaryService instance (simulated server restart) after a secondary-provider success', async () => {
    const repo = new MemoryRepository();
    const fetchSpy = routedFetchSpy();
    const first = new DictionaryService(repo, fetchSpy, () => NOW);
    const app1 = buildApp({
      dictionaryService: first,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const token = signSession({ name: 'hyunji' }, SECRET, 3600);
    await app1.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=emergency',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    await app1.close();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // A brand-new DictionaryService (and fetch spy) — only the shared repository carries state,
    // exactly like a new server process reusing the same PostgreSQL cache.
    const freshFetchSpy = vi.fn();
    const second = new DictionaryService(repo, freshFetchSpy, () => NOW);
    const app2 = buildApp({
      dictionaryService: second,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const response = await app2.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=emergency',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ cached: true });
    expect(freshFetchSpy).not.toHaveBeenCalled();
    await app2.close();
  });

  it('returns the public provider error when both providers fail for the same word', async () => {
    const fetchSpy = vi.fn(async () => new Response('boom', { status: 502 }));
    const repo = new MemoryRepository();
    const service = new DictionaryService(repo, fetchSpy, () => NOW);
    const app = buildApp({
      dictionaryService: service,
      studyDaysRoutesOptions: { sessionSecret: SECRET, maxFutureDays: 1 },
    });
    const token = signSession({ name: 'hyunji' }, SECRET, 3600);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/lookup?word=emergency',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'DICTIONARY_PROVIDER_ERROR' } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
