import { createHash } from 'node:crypto';
import {
  DICTIONARY_SOURCE,
  DictionaryError,
  type DictionaryEntry,
  type DictionaryMeaning,
} from './types.js';
import { providerResponseSchema, validateWiktionaryUrl } from './validation.js';
import {
  fetchProviderResponse,
  readBoundedProviderBody,
  type ProviderFetch,
} from './provider-http.js';

const PROVIDER_ORIGIN = 'https://freedictionaryapi.com';
export const CURRENT_DICTIONARY_CACHE_SCHEMA_VERSION = 2;
export const TRANSLATED_DICTIONARY_CACHE_SCHEMA_VERSION = 3;

export type DictionaryFetch = ProviderFetch;

export function createSenseId(
  word: string,
  meaning: Pick<DictionaryMeaning, 'partOfSpeech' | 'definition' | 'example'>,
): string {
  return createHash('sha256')
    .update(JSON.stringify([word, meaning.partOfSpeech, meaning.definition, meaning.example]))
    .digest('hex');
}

/** Primary English dictionary provider. See secondary-provider.ts for the fallback and
 * fallback.ts for the orchestration between the two. */
export async function fetchDictionaryEntry(
  word: string,
  fetchImpl: DictionaryFetch = fetch,
  now: () => Date = () => new Date(),
): Promise<DictionaryEntry> {
  // Deliberately no `translations` query param: FreeDictionaryAPI's translation payload can push
  // polysemous words (e.g. "life") over MAX_BODY_BYTES, and Korean word-level meanings come from
  // Mindlogic (see DictionaryService.lookup), not from this provider.
  const url = new URL(`/api/v1/entries/en/${encodeURIComponent(word)}`, PROVIDER_ORIGIN);
  const response = await fetchProviderResponse(url, fetchImpl, 'primary');
  if (response.status === 429) {
    throw new DictionaryError(
      'DICTIONARY_RATE_LIMITED',
      503,
      response.headers.get('retry-after') ?? undefined,
      'primary',
    );
  }
  if (!response.ok)
    throw new DictionaryError('DICTIONARY_UPSTREAM_ERROR', 503, undefined, 'primary');
  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedProviderBody(response, 'primary'));
  } catch (error) {
    if (error instanceof DictionaryError) throw error;
    throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502, undefined, 'primary');
  }
  const parsed = providerResponseSchema.safeParse(raw);
  if (!parsed.success || !validateWiktionaryUrl(parsed.data.source.url)) {
    throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502, undefined, 'primary');
  }
  // FreeDictionaryAPI's OpenAPI spec documents only a 200 response for this endpoint — no 404 for
  // "word not found" is documented. {200 OK, entries: []} is therefore our only unambiguous
  // not-found signal; any non-2xx status (including an undocumented 404) is bucketed as
  // DICTIONARY_UPSTREAM_ERROR above, which is deliberately fallback-eligible (see fallback.ts and
  // README) so an ambiguous provider failure never gets misreported as a false "not found".
  if (parsed.data.entries.length === 0)
    throw new DictionaryError('WORD_NOT_FOUND', 404, undefined, 'primary');

  const seen = new Set<string>();
  const meanings: DictionaryMeaning[] = [];
  for (const entry of parsed.data.entries) {
    for (const sense of entry.senses) {
      const definitionKey = sense.definition.trim().normalize('NFKC').toLowerCase();
      if (seen.has(definitionKey)) continue;
      seen.add(definitionKey);
      const core = {
        partOfSpeech: entry.partOfSpeech,
        definition: sense.definition,
        example: sense.examples[0] ?? null,
      };
      meanings.push({
        senseId: createSenseId(word, core),
        ...core,
        // Kept for lookup-response compatibility; FreeDictionaryAPI translations are never
        // requested, and AI-derived (Mindlogic) results are never copied down to this level.
        koreanTranslations: [],
      });
      if (meanings.length === 3) break;
    }
    if (meanings.length === 3) break;
  }
  if (meanings.length === 0)
    throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502, undefined, 'primary');
  const fetchedAt = now();
  return {
    query: word,
    normalizedWord: word,
    pronunciation: parsed.data.entries.flatMap((entry) => entry.pronunciations)[0]?.text ?? null,
    audioUrl: null,
    meanings,
    koreanTranslations: [],
    sourceUrl: parsed.data.source.url,
    attribution: { ...DICTIONARY_SOURCE },
    fetchedAt,
    expiresAt: new Date(fetchedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    cacheSchemaVersion: CURRENT_DICTIONARY_CACHE_SCHEMA_VERSION,
  };
}
