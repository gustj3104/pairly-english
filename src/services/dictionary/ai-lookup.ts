import { createHash, randomUUID } from 'node:crypto';
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
import { containsUnsafeText } from './validation.js';
import {
  AI_DICTIONARY_CACHE_SCHEMA_VERSION,
  DictionaryError,
  type DictionaryEntry,
  type DictionaryMeaning,
  type DictionaryServiceLogger,
} from './types.js';

const FEATURE = 'dictionary_generation' as const;
const HANGUL = /[가-힣]/;
const URL_PATTERN = /(?:https?:\/\/|www\.)/i;
const MARKDOWN_PATTERN = /(?:```|`|\*\*|__|^\s{0,3}#{1,6}\s|\[[^\]]+\]\([^)]*\))/m;
const HTML_PATTERN = /<\/?[A-Za-z][^>]*>/;

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

// Models routinely add a trailing sentence-ending mark to a short gloss (e.g. "의사소통." instead
// of "의사소통") despite the system prompt asking for word-level meanings only — cosmetic, not
// unsafe, so it's normalized away rather than rejecting an otherwise-valid translation outright.
const TRAILING_SENTENCE_PUNCTUATION = /[.!?。!?]+\s*$/;

const koreanTranslationItem = z
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
      .refine(
        (value) =>
          !URL_PATTERN.test(value) && !MARKDOWN_PATTERN.test(value) && !HTML_PATTERN.test(value),
      )
      .refine((value) => !containsControlCharacter(value)),
  );

const safeShortText = (max: number) =>
  z
    .string()
    .transform((value) => value.normalize('NFKC').trim())
    .pipe(
      z
        .string()
        .min(1)
        .max(max)
        .refine((value) => !containsUnsafeText(value))
        .refine((value) => !URL_PATTERN.test(value) && !MARKDOWN_PATTERN.test(value)),
    );

const meaningSchema = z
  .object({
    partOfSpeech: safeShortText(40),
    koreanTranslations: z.array(koreanTranslationItem).min(1).max(5),
    definition: safeShortText(300),
    example: safeShortText(200),
  })
  .strict();

/**
 * Validates one Mindlogic structured-output response for a single dictionary word. Deliberately
 * strict: an empty koreanTranslations array, a missing/extra field, or any unsafe text anywhere
 * fails the whole lookup rather than being silently trimmed down to a partial "success" — there
 * is no English-only fallback path any more (see DictionaryService.lookup).
 */
export const dictionaryLookupAiResponseSchema = z
  .object({
    word: safeShortText(60),
    // '' means "the model was not confident" (see SYSTEM_PROMPT below) — normalized to null by
    // the transform. Kept as a plain string (not a nullable JSON Schema type) because structured
    // -output "strict" mode support for nullable field types on this gateway is unverified.
    pronunciation: z
      .string()
      .max(240)
      .transform((value) => value.normalize('NFKC').trim()),
    meanings: z.array(meaningSchema).min(1).max(3),
  })
  .strict()
  .transform((data) => ({
    word: data.word,
    pronunciation:
      data.pronunciation.length > 0 && !containsUnsafeText(data.pronunciation)
        ? data.pronunciation
        : null,
    meanings: data.meanings.map((meaning) => ({
      ...meaning,
      koreanTranslations: meaning.koreanTranslations.filter(
        (value, index, values) => values.indexOf(value) === index,
      ),
    })),
    koreanTranslations: data.meanings
      .flatMap((meaning) => meaning.koreanTranslations)
      .filter((value, index, values) => values.indexOf(value) === index),
  }))
  .refine((data) => data.koreanTranslations.length > 0);

