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
    example: z.string(),
  })
  .strict();

export const dictionaryLookupResponseSchema = z
  .object({
    query: z.string(),
    normalizedWord: z.string(),
    pronunciation: z.string().nullable(),
    koreanTranslations: z.array(z.string()).min(1),
    meanings: z.array(lookupMeaningSchema).min(1).max(3),
    cached: z.boolean(),
    stale: z.boolean(),
  })
  .strict();
