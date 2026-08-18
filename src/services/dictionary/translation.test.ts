import { describe, expect, it, vi } from 'vitest';
import type { CreditService } from '../credits/credit-service.js';
import type { MindlogicClient } from '../mindlogic/client.js';
import { EMPTY_ERROR_OBSERVABILITY, MindlogicApiError } from '../mindlogic/types.js';
import {
  buildDictionaryTranslationMessages,
  dictionaryTranslationSchema,
  DictionaryTranslator,
} from './translation.js';
import type { DictionaryEntry } from './types.js';

const entry = (): DictionaryEntry => ({
  query: 'summer',
  normalizedWord: 'summer',
  pronunciation: null,
  audioUrl: null,
  koreanTranslations: [],
  meanings: [
    {
      senseId: 'a'.repeat(64),
      partOfSpeech: 'noun',
      definition: 'The warmest season of the year.',
      example: 'We travel in summer.',
      koreanTranslations: [],
    },
  ],
  sourceUrl: 'https://en.wiktionary.org/wiki/summer',
  fetchedAt: new Date(),
  expiresAt: new Date(Date.now() + 1000),
  cacheSchemaVersion: 2,
});

describe('dictionaryTranslationSchema', () => {
  it('normalizes, trims and de-duplicates while preserving order', () => {
    expect(
      dictionaryTranslationSchema.parse({
        koreanTranslations: [' 여름 ', '전성기', '여름', 'Ａ와 여름'],
      }),
    ).toEqual({ koreanTranslations: ['여름', '전성기', 'A와 여름'] });
  });

  it.each([
    { koreanTranslations: [] },
    { koreanTranslations: ['summer'] },
    { koreanTranslations: ['<b>여름</b>'] },
    { koreanTranslations: ['**여름**'] },
    { koreanTranslations: ['https://example.com/여름'] },
    { koreanTranslations: ['여름\u0000'] },
    { koreanTranslations: ['이것은 일 년 중 가장 따뜻한 계절을 뜻하는 매우 긴 설명문입니다.'] },
    { koreanTranslations: ['여름'], extra: true },
  ])('rejects unsafe or non-contract output %#', (value) => {
    expect(dictionaryTranslationSchema.safeParse(value).success).toBe(false);
  });

  it('accepts one through five short Korean meanings', () => {
    expect(
      dictionaryTranslationSchema.parse({
        koreanTranslations: ['하나', '둘', '셋', '넷', '다섯'],
      }).koreanTranslations,
    ).toHaveLength(5);
  });
});

describe('dictionary translation prompt', () => {
  it('uses only canonical bounded dictionary fields', () => {
    const messages = buildDictionaryTranslationMessages(entry());
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain('summer');
    expect(messages[1]?.content).toContain('The warmest season');
    expect(messages[1]?.content).not.toContain('session');
  });
});

