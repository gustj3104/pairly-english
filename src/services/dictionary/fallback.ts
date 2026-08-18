import { DictionaryError, type DictionaryEntry, type DictionaryServiceLogger } from './types.js';
import { fetchDictionaryEntry, type DictionaryFetch } from './provider.js';
import { fetchSecondaryDictionaryEntry } from './secondary-provider.js';

/**
 * Tries the primary English dictionary provider (FreeDictionaryAPI) first; on any failure other
 * than an unambiguous word-not-found, tries the secondary provider (dictionaryapi.dev) once.
 * Never calls both concurrently, never retries a provider, and never waits longer than
 * PROVIDER_TIMEOUT_MS (5s) per provider — so at most ~10s total.
 *
 * Fallback-eligible: DICTIONARY_RATE_LIMITED, DICTIONARY_TIMEOUT, DICTIONARY_UPSTREAM_ERROR,
 * DICTIONARY_INVALID_RESPONSE (malformed JSON, oversized body, or strict schema validation
 * failure). Not fallback-eligible: WORD_NOT_FOUND — the one case primary can report with real
 * confidence (a 200 OK response with an empty entries array; see provider.ts for why every other
 * non-2xx status, including an undocumented 404, is bucketed as DICTIONARY_UPSTREAM_ERROR instead
 * and therefore *is* fallback-eligible — this deliberately favors reducing false "not found"
 * results over saving one extra call in an already-ambiguous failure).
 *
 * If both providers fail, the secondary provider's own DictionaryError propagates unchanged —
 * repository.ts's stale-cache fallback and routes/dictionary.ts's public-error mapping already
 * key off DictionaryError.code, so no caller needs to change for this to work.
 */
export async function fetchDictionaryEntryWithFallback(
  word: string,
  fetchImpl: DictionaryFetch = fetch,
  now: () => Date = () => new Date(),
  logger?: DictionaryServiceLogger,
): Promise<DictionaryEntry> {
  const primaryStartedAt = Date.now();
  try {
    return await fetchDictionaryEntry(word, fetchImpl, now);
  } catch (primaryError) {
    if (!(primaryError instanceof DictionaryError) || primaryError.code === 'WORD_NOT_FOUND') {
      throw primaryError;
    }
    const primaryLatencyMs = Date.now() - primaryStartedAt;
    try {
      const entry = await fetchSecondaryDictionaryEntry(word, fetchImpl, now);
      logger?.warn(
        fallbackLogFields(primaryError, primaryLatencyMs, true),
        'primary dictionary provider failed; secondary provider served the lookup',
      );
      return entry;
    } catch (secondaryError) {
      logger?.warn(
        fallbackLogFields(primaryError, primaryLatencyMs, false),
        'primary dictionary provider failed; secondary provider also failed',
      );
      throw secondaryError;
    }
  }
}

function fallbackLogFields(
  primaryError: DictionaryError,
  primaryLatencyMs: number,
  fallbackSucceeded: boolean,
): Record<string, unknown> {
  return {
    feature: 'dictionary_lookup',
    failureStage: 'primary_provider',
    provider: 'primary',
    errorCategory: primaryError.code,
    httpStatus: primaryError.statusCode,
    latencyMs: primaryLatencyMs,
    fallbackAttempted: true,
    fallbackSucceeded,
    cacheHit: false,
  };
}
