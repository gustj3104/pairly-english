import { describe, expect, it } from 'vitest';
import {
  extractSearchResultCandidates,
  findMatchingSearchResult,
  titleCorrelatesWithArticle,
} from './source-match.js';
import { validateSourceUrl } from './source-url.js';

// Exact regression fixture for the 2026-08-24 production incident: a Sonova AI-hearing-aid
// article was served with a Source link pointing at an unrelated Pony.ai/Uber robotaxi story.
// Both search results are real reuters.com URLs — the fix must reject based on story
// correlation, never merely because the hostnames differ.
const sonovaArticle = {
  title: 'AI-powered hearing aids show how everyday health devices are becoming smarter',
  summary:
    'Swiss hearing-aid maker Sonova has launched its third hearing-aid platform using real-time artificial intelligence, aiming to strengthen its market position by offering smarter, more responsive devices.',
  content:
    'Sonova unveiled advanced hearing devices research showing global demand for smarter health platform technology continues rising steadily worldwide.',
};
const sonovaSearchResult = {
  title: 'Sonova launches AI-powered hearing aids',
  url: 'https://www.reuters.com/technology/sonova-ai-hearing-aids-2026-08-14/',
};
const ponyaiSearchResult = {
  title: 'Pony.ai and Uber deploy robotaxis in Europe',
  url: 'https://www.reuters.com/technology/chinas-ponyai-uber-jointly-deploy-over-2000-robotaxis-europe-2026-08-14/',
};

describe('titleCorrelatesWithArticle', () => {
  it('accepts: Sonova body + Sonova search result title', () => {
    expect(titleCorrelatesWithArticle(sonovaSearchResult.title, sonovaArticle)).toBe(true);
  });

  it('rejects: Sonova body + Pony.ai/Uber search result title — same outlet is not enough', () => {
    expect(titleCorrelatesWithArticle(ponyaiSearchResult.title, sonovaArticle)).toBe(false);
  });

  it('never treats two results as the same story just because they share a hostname', () => {
    // Sanity check on the fixture itself: both URLs really are reuters.com, so a hostname-only
    // check would wrongly accept the Pony.ai/Uber case above.
    expect(new URL(sonovaSearchResult.url).hostname).toBe(new URL(ponyaiSearchResult.url).hostname);
  });
});

describe('extractSearchResultCandidates', () => {
  it('parses well-formed {title, url} entries and drops malformed ones', () => {
    expect(
      extractSearchResultCandidates([
        sonovaSearchResult,
        { title: 'no url' },
        { url: 'https://www.reuters.com/no-title' },
        { title: '', url: 'https://www.reuters.com/blank-title' },
        'not an object',
        null,
        ponyaiSearchResult,
      ]),
    ).toEqual([sonovaSearchResult, ponyaiSearchResult]);
  });

  it('returns an empty list for anything that is not an array', () => {
    expect(extractSearchResultCandidates(undefined)).toEqual([]);
    expect(extractSearchResultCandidates(null)).toEqual([]);
    expect(extractSearchResultCandidates('search_results')).toEqual([]);
  });
});

describe('findMatchingSearchResult', () => {
  const candidates = extractSearchResultCandidates([sonovaSearchResult, ponyaiSearchResult]);

  it('finds the exact {title, url} pair matching the declared source URL — never a different one', () => {
    const declared = validateSourceUrl(sonovaSearchResult.url)!;
    expect(findMatchingSearchResult(candidates, declared)).toEqual(sonovaSearchResult);
  });

  it('returns null when no candidate matches the declared source URL', () => {
    const declared = validateSourceUrl('https://www.reuters.com/technology/some-other-story/')!;
    expect(findMatchingSearchResult(candidates, declared)).toBeNull();
  });
});
