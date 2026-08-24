import { describe, expect, it, vi } from 'vitest';
import type { CreditService } from '../credits/credit-service.js';
import type { MindlogicClient } from '../mindlogic/client.js';
import { EMPTY_ERROR_OBSERVABILITY, MindlogicApiError } from '../mindlogic/types.js';
import {
  buildDictionaryLookupMessages,
  DictionaryAiLookup,
  dictionaryLookupAiResponseSchema,
} from './ai-lookup.js';

const NOW = new Date('2026-08-24T00:00:00.000Z');

const validResponse = (overrides: Record<string, unknown> = {}) => ({
  word: 'robot',
  pronunciation: '/ˈroʊbɑːt/',
  meanings: [
    {
      partOfSpeech: 'noun',
      koreanTranslations: ['로봇', '자동 기계'],
      definition: 'A machine that can perform tasks automatically.',
      example: 'The robot cleaned the floor.',
    },
  ],
  ...overrides,
});

describe('dictionaryLookupAiResponseSchema', () => {
  it('accepts a valid response, normalizes pronunciation, and dedupes Korean translations', () => {
    const parsed = dictionaryLookupAiResponseSchema.parse(
      validResponse({
        meanings: [
          { ...validResponse().meanings[0], koreanTranslations: [' 로봇 ', '로봇', '자동 기계'] },
        ],
      }),
    );
    expect(parsed.pronunciation).toBe('/ˈroʊbɑːt/');
    expect(parsed.koreanTranslations).toEqual(['로봇', '자동 기계']);
    expect(parsed.meanings).toHaveLength(1);
  });

  it('normalizes an empty-string pronunciation to null', () => {
    expect(
      dictionaryLookupAiResponseSchema.parse(validResponse({ pronunciation: '' })).pronunciation,
    ).toBeNull();
  });

  it('strips a trailing sentence-ending mark from each Korean gloss', () => {
    expect(
      dictionaryLookupAiResponseSchema.parse(
        validResponse({
          meanings: [{ ...validResponse().meanings[0], koreanTranslations: ['로봇.', '기계!'] }],
        }),
      ).koreanTranslations,
    ).toEqual(['로봇', '기계']);
  });

  it.each([
    [
      'empty koreanTranslations',
      validResponse({ meanings: [{ ...validResponse().meanings[0], koreanTranslations: [] }] }),
    ],
    [
      'no Hangul in a Korean gloss',
      validResponse({
        meanings: [{ ...validResponse().meanings[0], koreanTranslations: ['robot'] }],
      }),
    ],
    [
      'HTML in a Korean gloss',
      validResponse({
        meanings: [{ ...validResponse().meanings[0], koreanTranslations: ['<b>로봇</b>'] }],
      }),
    ],
    ['too many meanings', validResponse({ meanings: Array(4).fill(validResponse().meanings[0]) })],
    ['no meanings', validResponse({ meanings: [] })],
    [
      'HTML in a definition',
      validResponse({
        meanings: [
          {
            partOfSpeech: 'noun',
            koreanTranslations: ['나쁨'],
            definition: '<b>bad</b>',
            example: 'x y',
          },
        ],
      }),
    ],
    ['unexpected extra field', { ...validResponse(), extra: true }],
    [
      'missing word',
      (() => {
        const { word: _word, ...rest } = validResponse();
        return rest;
      })(),
    ],
  ])('rejects %s', (_label, value) => {
    expect(dictionaryLookupAiResponseSchema.safeParse(value).success).toBe(false);
  });
});

describe('buildDictionaryLookupMessages', () => {
  it('sends only the word, never the article/context', () => {
    const messages = buildDictionaryLookupMessages('robot');
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toBe(JSON.stringify({ word: 'robot' }));
  });
});

