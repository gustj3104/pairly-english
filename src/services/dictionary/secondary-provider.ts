import { DictionaryError, type DictionaryEntry, type DictionaryMeaning } from './types.js';
import { createSenseId, CURRENT_DICTIONARY_CACHE_SCHEMA_VERSION } from './provider.js';
import {
  secondaryProviderResponseSchema,
  validateHttpsUrl,
  validateWiktionaryUrl,
} from './validation.js';
import {
  fetchProviderResponse,
  readBoundedProviderBody,
  type ProviderFetch,
} from './provider-http.js';

const SECONDARY_PROVIDER_ORIGIN = 'https://api.dictionaryapi.dev';
const SECONDARY_ATTRIBUTION_PROVIDER = 'DictionaryAPI.dev';
const SECONDARY_ATTRIBUTION_NAME = 'Wiktionary';

export type SecondaryDictionaryFetch = ProviderFetch;

/**
 * Secondary (fallback-only) English dictionary provider, used when fetchDictionaryEntry
 * (primary, FreeDictionaryAPI) fails for any reason other than an unambiguous word-not-found —
 * see fallback.ts for the orchestration and README for the documented fallback conditions.
 *
 * Maps dictionaryapi.dev's response to the same canonical DictionaryEntry shape as the primary
 * provider. Attribution is taken from the provider's own reported license/source, never copied
 * from the primary provider's FreeDictionaryAPI/CC BY-SA 4.0 constant — dictionaryapi.dev's
 * actual license (confirmed CC BY-SA 3.0 for a live "emergency" lookup) differs from primary's.
 */
export async function fetchSecondaryDictionaryEntry(
  word: string,
  fetchImpl: SecondaryDictionaryFetch = fetch,
  now: () => Date = () => new Date(),
): Promise<DictionaryEntry> {
  const url = new URL(`/api/v2/entries/en/${encodeURIComponent(word)}`, SECONDARY_PROVIDER_ORIGIN);
  const response = await fetchProviderResponse(url, fetchImpl, 'secondary');
  // Unlike the primary provider, dictionaryapi.dev's well-known convention is a dedicated 404
  // ("No Definitions Found") for an unknown word — a real, unambiguous not-found signal.
  if (response.status === 404)
    throw new DictionaryError('WORD_NOT_FOUND', 404, undefined, 'secondary');
  if (response.status === 429) {
    throw new DictionaryError(
      'DICTIONARY_RATE_LIMITED',
      503,
      response.headers.get('retry-after') ?? undefined,
      'secondary',
    );
  }
  if (!response.ok) {
    throw new DictionaryError('DICTIONARY_UPSTREAM_ERROR', 503, undefined, 'secondary');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedProviderBody(response, 'secondary'));
  } catch (error) {
    if (error instanceof DictionaryError) throw error;
    throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502, undefined, 'secondary');
  }
  const parsed = secondaryProviderResponseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.length === 0) {
    throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502, undefined, 'secondary');
  }

  const normalizedWord = word.trim().normalize('NFKC').toLowerCase();
  const entries = parsed.data.filter(
    (entry) => entry.word.trim().normalize('NFKC').toLowerCase() === normalizedWord,
  );
  if (entries.length === 0) {
    throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502, undefined, 'secondary');
  }
  const first = entries[0]!;
  const sourceUrl = first.sourceUrls[0]!;
  if (!validateWiktionaryUrl(sourceUrl) || !validateHttpsUrl(first.license.url)) {
    throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502, undefined, 'secondary');
  }

  const seen = new Set<string>();
  const meanings: DictionaryMeaning[] = [];
  for (const entry of entries) {
    for (const meaning of entry.meanings) {
      const partOfSpeech = meaning.partOfSpeech.trim().normalize('NFKC');
      for (const definition of meaning.definitions) {
        const definitionText = definition.definition.trim().normalize('NFKC');
        const definitionKey = definitionText.toLowerCase();
        if (seen.has(definitionKey)) continue;
        seen.add(definitionKey);
        const core = {
          partOfSpeech,
          definition: definitionText,
          example: definition.example ? definition.example.trim().normalize('NFKC') : null,
        };
        meanings.push({
          senseId: createSenseId(word, core),
          ...core,
          // Word-level Korean meanings come from Mindlogic (DictionaryService.lookup), never
          // from either English provider.
          koreanTranslations: [],
        });
        if (meanings.length === 3) break;
      }
      if (meanings.length === 3) break;
    }
    if (meanings.length === 3) break;
  }
  if (meanings.length === 0)
    throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502, undefined, 'secondary');

  const audioUrl =
    first.phonetics.map((p) => p.audio).find((audio) => audio && validateHttpsUrl(audio)) ?? null;
  const pronunciation =
    (first.phonetic && first.phonetic.length > 0 ? first.phonetic : undefined) ??
    first.phonetics.find((p) => p.text && p.text.length > 0)?.text ??
    null;

  const fetchedAt = now();
  return {
    query: word,
    normalizedWord: word,
    pronunciation,
    audioUrl: audioUrl ?? null,
    meanings,
    koreanTranslations: [],
    sourceUrl,
    attribution: {
      provider: SECONDARY_ATTRIBUTION_PROVIDER,
      name: SECONDARY_ATTRIBUTION_NAME,
      license: first.license.name,
      licenseUrl: first.license.url,
    },
    fetchedAt,
    expiresAt: new Date(fetchedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    cacheSchemaVersion: CURRENT_DICTIONARY_CACHE_SCHEMA_VERSION,
  };
}
