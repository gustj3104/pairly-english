import { describe, expect, it } from 'vitest';
import {
  dailyNewsModelResponseSchema,
  generatedDailyNewsSchema,
  stripCitationMarkers,
} from './schema.js';

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
  it('strips unresolved citation-index markers like [5]/[10] from title, summary, and content', () => {
    const value = valid();
    value.title = `${value.title} [5]`;
    value.summary = `${value.summary}[3, 5]`;
    value.content = value.content.replace('learners', 'learners[10] a');
    const result = dailyNewsModelResponseSchema.safeParse({ ...value, topic: 'Science' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).not.toMatch(/\[\d/);
      expect(result.data.summary).not.toMatch(/\[\d/);
      expect(result.data.content).not.toMatch(/\[\d/);
    }
  });
});

describe('stripCitationMarkers', () => {
  it('removes a single bracketed citation index', () => {
    expect(stripCitationMarkers('a story about aid[5] and more')).toBe(
      'a story about aid and more',
    );
  });
  it('removes a comma-separated group and adjacent brackets', () => {
    expect(stripCitationMarkers('the market position[3, 5] by offering[8][10] devices.')).toBe(
      'the market position by offering devices.',
    );
  });
  it('removes a trailing marker before end-of-sentence punctuation without leaving a stray space', () => {
    expect(stripCitationMarkers('devices are becoming smarter [12].')).toBe(
      'devices are becoming smarter.',
    );
  });
  it('never removes a non-numeric bracketed annotation like [sic]', () => {
    expect(stripCitationMarkers('a quoted phrase [sic] stays intact')).toBe(
      'a quoted phrase [sic] stays intact',
    );
  });
});
