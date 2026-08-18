import { DictionaryError } from './types.js';

export const PROVIDER_MAX_BODY_BYTES = 1024 * 1024;
export const PROVIDER_TIMEOUT_MS = 5000;

export type ProviderFetch = typeof fetch;
export type ProviderRole = 'primary' | 'secondary';

/** Streams the body with a hard byte cap, aborting the reader (never buffering) once exceeded. */
export async function readBoundedProviderBody(
  response: Response,
  provider: ProviderRole,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > PROVIDER_MAX_BODY_BYTES) {
    throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502, undefined, provider);
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > PROVIDER_MAX_BODY_BYTES) {
      await reader.cancel();
      throw new DictionaryError('DICTIONARY_INVALID_RESPONSE', 502, undefined, provider);
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

/**
 * Shared timeout/abort/redirect policy for both providers. Deliberately does not interpret the
 * response status — 404 means "not found" for one provider and is undocumented for the other
 * (see provider.ts / secondary-provider.ts), so each caller maps its own status semantics.
 */
export async function fetchProviderResponse(
  url: URL,
  fetchImpl: ProviderFetch,
  provider: ProviderRole,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted)
      throw new DictionaryError('DICTIONARY_TIMEOUT', 504, undefined, provider);
    throw new DictionaryError('DICTIONARY_UPSTREAM_ERROR', 503, undefined, provider);
  } finally {
    clearTimeout(timer);
  }
}
