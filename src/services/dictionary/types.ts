export const DICTIONARY_SOURCE = {
  provider: 'FreeDictionaryAPI.com' as const,
  name: 'Wiktionary' as const,
  license: 'CC BY-SA 4.0' as const,
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' as const,
};

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
  sourceUrl: string;
  fetchedAt: Date;
  expiresAt: Date;
  cacheSchemaVersion: number;
}

export interface DictionaryLookupResponse {
  query: string;
  normalizedWord: string;
  pronunciation: string | null;
  audioUrl: string | null;
  meanings: DictionaryMeaning[];
  source: typeof DICTIONARY_SOURCE & { url: string };
  cached: boolean;
  stale: boolean;
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
  ) {
    super(code);
  }
}
