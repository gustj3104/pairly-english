import { createHash } from 'node:crypto';
import { DictionaryError, type DictionaryEntry, type DictionaryMeaning } from './types.js';
import { providerResponseSchema, validateWiktionaryUrl } from './validation.js';

const PROVIDER_ORIGIN = 'https://freedictionaryapi.com';
const MAX_BODY_BYTES = 1024 * 1024;
const TIMEOUT_MS = 5000;

export type DictionaryFetch = typeof fetch;

export function createSenseId(word: string, meaning: Omit<DictionaryMeaning, 'senseId'>): string {
  return createHash('sha256')
    .update(JSON.stringify([word, meaning.partOfSpeech, meaning.definition, meaning.example]))
    .digest('hex');
}

async function readBoundedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502);
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502);
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

export async function fetchDictionaryEntry(
  word: string,
  fetchImpl: DictionaryFetch = fetch,
  now: () => Date = () => new Date(),
): Promise<DictionaryEntry> {
  const url = new URL(`/api/v1/entries/en/${encodeURIComponent(word)}`, PROVIDER_ORIGIN);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) throw new DictionaryError('DICTIONARY_TIMEOUT', 504);
    throw new DictionaryError('DICTIONARY_UPSTREAM_ERROR', 503);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 429) {
    throw new DictionaryError(
      'DICTIONARY_RATE_LIMITED',
      503,
      response.headers.get('retry-after') ?? undefined,
    );
  }
  if (!response.ok) throw new DictionaryError('DICTIONARY_UPSTREAM_ERROR', 503);
  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedBody(response));
  } catch (error) {
    if (error instanceof DictionaryError) throw error;
    throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502);
  }
  const parsed = providerResponseSchema.safeParse(raw);
  if (!parsed.success || !validateWiktionaryUrl(parsed.data.source.url)) {
    throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502);
  }
  if (parsed.data.entries.length === 0) throw new DictionaryError('WORD_NOT_FOUND', 404);

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
      meanings.push({ senseId: createSenseId(word, core), ...core });
      if (meanings.length === 3) break;
    }
    if (meanings.length === 3) break;
  }
  if (meanings.length === 0) throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502);
  const fetchedAt = now();
  return {
    query: word,
    normalizedWord: word,
    pronunciation: parsed.data.entries.flatMap((entry) => entry.pronunciations)[0]?.text ?? null,
    audioUrl: null,
    meanings,
    sourceUrl: parsed.data.source.url,
    fetchedAt,
    expiresAt: new Date(fetchedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
  };
}