describe('DictionaryTranslator credit lifecycle', () => {
  const completed = (content: unknown) => ({
    id: 'mock',
    model: 'gpt-5.4-mini',
    choices: [{ message: { role: 'assistant' as const, content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
  });

  it.each([
    ['summer', ['여름', '전성기']],
    ['winter', ['겨울']],
  ])('reserves once and reconciles a valid %s result', async (word, translations) => {
    const reserveCredits = vi.fn().mockResolvedValue({
      ok: true,
      record: { creditsReserved: 2 },
    });
    const commitCredits = vi.fn().mockResolvedValue(undefined);
    const createChatCompletion = vi
      .fn()
      .mockResolvedValue(completed({ koreanTranslations: translations }));
    const translator = new DictionaryTranslator({
      creditService: { reserveCredits, commitCredits } as unknown as CreditService,
      mindlogicClient: { createChatCompletion } as unknown as MindlogicClient,
      generateRequestId: () => '00000000-0000-4000-8000-000000000001',
    });
    const input = entry();
    input.query = word;
    input.normalizedWord = word;
    expect(await translator.translate(input)).toEqual(translations);
    expect(reserveCredits).toHaveBeenCalledTimes(1);
    expect(commitCredits).toHaveBeenCalledTimes(1);
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('does not call Mindlogic when the shared cap rejects reservation', async () => {
    const createChatCompletion = vi.fn();
    const translator = new DictionaryTranslator({
      creditService: {
        reserveCredits: vi.fn().mockResolvedValue({ ok: false, reason: 'limit_exceeded' }),
      } as unknown as CreditService,
      mindlogicClient: { createChatCompletion } as unknown as MindlogicClient,
    });
    expect(await translator.translate(entry())).toEqual([]);
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  function reservedTranslator(mindlogicClient: Partial<MindlogicClient>) {
    const reserveCredits = vi.fn().mockResolvedValue({ ok: true, record: { creditsReserved: 2 } });
    const commitCredits = vi.fn().mockResolvedValue(undefined);
    const releaseCredits = vi.fn().mockResolvedValue(undefined);
    const markReconciliationPending = vi.fn().mockResolvedValue(undefined);
    const translator = new DictionaryTranslator({
      creditService: {
        reserveCredits,
        commitCredits,
        releaseCredits,
        markReconciliationPending,
      } as unknown as CreditService,
      mindlogicClient: mindlogicClient as MindlogicClient,
      generateRequestId: () => '00000000-0000-4000-8000-000000000002',
    });
    return { translator, reserveCredits, commitCredits, releaseCredits, markReconciliationPending };
  }

  // These four cover section 4's "Mindlogic 한국어 번역 실패" policy at the translator layer —
  // none of them may ever throw out of translate(); the caller always gets [] back so the
  // already-fetched English result can still be returned with HTTP 200.
  it('releases the reservation and returns [] on a Mindlogic 429', async () => {
    const { translator, releaseCredits, markReconciliationPending } = reservedTranslator({
      createChatCompletion: vi
        .fn()
        .mockRejectedValue(
          new MindlogicApiError('rate_limited', 429, 'rate limited', EMPTY_ERROR_OBSERVABILITY),
        ),
    });
    await expect(translator.translate(entry())).resolves.toEqual([]);
    expect(releaseCredits).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      'rate_limited',
    );
    expect(markReconciliationPending).not.toHaveBeenCalled();
  });

  it('releases the reservation and returns [] on a Mindlogic 5xx', async () => {
    const { translator, releaseCredits } = reservedTranslator({
      createChatCompletion: vi
        .fn()
        .mockRejectedValue(
          new MindlogicApiError('provider_error', 500, 'server error', EMPTY_ERROR_OBSERVABILITY),
        ),
    });
    await expect(translator.translate(entry())).resolves.toEqual([]);
    expect(releaseCredits).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      'provider_error',
    );
  });

  it('marks reconciliation pending (never releases) on a Mindlogic timeout — billing status is unknown', async () => {
    const { translator, releaseCredits, markReconciliationPending } = reservedTranslator({
      createChatCompletion: vi
        .fn()
        .mockRejectedValue(
          new MindlogicApiError('timeout', 0, 'client timeout', EMPTY_ERROR_OBSERVABILITY),
        ),
    });
    await expect(translator.translate(entry())).resolves.toEqual([]);
    expect(markReconciliationPending).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      'timeout',
    );
    expect(releaseCredits).not.toHaveBeenCalled();
  });

  it('commits the reservation but returns [] on malformed structured output', async () => {
    const { translator, commitCredits } = reservedTranslator({
      createChatCompletion: vi.fn().mockResolvedValue({
        id: 'mock',
        model: 'gpt-5.4-mini',
        choices: [{ message: { role: 'assistant' as const, content: 'not json at all' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
    });
    await expect(translator.translate(entry())).resolves.toEqual([]);
    // A response was received and billable — it's committed, not released.
    expect(commitCredits).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      expect.any(Number),
    );
  });

  it('commits the reservation but returns [] when the structured output has no Hangul (schema rejects it)', async () => {
    const { translator, commitCredits } = reservedTranslator({
      createChatCompletion: vi.fn().mockResolvedValue({
        id: 'mock',
        model: 'gpt-5.4-mini',
        choices: [
          {
            message: {
              role: 'assistant' as const,
              content: JSON.stringify({ koreanTranslations: ['summer'] }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
    });
    await expect(translator.translate(entry())).resolves.toEqual([]);
    expect(commitCredits).toHaveBeenCalled();
  });
});
