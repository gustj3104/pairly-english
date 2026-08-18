import { describe, expect, it, vi } from 'vitest';
import { fetchDictionaryEntryWithFallback } from './fallback.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');

function primaryBody(overrides: Record<string, unknown> = {}) {
  return {
    word: 'emergency',
    entries: [
      {
        language: { code: 'en', name: 'English' },
        partOfSpeech: 'noun',
        pronunciations: [{ type: 'phonemic', text: '/ɪˈmɜːd͡ʒənsi/', tags: [] }],
        senses: [
          { definition: 'A sudden serious event requiring immediate action.', examples: [] },
        ],
      },
    ],
    source: {
      url: 'https://en.wiktionary.org/wiki/emergency',
      license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    },
    ...overrides,
  };
}

function secondaryBody() {
  return [
    {
      word: 'emergency',
      phonetic: '/ɪˈmɜːd͡ʒənsi/',
      phonetics: [],
      meanings: [
        { partOfSpeech: 'noun', definitions: [{ definition: 'A state requiring urgent action.' }] },
      ],
      license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0' },
      sourceUrls: ['https://en.wiktionary.org/wiki/emergency'],
    },
  ];
}

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function routedFetch(handlers: {
  primary?: () => Response | Promise<Response>;
  secondary?: () => Response | Promise<Response>;
}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('freedictionaryapi.com')) {
      if (!handlers.primary) throw new Error('unexpected primary call');
      return handlers.primary();
    }
    if (url.includes('api.dictionaryapi.dev')) {
      if (!handlers.secondary) throw new Error('unexpected secondary call');
      return handlers.secondary();
    }
    throw new Error(`unexpected URL: ${url}`);
  });
}

describe('fetchDictionaryEntryWithFallback', () => {
  it('never calls secondary when primary succeeds', async () => {
    const fetchMock = routedFetch({ primary: () => json(primaryBody()) });
    const entry = await fetchDictionaryEntryWithFallback('emergency', fetchMock, () => NOW);
    expect(entry.attribution.provider).toBe('FreeDictionaryAPI.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to secondary on primary timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('freedictionaryapi.com')) {
          // Never settles on its own — only reacts to the real AbortController the provider
          // wires up via PROVIDER_TIMEOUT_MS, exactly like a hung real connection would.
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
        }
        return json(secondaryBody());
      });
      const resultPromise = fetchDictionaryEntryWithFallback('emergency', fetchMock, () => NOW);
      await vi.advanceTimersByTimeAsync(5000);
      const entry = await resultPromise;
      expect(entry.attribution.provider).toBe('DictionaryAPI.dev');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to secondary on primary 429', async () => {
    const fetchMock = routedFetch({
      primary: () =>
        new Response('rate limited', { status: 429, headers: { 'retry-after': '10' } }),
      secondary: () => json(secondaryBody()),
    });
    const entry = await fetchDictionaryEntryWithFallback('emergency', fetchMock, () => NOW);
    expect(entry.attribution.provider).toBe('DictionaryAPI.dev');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to secondary on primary 5xx', async () => {
    const fetchMock = routedFetch({
      primary: () => new Response('boom', { status: 502 }),
      secondary: () => json(secondaryBody()),
    });
    const entry = await fetchDictionaryEntryWithFallback('emergency', fetchMock, () => NOW);
    expect(entry.attribution.provider).toBe('DictionaryAPI.dev');
  });

  it('falls back to secondary on malformed primary JSON', async () => {
    const fetchMock = routedFetch({
      primary: () => new Response('not json', { status: 200 }),
      secondary: () => json(secondaryBody()),
    });
    const entry = await fetchDictionaryEntryWithFallback('emergency', fetchMock, () => NOW);
    expect(entry.attribution.provider).toBe('DictionaryAPI.dev');
  });

  it('falls back to secondary on an oversized primary response', async () => {
    const oversizedBody = primaryBody();
    const fetchMock = routedFetch({
      primary: () => json(oversizedBody, 200, { 'content-length': String(2 * 1024 * 1024) }),
      secondary: () => json(secondaryBody()),
    });
    const entry = await fetchDictionaryEntryWithFallback('emergency', fetchMock, () => NOW);
    expect(entry.attribution.provider).toBe('DictionaryAPI.dev');
  });

  it('falls back to secondary when primary fails strict schema validation', async () => {
    const invalidBody = primaryBody({
      source: {
        url: 'https://evil.example/emergency',
        license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      },
    });
    const fetchMock = routedFetch({
      primary: () => json(invalidBody),
      secondary: () => json(secondaryBody()),
    });
    const entry = await fetchDictionaryEntryWithFallback('emergency', fetchMock, () => NOW);
    expect(entry.attribution.provider).toBe('DictionaryAPI.dev');
  });

  it('does not call secondary on an unambiguous primary word-not-found', async () => {
    const fetchMock = routedFetch({ primary: () => json(primaryBody({ entries: [] })) });
    await expect(
      fetchDictionaryEntryWithFallback('zzznotaword', fetchMock, () => NOW),
    ).rejects.toMatchObject({
      code: 'WORD_NOT_FOUND',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates the secondary provider error, public-shaped the same as any provider failure, when both fail', async () => {
    const fetchMock = routedFetch({
      primary: () => new Response('boom', { status: 502 }),
      secondary: () => new Response('boom', { status: 500 }),
    });
    await expect(
      fetchDictionaryEntryWithFallback('emergency', fetchMock, () => NOW),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_UPSTREAM_ERROR',
      statusCode: 503,
      provider: 'secondary',
    });
  });

  it('logs a safe fallback-attempt summary without the request URL, response body, or secrets', async () => {
    const fetchMock = routedFetch({
      primary: () => new Response('super-secret-body', { status: 502 }),
      secondary: () => json(secondaryBody()),
    });
    const logger = { warn: vi.fn() };
    await fetchDictionaryEntryWithFallback('emergency', fetchMock, () => NOW, logger);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [fields] = logger.warn.mock.calls[0]!;
    expect(fields).toMatchObject({
      feature: 'dictionary_lookup',
      provider: 'primary',
      errorCategory: 'DICTIONARY_UPSTREAM_ERROR',
      httpStatus: 503,
      fallbackAttempted: true,
      fallbackSucceeded: true,
      cacheHit: false,
    });
    expect(typeof fields.latencyMs).toBe('number');
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain('freedictionaryapi.com');
    expect(serialized).not.toContain('super-secret-body');
  });

  it('never calls both providers concurrently: secondary is only invoked after primary settles', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('freedictionaryapi.com')) {
        calls.push('primary-start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        calls.push('primary-end');
        return new Response('boom', { status: 502 });
      }
      calls.push('secondary-start');
      return json(secondaryBody());
    });
    await fetchDictionaryEntryWithFallback('emergency', fetchMock, () => NOW);
    expect(calls).toEqual(['primary-start', 'primary-end', 'secondary-start']);
  });
});
