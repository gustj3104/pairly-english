import { describe, expect, it } from 'vitest';
import { dailyNewsModelResponseSchema, generatedDailyNewsSchema } from './schema.js';

const words = [
  'advance',
  'climate',
  'energy',
  'research',
  'global',
  'project',
  'future',
  'benefit',
];
function valid() {
  return {
    title: 'A useful scientific advance',
    sourceName: 'Reuters',
    sourceUrl: 'https://www.reuters.com/world/example',
    publishedAt: '2026-08-17T10:00:00Z',
    summary: 'A concise original summary.',
    content: `An ${words.join(' ')} story gives learners a constructive topic for discussion.`,
    vocabulary: words.map((word) => ({
      word,
      definition: `Meaning of ${word}`,
      example: `${word} appears here.`,
    })),
  };
}

describe('generatedDailyNewsSchema', () => {
  it('accepts exactly eight unique words appearing in the content', () =>
    expect(generatedDailyNewsSchema.safeParse(valid()).success).toBe(true));
  it('rejects a missing vocabulary word', () => {
    const value = valid();
    value.vocabulary[0]!.word = 'absent';
    expect(generatedDailyNewsSchema.safeParse(value).success).toBe(false);
  });
  it('rejects duplicate words', () => {
    const value = valid();
    value.vocabulary[1]!.word = value.vocabulary[0]!.word;
    expect(generatedDailyNewsSchema.safeParse(value).success).toBe(false);
  });
  it('rejects extra fields and HTML', () =>
    expect(
      generatedDailyNewsSchema.safeParse({
        ...valid(),
        extra: true,
        content: '<script>alert(1)</script>',
      }).success,
    ).toBe(false));
  it('the public schema has no topic field, even if one is supplied', () =>
    expect(generatedDailyNewsSchema.safeParse({ ...valid(), topic: 'Science' }).success).toBe(
      false,
    ));
});

describe('dailyNewsModelResponseSchema', () => {
  it('accepts a valid response that declares one of the fixed topics', () =>
    expect(dailyNewsModelResponseSchema.safeParse({ ...valid(), topic: 'Science' }).success).toBe(
      true,
    ));
  it('rejects a topic string outside the fixed enum', () =>
    expect(dailyNewsModelResponseSchema.safeParse({ ...valid(), topic: 'Sports' }).success).toBe(
      false,
    ));
  it('rejects a response missing the topic field', () =>
    expect(dailyNewsModelResponseSchema.safeParse(valid()).success).toBe(false));
});
