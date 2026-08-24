import { describe, expect, it } from 'vitest';
import { mapRow } from './repository.js';
import type { dailyNewsArticles } from '../../db/schema.js';

const VOCAB_WORDS = [
  'advance',
  'climate',
  'energy',
  'research',
  'global',
  'project',
  'future',
  'benefit',
];

function row(
  overrides: Partial<typeof dailyNewsArticles.$inferSelect> = {},
): typeof dailyNewsArticles.$inferSelect {
  return {
    id: 'article-1',
    studyDate: '2026-08-19',
    title: 'Science news',
    sourceName: 'Reuters',
    sourceUrl: 'https://www.reuters.com/world/story',
    publishedAt: new Date('2026-08-17T10:00:00.000Z'),
    generatedAt: new Date('2026-08-18T03:00:00.000Z'),
    summary: 'Summary',
    content: VOCAB_WORDS.join(' '),
    vocabulary: VOCAB_WORDS.map((word) => ({ word, definition: word, example: word })),
    ...overrides,
  } as typeof dailyNewsArticles.$inferSelect;
}

describe('mapRow — sourceUrl re-validated on every read', () => {
  it('passes through a valid, allow-listed https source URL unchanged', () => {
    const article = mapRow(row());
    expect(article.sourceUrl).toBe('https://www.reuters.com/world/story');
  });

  it('serves null for a non-https URL, never the raw stored value', () => {
    const article = mapRow(row({ sourceUrl: 'http://www.reuters.com/world/story' }));
    expect(article.sourceUrl).toBeNull();
  });

  it('serves null for a relative path', () => {
    const article = mapRow(row({ sourceUrl: '/world/story' }));
    expect(article.sourceUrl).toBeNull();
  });

  it('serves null for a javascript: URL', () => {
    const article = mapRow(row({ sourceUrl: 'javascript:alert(1)' }));
    expect(article.sourceUrl).toBeNull();
  });

  it('serves null for an https URL on a host outside the allow-list', () => {
    const article = mapRow(row({ sourceUrl: 'https://not-a-real-news-source.example/story' }));
    expect(article.sourceUrl).toBeNull();
  });

  it('a null sourceUrl never affects any other field', () => {
    const article = mapRow(row({ sourceUrl: 'not a url at all' }));
    expect(article.title).toBe('Science news');
    expect(article.sourceName).toBe('Reuters');
    expect(article.content).toBe(VOCAB_WORDS.join(' '));
    expect(article.vocabulary).toHaveLength(8);
  });
});

describe('mapRow — legacy citation-index markers stripped on every read', () => {
  it('strips a stored [5]/[10]-style marker from title, summary, and content without a data migration', () => {
    const article = mapRow(
      row({
        title: 'Science news [5]',
        summary: 'Summary[3, 5]',
        content: `${VOCAB_WORDS.join(' ')}[10]`,
      }),
    );
    expect(article.title).toBe('Science news');
    expect(article.summary).toBe('Summary');
    expect(article.content).toBe(VOCAB_WORDS.join(' '));
  });
});