export const DICTIONARY_LOOKUP_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'dictionary_lookup',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['word', 'pronunciation', 'meanings'],
      properties: {
        word: { type: 'string', minLength: 1, maxLength: 60 },
        pronunciation: { type: 'string', maxLength: 240 },
        meanings: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['partOfSpeech', 'koreanTranslations', 'definition', 'example'],
            properties: {
              partOfSpeech: { type: 'string', minLength: 1, maxLength: 40 },
              koreanTranslations: {
                type: 'array',
                minItems: 1,
                maxItems: 5,
                items: { type: 'string', minLength: 1, maxLength: 30 },
              },
              definition: { type: 'string', minLength: 1, maxLength: 300 },
              example: { type: 'string', minLength: 1, maxLength: 200 },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT =
  '주어진 영어 단어에 대해 한국어 학습자를 위한 사전 항목을 요청된 JSON 스키마로만 생성한다. ' +
  '오래되었거나 드물게 쓰이는 뜻보다 현재 일반적으로 통용되는 뜻을 최우선으로 삼는다 ' +
  '(예: "robot"은 중세 유럽의 강제 노동이 아니라 기계 로봇을 첫 번째 의미로 다룬다). ' +
  '각 의미(meanings)는 실제 품사(partOfSpeech), 영어로 된 명확한 정의(definition), ' +
  '그 단어를 사용한 짧고 자연스러운 영어 예문(example)을 포함하며 최대 3개까지 담는다. ' +
  '발음(pronunciation)은 국제음성기호(IPA)를 정확히 아는 경우에만 적고, 확신할 수 없으면 빈 문자열로 남긴다. ' +
  '각 meaning의 koreanTranslations에는 바로 그 영어 정의에 대응하는 짧은 한국어 뜻만 1개 이상 5개 이하로 담고, 다른 meaning의 뜻을 섞지 않는다. ' +
  '요청된 JSON 스키마 이외의 텍스트, 설명, 머리말, 마크다운은 절대 포함하지 않는다.';

export function buildDictionaryLookupMessages(word: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ word }) },
  ];
}

export function createSenseId(
  word: string,
  meaning: Pick<DictionaryMeaning, 'partOfSpeech' | 'definition' | 'example'>,
): string {
  return createHash('sha256')
    .update(JSON.stringify([word, meaning.partOfSpeech, meaning.definition, meaning.example]))
    .digest('hex');
}

/** One failed Zod check, reduced to only its field path and issue code — never `message` or any
 * received value, since either could echo the model's actual generated text. */
export interface DictionaryLookupZodIssue {
  path: string;
  code: string;
}

const MAX_ZOD_ISSUES_CAPTURED = 10;

function summarizeZodIssues(error: z.ZodError): DictionaryLookupZodIssue[] {
  return error.issues.slice(0, MAX_ZOD_ISSUES_CAPTURED).map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
  }));
}

export interface DictionaryAiLookupDeps {
  creditService: CreditService;
  mindlogicClient: MindlogicClient;
  now?: () => Date;
  generateRequestId?: () => string;
  logger?: DictionaryServiceLogger;
}

/**
 * Single Mindlogic call that replaces the old FreeDictionaryAPI(+dictionaryapi.dev fallback) +
 * separate Korean-translation call: one structured-output request returns pronunciation,
 * koreanTranslations, and up to three meanings (partOfSpeech + definition + example) together.
 * Throws DictionaryError on any failure — there is no partial/English-only success path.
 */
export class DictionaryAiLookup {
  constructor(private readonly deps: DictionaryAiLookupDeps) {}

