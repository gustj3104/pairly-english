/**
 * Cache schema version written by a successful single-call Mindlogic AI lookup (see
 * ai-lookup.ts). Any stored row with a lower cacheSchemaVersion is pre-AI
 * (FreeDictionaryAPI/Wiktionary, versions 1-3) and is always treated as stale — regenerated via
 * AI on its next lookup rather than served, so a legacy row with an empty koreanTranslations
 * array (or a first-meaning problem like "robot" surfacing medieval serfdom before the machine)
 * gets replaced with a real AI result the next time anyone looks the word up.
 */
export const AI_DICTIONARY_CACHE_SCHEMA_VERSION = 5;

export interface DictionaryMeaning {
  senseId: string;
  partOfSpeech: string;
  koreanTranslations: string[];
  definition: string;
  example: string;
}

export interface DictionaryEntry {
  query: string;
  normalizedWord: string;
  pronunciation: string | null;
  koreanTranslations: string[];
  meanings: DictionaryMeaning[];
  fetchedAt: Date;
  expiresAt: Date;
  cacheSchemaVersion: number;
}

export interface DictionaryLookupResponse {
  query: string;
  normalizedWord: string;
  pronunciation: string | null;
  audioUrl: null;
  koreanTranslations: string[];
  koreanTranslationStatus: 'available';
  meanings: DictionaryMeaning[];
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
      // Mindlogic itself failed (network/timeout/rate-limited/5xx/reconciliation-pending) or a
      // regeneration attempt was skipped because it's within the automatic-retry cooldown (see
      // repository.ts's AUTOMATIC_RETRY_COOLDOWN_MS) — collapsed to one code because the client
      // response is identical either way: "try again", with a Retry action.
      | 'DICTIONARY_AI_UNAVAILABLE'
      // Mindlogic responded, but its JSON was unparsable or failed the structured-output schema
      // (see ai-lookup.ts's dictionaryLookupAiResponseSchema) — e.g. an empty koreanTranslations
      // array or a malformed structured JSON payload.
      | 'DICTIONARY_INVALID_RESPONSE'
      // The monthly Mindlogic credit cap is exhausted; no call was made.
      | 'DICTIONARY_CREDIT_LIMIT',
    public readonly statusCode: number,
  ) {
    super(code);
  }
}
