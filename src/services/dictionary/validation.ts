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

// `translations` is deliberately absent: it is never requested from FreeDictionaryAPI (see
// provider.ts), so any such field the provider still sends is safely stripped by Zod's default
// (non-strict) object parsing rather than validated here.
const senseSchema = z.object({
  definition: boundedSafeString(2000),
  examples: z.array(boundedSafeString(1000)).max(50).optional().default([]),
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

export function validateHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** creativecommons.org is the only license-URL host this app ever displays as "the license". */
export function validateCreativeCommonsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'creativecommons.org';
  } catch {
    return false;
  }
}

// Recognizes the Creative Commons license family names actually used by the dictionary
// providers this app calls (FreeDictionaryAPI: "CC BY-SA 4.0"; dictionaryapi.dev: "CC BY-SA
// 3.0") plus nearby variants, without pinning to one exact version — but rejects anything that
// isn't a real CC license name (an attacker-controlled string, "All rights reserved", HTML,
// etc.), so a malformed/misleading license can never reach canonical attribution.
const CC_LICENSE_NAME_PATTERN = /^CC (BY|BY-SA|BY-NC|BY-NC-SA|BY-ND|BY-NC-ND|0)(\s\d+\.\d+)?$/;

export function validateCreativeCommonsLicenseName(value: string): boolean {
  return CC_LICENSE_NAME_PATTERN.test(value);
}

const secondaryDefinitionSchema = z.object({
  definition: boundedSafeString(2000),
  example: boundedSafeString(1000).optional(),
});

const secondaryMeaningSchema = z.object({
  partOfSpeech: boundedSafeString(80),
  definitions: z.array(secondaryDefinitionSchema).max(500),
});

const secondaryPhoneticSchema = z.object({
  text: boundedSafeString(240).optional(),
  audio: z.string().max(2048).optional(),
});

const secondaryLicenseSchema = z.object({
  name: boundedSafeString(80).refine(validateCreativeCommonsLicenseName),
  url: z.string().url().refine(validateCreativeCommonsUrl),
});

const secondaryEntrySchema = z.object({
  word: z.string().min(1).max(100),
  phonetic: boundedSafeString(240).optional(),
  phonetics: z.array(secondaryPhoneticSchema).max(50).optional().default([]),
  meanings: z.array(secondaryMeaningSchema).max(500),
  license: secondaryLicenseSchema,
  sourceUrls: z.array(z.string().url()).min(1).max(20),
});

export const secondaryProviderResponseSchema = z.array(secondaryEntrySchema).max(500);

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
    // Dynamic (not literals): the secondary provider (dictionaryapi.dev) reports its own real
    // provider name/license — see DictionaryAttribution in types.ts. Values are always ones this
    // service already validated when parsing the raw provider response (see provider.ts /
    // secondary-provider.ts); these checks are defense in depth, not the primary gate.
    source: z
      .object({
        provider: boundedSafeString(80),
        name: boundedSafeString(80),
        license: boundedSafeString(80),
        licenseUrl: z.string().url().refine(validateHttpsUrl),
        url: z.string().url().refine(validateHttpsUrl),
      })
      .strict(),
    cached: z.boolean(),
    stale: z.boolean(),
  })
  .strict();