describe('DictionaryAiLookup credit lifecycle', () => {
  const completed = (content: unknown) => ({
    id: 'mock',
    model: 'gpt-5.6-luna',
    choices: [{ message: { role: 'assistant' as const, content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
  });

  it('reserves once, calls Mindlogic once, commits once, and returns a full entry on success', async () => {
    const reserveCredits = vi.fn().mockResolvedValue({ ok: true, record: { creditsReserved: 5 } });
    const commitCredits = vi.fn().mockResolvedValue(undefined);
    const createChatCompletion = vi.fn().mockResolvedValue(completed(validResponse()));
    const lookup = new DictionaryAiLookup({
      creditService: { reserveCredits, commitCredits } as unknown as CreditService,
      mindlogicClient: { createChatCompletion } as unknown as MindlogicClient,
      generateRequestId: () => '00000000-0000-4000-8000-000000000001',
    });
    const entry = await lookup.fetchEntry('robot', NOW);
    expect(entry.query).toBe('robot');
    expect(entry.koreanTranslations).toEqual(['로봇', '자동 기계']);
    expect(entry.meanings).toHaveLength(1);
    expect(entry.meanings[0]?.senseId).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.cacheSchemaVersion).toBe(5);
    expect(reserveCredits).toHaveBeenCalledTimes(1);
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(commitCredits).toHaveBeenCalledTimes(1);
    const [call] = createChatCompletion.mock.calls;
    expect(call?.[0]).toMatchObject({ model: 'gpt-5.6-luna' });
  });

  it('commits the real gpt-5.6-luna credit-reservation rate computed from actual token usage, not a mocked value', async () => {
    // 10,000 prompt tokens * 0.2/1000 = 2.0, 500 completion tokens * 1.2/1000 = 0.6 -> 2.6 -> ceil(2.6) = 3.
    // Exercises the real calculateCredits/MODEL_CREDIT_RATES wiring end to end — see
    // credit-calculator.test.ts for the same official rate asserted in isolation.
    const reserveCredits = vi
      .fn()
      .mockResolvedValue({ ok: true, record: { creditsReserved: 100 } });
    const commitCredits = vi.fn().mockResolvedValue(undefined);
    const createChatCompletion = vi.fn().mockResolvedValue({
      id: 'mock',
      model: 'gpt-5.6-luna',
      choices: [
        { message: { role: 'assistant' as const, content: JSON.stringify(validResponse()) } },
      ],
      usage: { prompt_tokens: 10_000, completion_tokens: 500, total_tokens: 10_500 },
    });
    const lookup = new DictionaryAiLookup({
      creditService: { reserveCredits, commitCredits } as unknown as CreditService,
      mindlogicClient: { createChatCompletion } as unknown as MindlogicClient,
      generateRequestId: () => '00000000-0000-4000-8000-000000000003',
    });
    await lookup.fetchEntry('robot', NOW);
    expect(commitCredits).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000003', 3);
  });

  it('throws DICTIONARY_CREDIT_LIMIT and never calls Mindlogic when the shared cap rejects reservation', async () => {
    const createChatCompletion = vi.fn();
    const lookup = new DictionaryAiLookup({
      creditService: {
        reserveCredits: vi.fn().mockResolvedValue({ ok: false, reason: 'limit_exceeded' }),
      } as unknown as CreditService,
      mindlogicClient: { createChatCompletion } as unknown as MindlogicClient,
    });
    await expect(lookup.fetchEntry('robot', NOW)).rejects.toMatchObject({
      code: 'DICTIONARY_CREDIT_LIMIT',
      statusCode: 402,
    });
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it('throws DICTIONARY_AI_UNAVAILABLE when reservation is rejected for a reason other than the monthly cap', async () => {
    const lookup = new DictionaryAiLookup({
      creditService: {
        reserveCredits: vi.fn().mockResolvedValue({ ok: false, reason: 'reconciliation_pending' }),
      } as unknown as CreditService,
      mindlogicClient: { createChatCompletion: vi.fn() } as unknown as MindlogicClient,
    });
    await expect(lookup.fetchEntry('robot', NOW)).rejects.toMatchObject({
      code: 'DICTIONARY_AI_UNAVAILABLE',
      statusCode: 503,
    });
  });

  function reservedLookup(mindlogicClient: Partial<MindlogicClient>) {
    const reserveCredits = vi.fn().mockResolvedValue({ ok: true, record: { creditsReserved: 5 } });
    const commitCredits = vi.fn().mockResolvedValue(undefined);
    const releaseCredits = vi.fn().mockResolvedValue(undefined);
    const markReconciliationPending = vi.fn().mockResolvedValue(undefined);
    const warn = vi.fn();
    const lookup = new DictionaryAiLookup({
      creditService: {
        reserveCredits,
        commitCredits,
        releaseCredits,
        markReconciliationPending,
      } as unknown as CreditService,
      mindlogicClient: mindlogicClient as MindlogicClient,
      generateRequestId: () => '00000000-0000-4000-8000-000000000002',
      logger: { warn },
    });
    return {
      lookup,
      reserveCredits,
      commitCredits,
      releaseCredits,
      markReconciliationPending,
      warn,
    };
  }

  it('releases the reservation and throws DICTIONARY_AI_UNAVAILABLE on a Mindlogic 429', async () => {
    const { lookup, releaseCredits, markReconciliationPending, warn } = reservedLookup({
      createChatCompletion: vi
        .fn()
        .mockRejectedValue(
          new MindlogicApiError('rate_limited', 429, 'rate limited', EMPTY_ERROR_OBSERVABILITY),
        ),
    });
    await expect(lookup.fetchEntry('robot', NOW)).rejects.toMatchObject({
      code: 'DICTIONARY_AI_UNAVAILABLE',
      statusCode: 503,
    });
    expect(releaseCredits).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      'rate_limited',
    );
    expect(markReconciliationPending).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'dictionary_generation',
        outcome: 'upstream_failed',
        upstreamCode: 'rate_limited',
        upstreamStatus: 429,
        settlement: 'released',
        model: 'gpt-5.6-luna',
      }),
      'dictionary lookup failed',
    );
  });

  it('marks reconciliation pending (never releases) on a Mindlogic timeout — billing status is unknown', async () => {
    const { lookup, releaseCredits, markReconciliationPending } = reservedLookup({
      createChatCompletion: vi
        .fn()
        .mockRejectedValue(
          new MindlogicApiError('timeout', 0, 'client timeout', EMPTY_ERROR_OBSERVABILITY),
        ),
    });
    await expect(lookup.fetchEntry('robot', NOW)).rejects.toMatchObject({
      code: 'DICTIONARY_AI_UNAVAILABLE',
    });
    expect(markReconciliationPending).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      'timeout',
    );
    expect(releaseCredits).not.toHaveBeenCalled();
  });

  it('commits the reservation but throws DICTIONARY_INVALID_RESPONSE on malformed JSON', async () => {
    const { lookup, commitCredits, warn } = reservedLookup({
      createChatCompletion: vi.fn().mockResolvedValue({
        id: 'mock',
        model: 'gpt-5.6-luna',
        choices: [{ message: { role: 'assistant' as const, content: 'not json at all' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
    });
    await expect(lookup.fetchEntry('robot', NOW)).rejects.toMatchObject({
      code: 'DICTIONARY_INVALID_RESPONSE',
      statusCode: 502,
    });
    expect(commitCredits).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      expect.any(Number),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'dictionary_generation', outcome: 'invalid_json' }),
      'dictionary lookup failed',
    );
  });

  it('commits the reservation but throws DICTIONARY_INVALID_RESPONSE when the structured output fails schema validation (e.g. empty koreanTranslations)', async () => {
    const { lookup, commitCredits, warn } = reservedLookup({
      createChatCompletion: vi
        .fn()
        .mockResolvedValue(completed(validResponse({ koreanTranslations: [] }))),
    });
    await expect(lookup.fetchEntry('robot', NOW)).rejects.toMatchObject({
      code: 'DICTIONARY_INVALID_RESPONSE',
    });
    expect(commitCredits).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'dictionary_generation', outcome: 'schema_invalid' }),
      'dictionary lookup failed',
    );
  });

  it('never logs anything on a successful lookup', async () => {
    const { lookup, warn } = reservedLookup({
      createChatCompletion: vi.fn().mockResolvedValue(completed(validResponse())),
    });
    await lookup.fetchEntry('robot', NOW);
    expect(warn).not.toHaveBeenCalled();
  });
});
