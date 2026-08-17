import { describe, expect, it } from 'vitest';
import { estimateTokens } from './token-estimate.js';

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('rounds up to a whole token for a short string', () => {
    // 3 bytes / 3 bytes-per-token = 1, already whole.
    expect(estimateTokens('abc')).toBe(1);
    // 1 byte should still round up to a full token, never 0 for non-empty input.
    expect(estimateTokens('a')).toBe(1);
  });

  it('scales with UTF-8 byte length, not character count', () => {
    // Multi-byte characters (e.g. Korean) should count more bytes than
    // an equivalent-length ASCII string — the estimate must reflect that.
    const ascii = 'a'.repeat(30);
    const korean = '가'.repeat(30); // 3 bytes each in UTF-8

    expect(estimateTokens(korean)).toBeGreaterThan(estimateTokens(ascii));
  });

  it('never under-estimates relative to a naive 4-chars-per-token heuristic for plain English text', () => {
    const sample =
      'This reflection discusses how Korean cultural exports have reshaped global entertainment.';
    const naiveEstimate = Math.ceil(sample.length / 4);

    expect(estimateTokens(sample)).toBeGreaterThanOrEqual(naiveEstimate);
  });
});
