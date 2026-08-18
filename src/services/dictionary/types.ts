export const DICTIONARY_SOURCE = {
  provider: 'FreeDictionaryAPI.com' as const,
  name: 'Wiktionary' as const,
  license: 'CC BY-SA 4.0' as const,
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' as const,
};

/**
 * Which English dictionary provider actually produced a given entry, and under what license.
 * Dynamic (not a literal) because the secondary provider (dictionaryapi.dev) reports its own
 * real provider name/license, distinct from FreeDictionaryAPI's — see secondary-provider.ts.
 */
export interface DictionaryAttribution {
  provider: string;
  name: string;
  license: string;
  licenseUrl: string;
}

export interface DictionaryMeaning {
  senseId: string;
  partOfSpeech: string;
  definition: string;
  example: string | null;
  koreanTranslations: string[];
}

export interface DictionaryEntry {
  query: string;
  normalizedWord: string;
  pronunciation: string | null;
  audioUrl: string | null;
  meanings: DictionaryMeaning[];
  koreanTranslations: string[];
  sourceUrl: string;
  attribution: DictionaryAttribution;
  fetchedAt: Date;
  expiresAt: Date;
  cacheSchemaVersion: number;
}

export interface DictionaryLookupResponse {
  query: string;
  normalizedWord: string;
  koreanTranslations: string[];
  koreanTranslationStatus: 'available' | 'unavailable';
  pronunciation: string | null;
  audioUrl: string | null;
  meanings: DictionaryMeaning[];
  source: DictionaryAttribution & { url: string };
  cached: boolean;
  stale: boolean;
}

/** Minimal, Pino-shaped logging surface — never required, never given anything but safe fields. */
export interface DictionaryServiceLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export class DictionaryError extends Error {
  constructor(
    public readonly code:
      | 'WORD_NOT_FOUND'
      | 'DICTIONARY_RATE_LIMITED'
      | 'DICTIONARY_TIMEOUT'
      | 'DICTIONARY_UPSTREAM_ERROR'
      | 'DICTIONARY_INVALID_RESPONSE',
    public readonly statusCode: number,
    public readonly retryAfter?: string,
    // Which provider produced this error — safe to log (see routes/dictionary.ts), never exposed
    // to the client. Defaults to 'primary' since most call sites are the primary provider.
    public readonly provider: 'primary' | 'secondary' = 'primary',
  ) {
    super(code);
  }
}
