import { describe, expect, it } from 'vitest';
import { fetchSecondaryDictionaryEntry } from './secondary-provider.js';
import { createSenseId } from './provider.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');

function secondaryBody() {
  return [
    {
      word: 'emergency',
      phonetic: '/ɪˈmɜːd͡ʒənsi/',
      phonetics: [
        { text: '/ɪˈmɜːd͡ʒənsi/', audio: '' },
        {
          text: '/ɪˈmɜːd͡ʒənsi/',
          audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/emergency-us.mp3',
          sourceUrl: 'https://commons.wikimedia.org/w/index.php?curid=1',
          license: { name: 'BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0' },
        },
      ],
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            {
              definition: 'A sudden serious event requiring immediate action.',
              example: 'Call 911 in an emergency.',
            },
            {
              definition: 'A sudden serious event requiring immediate action.',
              example: 'duplicate',
            },
            { definition: 'A state of exceptional danger.' },
            { definition: 'A patient requiring urgent medical care.' },
          ],
          synonyms: [],
          antonyms: [],
        },
      ],
      license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0' },
      sourceUrls: ['https://en.wiktionary.org/wiki/emergency'],
    },
  ];
}

const jsonResponse = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('dictionaryapi.dev secondary provider mapping', () => {
  it('requests the fixed HTTPS endpoint, normalizes at most three unique meanings with real attribution', async () => {
    let requestedUrl = '';
    const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(input);
      expect(init?.redirect).toBe('manual');
      return jsonResponse(secondaryBody());
    };
    const result = await fetchSecondaryDictionaryEntry('emergency', fetchMock, () => NOW);
    expect(requestedUrl).toBe('https://api.dictionaryapi.dev/api/v2/entries/en/emergency');
    expect(result.meanings).toHaveLength(3);
    expect(new Set(result.meanings.map((m) => m.definition)).size).toBe(3);
    expect(result.meanings.every((m) => m.koreanTranslations.length === 0)).toBe(true);
    expect(result.pronunciation).toBe('/ɪˈmɜːd͡ʒənsi/');
    expect(result.audioUrl).toBe(
      'https://api.dictionaryapi.dev/media/pronunciations/en/emergency-us.mp3',
    );
    expect(result.sourceUrl).toBe('https://en.wiktionary.org/wiki/emergency');
    expect(result.attribution).toEqual({
      provider: 'DictionaryAPI.dev',
      name: 'Wiktionary',
      license: 'CC BY-SA 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
    });
    expect(result.koreanTranslations).toEqual([]);
    expect(result.expiresAt.getTime() - result.fetchedAt.getTime()).toBe(30 * 86400_000);
    // senseId uses the same canonical serialization as the primary provider.
    expect(result.meanings[0]!.senseId).toBe(
      createSenseId('emergency', {
        partOfSpeech: 'noun',
        definition: 'A sudden serious event requiring immediate action.',
        example: 'Call 911 in an emergency.',
      }),
    );
  });

  it('rejects an http (non-https) audio URL and falls back to no audio', async () => {
    const body = secondaryBody();
    (body[0] as { phonetics: unknown[] }).phonetics = [
      { text: '/x/', audio: 'http://insecure.example/audio.mp3' },
    ];
    const result = await fetchSecondaryDictionaryEntry(
      'emergency',
      async () => jsonResponse(body),
      () => NOW,
    );
    expect(result.audioUrl).toBeNull();
  });

  it('rejects a spoofed license name that does not match a real Creative Commons family', async () => {
    const body = secondaryBody();
    (body[0] as { license: unknown }).license = {
      name: 'All rights reserved',
      url: 'https://creativecommons.org/licenses/by-sa/3.0',
    };
    await expect(
      fetchSecondaryDictionaryEntry(
        'emergency',
        async () => jsonResponse(body),
        () => NOW,
      ),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_INVALID_RESPONSE',
      statusCode: 502,
      provider: 'secondary',
    });
  });

  it('rejects a license URL not hosted on creativecommons.org', async () => {
    const body = secondaryBody();
    (body[0] as { license: unknown }).license = {
      name: 'CC BY-SA 3.0',
      url: 'https://evil.example/licenses/by-sa/3.0',
    };
    await expect(
      fetchSecondaryDictionaryEntry(
        'emergency',
        async () => jsonResponse(body),
        () => NOW,
      ),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_INVALID_RESPONSE',
      statusCode: 502,
      provider: 'secondary',
    });
  });

  it('rejects a source URL that is not en.wiktionary.org', async () => {
    const body = secondaryBody();
    (body[0] as { sourceUrls: unknown }).sourceUrls = ['https://evil.example/emergency'];
    await expect(
      fetchSecondaryDictionaryEntry(
        'emergency',
        async () => jsonResponse(body),
        () => NOW,
      ),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_INVALID_RESPONSE',
      statusCode: 502,
      provider: 'secondary',
    });
  });

  it('maps an unknown word to WORD_NOT_FOUND on a 404 (dictionaryapi.dev convention)', async () => {
    await expect(
      fetchSecondaryDictionaryEntry(
        'zzznotaword',
        async () =>
          new Response(JSON.stringify({ title: 'No Definitions Found' }), { status: 404 }),
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'WORD_NOT_FOUND', statusCode: 404, provider: 'secondary' });
  });

  it('maps 429 with retry-after and 5xx to provider-failure codes without exposing bodies', async () => {
    await expect(
      fetchSecondaryDictionaryEntry(
        'emergency',
        async () => new Response('secret', { status: 429, headers: { 'retry-after': '5' } }),
        () => NOW,
      ),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_RATE_LIMITED',
      statusCode: 503,
      retryAfter: '5',
      provider: 'secondary',
    });
    await expect(
      fetchSecondaryDictionaryEntry(
        'emergency',
        async () => new Response('secret', { status: 500 }),
        () => NOW,
      ),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_UPSTREAM_ERROR',
      statusCode: 503,
      provider: 'secondary',
    });
  });

  it('rejects malformed JSON and an empty array response', async () => {
    await expect(
      fetchSecondaryDictionaryEntry(
        'emergency',
        async () => new Response('{', { status: 200 }),
        () => NOW,
      ),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_INVALID_RESPONSE',
      statusCode: 502,
      provider: 'secondary',
    });
    await expect(
      fetchSecondaryDictionaryEntry(
        'emergency',
        async () => jsonResponse([]),
        () => NOW,
      ),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_INVALID_RESPONSE',
      statusCode: 502,
      provider: 'secondary',
    });
  });

  it('rejects an oversized response body', async () => {
    const huge = secondaryBody();
    (huge[0] as { meanings: unknown[] }).meanings = Array.from({ length: 500 }, (_, i) => ({
      partOfSpeech: 'noun',
      definitions: Array.from({ length: 500 }, (_, j) => ({
        definition: `Definition ${i}-${j} padding text.`,
      })),
    }));
    await expect(
      fetchSecondaryDictionaryEntry(
        'emergency',
        async () => jsonResponse(huge),
        () => NOW,
      ),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_INVALID_RESPONSE',
      statusCode: 502,
      provider: 'secondary',
    });
  });

  it('rejects HTML injected into a definition', async () => {
    const body = secondaryBody();
    (body[0] as { meanings: unknown[] }).meanings = [
      { partOfSpeech: 'noun', definitions: [{ definition: '<b>bad</b>' }] },
    ];
    await expect(
      fetchSecondaryDictionaryEntry(
        'emergency',
        async () => jsonResponse(body),
        () => NOW,
      ),
    ).rejects.toMatchObject({
      code: 'DICTIONARY_INVALID_RESPONSE',
      statusCode: 502,
      provider: 'secondary',
    });
  });
});