  async fetchEntry(word: string, now: Date): Promise<DictionaryEntry> {
    const { model, maxOutputTokens } = getFeatureModelConfig(FEATURE);
    const messages = buildDictionaryLookupMessages(word);
    const inputTokens = estimateChatRequestInputTokens({
      messages,
      responseFormatSchema: DICTIONARY_LOOKUP_RESPONSE_FORMAT,
    });
    const requestId = this.deps.generateRequestId?.() ?? randomUUID();
    const reservation = await this.deps.creditService.reserveCredits({
      requestId,
      feature: FEATURE,
      model,
      inputTokens,
      outputTokens: maxOutputTokens,
      now: this.deps.now?.() ?? now,
    });
    if (!reservation.ok) {
      this.deps.logger?.warn(
        { feature: FEATURE, outcome: 'reservation_rejected', reason: reservation.reason, model },
        'dictionary lookup failed',
      );
      throw reservation.reason === 'limit_exceeded'
        ? new DictionaryError('DICTIONARY_CREDIT_LIMIT', 402)
        : new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
    }
    const reserved = reservation.record.creditsReserved;
    let completion;
    try {
      completion = await this.deps.mindlogicClient.createChatCompletion({
        model,
        messages,
        max_tokens: maxOutputTokens,
        response_format: DICTIONARY_LOOKUP_RESPONSE_FORMAT,
        stream: false,
      });
    } catch (error) {
      if (error instanceof MindlogicApiError) {
        let settlement: string;
        if (UNCERTAIN_BILLING_ERROR_CODES.includes(error.code)) {
          await this.deps.creditService.markReconciliationPending(requestId, error.code);
          settlement = 'reconciliation_pending';
        } else if (
          RECEIVED_RESPONSE_ERROR_CODES.includes(error.code) ||
          CERTAIN_NOT_SENT_ERROR_CODES.includes(error.code)
        ) {
          await this.deps.creditService.releaseCredits(requestId, error.code);
          settlement = 'released';
        } else {
          await this.deps.creditService.releaseCredits(requestId, 'unknown_error');
          settlement = 'released_unknown_error';
        }
        this.deps.logger?.warn(
          {
            feature: FEATURE,
            outcome: 'upstream_failed',
            upstreamCode: error.code,
            upstreamStatus: error.status,
            settlement,
            model,
          },
          'dictionary lookup failed',
        );
        throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
      }
      await this.deps.creditService.releaseCredits(requestId, 'pre_provider_failure');
      this.deps.logger?.warn(
        {
          feature: FEATURE,
          outcome: 'pre_provider_failure',
          errorType: error instanceof Error ? error.name : 'unknown',
          model,
        },
        'dictionary lookup failed',
      );
      throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
    }
    const usage = completion.usage;
    const actual = usage
      ? calculateCredits(model, usage.prompt_tokens, usage.completion_tokens)
      : reserved;
    await this.deps.creditService.commitCredits(requestId, Math.min(actual, reserved));
    if (actual > reserved) {
      this.deps.logger?.warn(
        { feature: FEATURE, outcome: 'reservation_exceeded', model, reserved, actual },
        'dictionary lookup failed',
      );
      throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(completion.choices[0]?.message.content ?? '');
    } catch {
      this.deps.logger?.warn(
        {
          feature: FEATURE,
          outcome: 'invalid_json',
          model,
          // Whether max_tokens was actually hit — a truncated response is the most likely reason
          // JSON.parse fails, distinct from the model returning malformed JSON outright.
          finishReason: completion.choices[0]?.finish_reason ?? null,
          completionTokens: usage?.completion_tokens ?? null,
        },
        'dictionary lookup failed',
      );
      throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502);
    }
    const result = dictionaryLookupAiResponseSchema.safeParse(parsed);
    if (!result.success) {
      this.deps.logger?.warn(
        {
          feature: FEATURE,
          outcome: 'schema_invalid',
          model,
          issues: summarizeZodIssues(result.error),
        },
        'dictionary lookup failed',
      );
      throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502);
    }
    const meanings: DictionaryMeaning[] = result.data.meanings.map((meaning) => ({
      senseId: createSenseId(word, meaning),
      ...meaning,
    }));
    const fetchedAt = now;
    return {
      query: word,
      normalizedWord: word,
      pronunciation: result.data.pronunciation,
      koreanTranslations: result.data.koreanTranslations,
      meanings,
      fetchedAt,
      // Word meanings don't drift day to day the way a fetched news article does, so this cache
      // is effectively permanent rather than on the old provider's 30-day TTL — re-generating on
      // a schedule would only re-spend credits for the same answer. ~10 years, not literally
      // forever, so a row can still be refreshed (e.g. after a prompt/model change bumps
      // AI_DICTIONARY_CACHE_SCHEMA_VERSION) without a background expiry job.
      expiresAt: new Date(fetchedAt.getTime() + 3650 * 24 * 60 * 60 * 1000),
      cacheSchemaVersion: AI_DICTIONARY_CACHE_SCHEMA_VERSION,
    };
  }
}
