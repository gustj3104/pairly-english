import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CreditService } from '../credits/credit-service.js';
import { calculateCredits } from '../credits/credit-calculator.js';
import type { MindlogicClient } from '../mindlogic/client.js';
import { getFeatureModelConfig } from '../mindlogic/feature-config.js';
import { estimateChatRequestInputTokens } from '../mindlogic/token-estimate.js';
import {
  CERTAIN_NOT_SENT_ERROR_CODES,
  MindlogicApiError,
  RECEIVED_RESPONSE_ERROR_CODES,
  UNCERTAIN_BILLING_ERROR_CODES,
  type ChatMessage,
} from '../mindlogic/types.js';
import type { DictionaryEntry } from './types.js';

const FEATURE = 'dictionary_translation' as const;
const HANGUL = /[가-힣]/;
const URL = /(?:https?:\/\/|www\.)/i;
const MARKDOWN = /(?:```|`|\*\*|__|^\s{0,3}#{1,6}\s|\[[^\]]+\]\([^)]*\))/m;
const HTML = /<\/?[A-Za-z][^>]*>/;
function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

// Models routinely add a trailing sentence-ending mark to a short gloss despite the system
// prompt asking for word-level meanings only (e.g. "의사소통." instead of "의사소통") — cosmetic,
// not unsafe, so it's normalized away here rather than rejecting an otherwise-valid translation
// outright. HTML/URL/markdown/control-character checks below are unaffected and still reject.
const TRAILING_SENTENCE_PUNCTUATION = /[.!?。！？]+\s*$/;

const shortTranslation = z
  .string()
  .transform((value) =>
    value.normalize('NFKC').trim().replace(TRAILING_SENTENCE_PUNCTUATION, '').trim(),
  )
  .pipe(
    z
      .string()
      .min(1)
      .max(30)
      .refine((value) => HANGUL.test(value))
      .refine((value) => !URL.test(value) && !MARKDOWN.test(value) && !HTML.test(value))
      .refine((value) => !containsControlCharacter(value)),
  );

export const dictionaryTranslationSchema = z
  .object({ koreanTranslations: z.array(shortTranslation).min(1).max(5) })
  .strict()
  .transform(({ koreanTranslations }) => ({
    koreanTranslations: koreanTranslations.filter(
      (value, index, values) => values.indexOf(value) === index,
    ),
  }))
  .refine((value) => value.koreanTranslations.length > 0);

export const DICTIONARY_TRANSLATION_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'dictionary_translation',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['koreanTranslations'],
      properties: {
        koreanTranslations: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: { type: 'string', minLength: 1, maxLength: 30 },
        },
      },
    },
  },
};

const SYSTEM_PROMPT =
  '주어진 영어 단어와 검증된 사전 정의만 기준으로 한국어 학습자가 이해할 짧은 한국어 단어 뜻만 JSON으로 반환한다. 설명문, 정의 전체 번역, 품사, 예문, 머리말, 마크다운은 반환하지 않는다. 사전에 없는 의미를 추가하지 않는다.';

export function buildDictionaryTranslationMessages(entry: DictionaryEntry): ChatMessage[] {
  const meanings = entry.meanings.slice(0, 3).map(({ partOfSpeech, definition, example }) => ({
    partOfSpeech,
    definition,
    ...(example ? { example } : {}),
  }));
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({ normalizedWord: entry.normalizedWord, meanings }),
    },
  ];
}

export interface DictionaryTranslatorDeps {
  creditService: CreditService;
  mindlogicClient: MindlogicClient;
  now?: () => Date;
  generateRequestId?: () => string;
}

export class DictionaryTranslator {
  constructor(private readonly deps: DictionaryTranslatorDeps) {}

  async translate(entry: DictionaryEntry): Promise<string[]> {
    const { model, maxOutputTokens } = getFeatureModelConfig(FEATURE);
    const messages = buildDictionaryTranslationMessages(entry);
    const inputTokens = estimateChatRequestInputTokens({
      messages,
      responseFormatSchema: DICTIONARY_TRANSLATION_RESPONSE_FORMAT,
    });
    const requestId = this.deps.generateRequestId?.() ?? randomUUID();
    const reservation = await this.deps.creditService.reserveCredits({
      requestId,
      feature: FEATURE,
      model,
      inputTokens,
      outputTokens: maxOutputTokens,
      now: this.deps.now?.(),
    });
    if (!reservation.ok) return [];
    const reserved = reservation.record.creditsReserved;
    let completion;
    try {
      completion = await this.deps.mindlogicClient.createChatCompletion({
        model,
        messages,
        max_tokens: maxOutputTokens,
        response_format: DICTIONARY_TRANSLATION_RESPONSE_FORMAT,
        stream: false,
      });
    } catch (error) {
      if (error instanceof MindlogicApiError) {
        if (UNCERTAIN_BILLING_ERROR_CODES.includes(error.code)) {
          await this.deps.creditService.markReconciliationPending(requestId, error.code);
        } else if (
          RECEIVED_RESPONSE_ERROR_CODES.includes(error.code) ||
          CERTAIN_NOT_SENT_ERROR_CODES.includes(error.code)
        ) {
          await this.deps.creditService.releaseCredits(requestId, error.code);
        } else {
          await this.deps.creditService.releaseCredits(requestId, 'unknown_error');
        }
        return [];
      }
      await this.deps.creditService.releaseCredits(requestId, 'pre_provider_failure');
      return [];
    }
    const usage = completion.usage;
    const actual = usage
      ? calculateCredits(model, usage.prompt_tokens, usage.completion_tokens)
      : reserved;
    await this.deps.creditService.commitCredits(requestId, Math.min(actual, reserved));
    if (actual > reserved) return [];
    try {
      const parsed = JSON.parse(completion.choices[0]?.message.content ?? '');
      const result = dictionaryTranslationSchema.safeParse(parsed);
      return result.success ? result.data.koreanTranslations : [];
    } catch {
      return [];
    }
  }
}
