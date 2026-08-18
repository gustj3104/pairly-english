import { z } from 'zod';

const WORD_PATTERN = /^[A-Za-z]+(?:['-][A-Za-z]+)*$/;
const HTML_PATTERN = /<\/?[A-Za-z][^>]*>/;

export function normalizeLookupWord(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().normalize('NFKC').toLowerCase();
  return value.length > 0 && value.length <= 60 && WORD_PATTERN.test(value) ? value : null;
}

export function containsUnsafeText(value: string): boolean {
  return (
    HTML_PATTERN.test(value) ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })
  );
}

const boundedSafeString = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !containsUnsafeText(value));

const senseSchema = z.object({
  definition: boundedSafeString(2000),
  examples: z.array(boundedSafeString(1000)).max(50).optional().default([]),
  translations: z
    .array(
      z.object({
        language: z.object({
          code: z.string().regex(/^[A-Za-z]{2,3}$/),
          name: boundedSafeString(80),
        }),
        word: z
          .string()
          .max(120)
          .refine((value) => !containsUnsafeText(value)),
      }),
    )
    .max(500)
    .optional()
    .default([]),
});

export const providerResponseSchema = z.object({
  word: z.string().min(1).max(100),
  entries: z
    .array(
      z.object({
        language: z.object({ code: z.string(), name: z.string() }).optional(),
        partOfSpeech: boundedSafeString(80),
        pronunciations: z
          .array(
            z.object({
              type: z.string().optional(),
              text: boundedSafeString(240),
              tags: z.array(z.string()).optional(),
            }),
          )
          .optional()
          .default([]),
        forms: z.array(z.unknown()).optional(),
        senses: z.array(senseSchema).max(500),
      }),
    )
    .max(500),
  source: z.object({
    url: z.string().url(),
    license: z.object({
      name: z.literal('CC BY-SA 4.0'),
      url: z.literal('https://creativecommons.org/licenses/by-sa/4.0/'),
    }),
  }),
});

export function validateWiktionaryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'en.wiktionary.org';
  } catch {
    return false;
  }
}

export const contextSentenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((value) => !containsUnsafeText(value));

const lookupMeaningSchema = z
  .object({
    senseId: z.string().regex(/^[a-f0-9]{64}$/),
    partOfSpeech: z.string(),
    definition: z.string(),
    example: z.string().nullable(),
    koreanTranslations: z.array(z.string()),
  })
  .strict();

export const dictionaryLookupResponseSchema = z
  .object({
    query: z.string(),
    normalizedWord: z.string(),
    koreanTranslations: z.array(z.string()),
    koreanTranslationStatus: z.enum(['available', 'unavailable']),
    pronunciation: z.string().nullable(),
    audioUrl: z.string().nullable(),
    meanings: z.array(lookupMeaningSchema),
    source: z
      .object({
        provider: z.literal('FreeDictionaryAPI.com'),
        name: z.literal('Wiktionary'),
        license: z.literal('CC BY-SA 4.0'),
        licenseUrl: z.literal('https://creativecommons.org/licenses/by-sa/4.0/'),
        url: z.string().url(),
      })
      .strict(),
    cached: z.boolean(),
    stale: z.boolean(),
  })
  .strict();
