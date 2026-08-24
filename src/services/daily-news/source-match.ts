import { validateSourceUrl } from './source-url.js';

/**
 * A single, provider-supplied `{title, url}` pair from the Perplexity `search_results`
 * extension (see MindlogicClient's ChatCompletionResponse — "informative metadata", now load
 * -bearing here). Deliberately never constructed from anything the model wrote itself: the
 * model's own JSON output (title/sourceName/sourceUrl) is free-text generation and must never
 * be trusted as evidence of what the provider actually retrieved.
 */
export interface SearchResultCandidate {
  title: string;
  url: string;
}

/** Parses the raw `search_results` field into typed {title, url} pairs, dropping anything that
 * isn't a well-formed entry (missing/non-string title or url). Never throws. */
export function extractSearchResultCandidates(searchResults: unknown): SearchResultCandidate[] {
  if (!Array.isArray(searchResults)) return [];
  const candidates: SearchResultCandidate[] = [];
  for (const entry of searchResults) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.title !== 'string' || typeof record.url !== 'string') continue;
    if (record.title.trim().length === 0) continue;
    candidates.push({ title: record.title, url: record.url });
  }
  return candidates;
}

/**
 * Finds the ONE search_results entry whose `url` is both allowlisted and exactly equal to the
 * model's declared `sourceUrl` — i.e. a URL the provider itself actually returned as a search
 * result, from the same {title, url} object (never a title from one entry paired with a url
 * from another). Returns null if no such entry exists; the caller must never fall back to
 * picking an arbitrary allowlisted citation instead.
 */
export function findMatchingSearchResult(
  candidates: SearchResultCandidate[],
  declaredSourceUrl: URL,
): SearchResultCandidate | null {
  for (const candidate of candidates) {
    const url = validateSourceUrl(candidate.url);
    if (url && url.href === declaredSourceUrl.href) return candidate;
  }
  return null;
}

// General English function words only — deliberately excludes any topic/domain-specific term,
// so a real distinguishing word (a company name, "hearing", "robotaxis", ...) is never filtered
// out just because it happens to be short-ish or common-sounding within one story.
const STOPWORDS = new Set([
  'about',
  'after',
  'amid',
  'among',
  'and',
  'are',
  'been',
  'before',
  'being',
  'between',
  'but',
  'could',
  'does',
  'during',
  'each',
  'from',
  'have',
  'having',
  'here',
  'into',
  'itself',
  'more',
  'most',
  'only',
  'other',
  'over',
  'said',
  'says',
  'shall',
  'should',
  'since',
  'some',
  'than',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'under',
  'unto',
  'upon',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'will',
  'with',
  'would',
]);

function significantKeywords(title: string): string[] {
  const tokens = title
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}.]+/u)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
  return [...new Set(tokens)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a search_results entry's real title is actually about the same story as the
 * generated article — not merely from the same outlet/domain. Requires at least one
 * significant (non-stopword, length >= 4) keyword from the candidate title to appear as a
 * whole word somewhere in the article's own title/summary/content.
 *
 * This is the check that stops a same-domain-but-wrong-story source (e.g. a hearing-aid
 * article citing a robotaxi URL from the same outlet, which happened in production on
 * 2026-08-24): matching hostname and even matching URL-in-search-results is not sufficient by
 * itself, since a provider's search_results for one generation call can legitimately include
 * multiple unrelated stories it looked at along the way. A heuristic word-overlap check can
 * have false negatives (rejecting a genuinely correlated pair whose title phrasing barely
 * overlaps) but deliberately can never have false positives that let an unrelated story
 * through — failing closed here only ever costs a retried generation, never a wrong Source
 * link shown to a learner.
 */
export function titleCorrelatesWithArticle(
  candidateTitle: string,
  article: { title: string; summary: string; content: string },
): boolean {
  const keywords = significantKeywords(candidateTitle);
  if (keywords.length === 0) return false;
  const haystack = `${article.title} ${article.summary} ${article.content}`
    .normalize('NFKC')
    .toLowerCase();
  return keywords.some((keyword) =>
    new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(keyword)}(?:[^\\p{L}\\p{N}]|$)`, 'u').test(
      haystack,
    ),
  );
}
