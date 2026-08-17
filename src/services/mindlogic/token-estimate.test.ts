import { describe, expect, it } from 'vitest';
import { estimateChatRequestInputTokens, estimateTokensUpperBound } from './token-estimate.js';

describe('estimateTokensUpperBound', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokensUpperBound('')).toBe(0);
  });

  it('returns exactly the UTF-8 byte length for ASCII text (no division)', () => {
    expect(estimateTokensUpperBound('abc')).toBe(3);
    expect(estimateTokensUpperBound('a')).toBe(1);
    expect(estimateTokensUpperBound('hello world')).toBe(11);
  });

  it('scales with UTF-8 byte length for multi-byte characters', () => {
    // Korean Hangul syllables are 3 bytes each in UTF-8.
    expect(estimateTokensUpperBound('가')).toBe(3);
    expect(estimateTokensUpperBound('가나다')).toBe(9);
  });

  it('counts 4-byte astral characters (many emoji) correctly, including surrogate pairs', () => {
    // 😀 is a single 4-byte UTF-8 character represented as a surrogate
    // pair (.length === 2) in JS strings — byte counting must not
    // under-count it as 1 or 2.
    expect(estimateTokensUpperBound('😀')).toBe(4);
    expect('😀'.length).toBe(2); // sanity check: UTF-16 code units, not bytes
  });

  it('never returns fewer bytes than a naive 4-bytes-per-token heuristic would assume for English text — it is a strictly higher, safer bound', () => {
    const sample =
      'This reflection discusses how Korean cultural exports have reshaped global entertainment.';
    const byteLength = Buffer.byteLength(sample, 'utf8');
    const naiveTokenGuess = Math.ceil(sample.length / 4);
    expect(estimateTokensUpperBound(sample)).toBe(byteLength);
    expect(byteLength).toBeGreaterThanOrEqual(naiveTokenGuess);
  });
});

describe('estimateChatRequestInputTokens', () => {
  it('sums message content bytes, schema bytes, per-message overhead, and the fixed buffer', () => {
    const systemContent = 'x'.repeat(100);
    const userContent = 'y'.repeat(200);
    const schema = { type: 'object', properties: { a: { type: 'string' } } };

    const result = estimateChatRequestInputTokens({
      messages: [{ content: systemContent }, { content: userContent }],
      responseFormatSchema: schema,
    });

    const expectedFloor = 100 + 200 + Buffer.byteLength(JSON.stringify(schema), 'utf8');
    expect(result).toBeGreaterThan(expectedFloor); // overhead + buffer are strictly additive
  });

  it('includes a minimum floor even for empty messages', () => {
    const result = estimateChatRequestInputTokens({ messages: [{ content: '' }] });
    expect(result).toBeGreaterThan(0);
  });

  it('increases when a response_format schema is included versus omitted', () => {
    const messages = [{ content: 'hello' }];
    const withoutSchema = estimateChatRequestInputTokens({ messages });
    const withSchema = estimateChatRequestInputTokens({
      messages,
      responseFormatSchema: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
      },
    });
    expect(withSchema).toBeGreaterThan(withoutSchema);
  });

  it('scales up for multilingual (Korean) and emoji-bearing content relative to equivalent-length ASCII', () => {
    const asciiMessages = [{ content: 'a'.repeat(50) }];
    const koreanMessages = [{ content: '가'.repeat(50) }];
    const emojiMessages = [{ content: '😀'.repeat(50) }];

    const asciiEstimate = estimateChatRequestInputTokens({ messages: asciiMessages });
    const koreanEstimate = estimateChatRequestInputTokens({ messages: koreanMessages });
    const emojiEstimate = estimateChatRequestInputTokens({ messages: emojiMessages });

    expect(koreanEstimate).toBeGreaterThan(asciiEstimate);
    expect(emojiEstimate).toBeGreaterThan(asciiEstimate);
  });
});
