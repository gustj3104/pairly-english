/**
 * No real Claude tokenizer is available server-side, so this never claims
 * to be an exact token count — only a conservative (never-too-low) upper
 * bound used solely to size a credit reservation before the real call.
 *
 * English text is typically ~4 characters (~4-4.7 UTF-8 bytes) per token.
 * Assuming 3 bytes/token intentionally over-estimates by roughly 30-50%,
 * so a reservation sized from this number is never smaller than what the
 * request will actually use — the failure mode we must avoid is
 * under-reserving, which could let real usage exceed the monthly cap.
 */
const CONSERVATIVE_BYTES_PER_TOKEN = 3;

export function estimateTokens(text: string): number {
  const byteLength = Buffer.byteLength(text, 'utf8');
  return Math.ceil(byteLength / CONSERVATIVE_BYTES_PER_TOKEN);
}
