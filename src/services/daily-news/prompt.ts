import type { DailyNewsTopic } from './weekday-topics.js';
import { DAILY_NEWS_SOURCE_ALLOWLIST } from './source-url.js';

/**
 * Readable form of source-url.ts's allowlist, for the model prompt below.
 * Kept derived from the same constant (rather than a hand-copied list) so
 * the prompt can never silently drift from what validateSourceUrl actually
 * accepts — a mismatch here means every generation gets rejected as
 * upstream_schema_error even though the model returned a real citation.
 */
const ALLOWED_SOURCE_HOSTS = DAILY_NEWS_SOURCE_ALLOWLIST.filter(
  (entry) => !entry.startsWith('www.'),
).join(', ');

export const DAILY_NEWS_SYSTEM_PROMPT = `You create an original English-learning article from current web-search facts.
Return only JSON matching the supplied schema, including a topic field that must exactly equal the required topic given in the user message. The required topic is fixed by the editorial calendar for this study date and is not a suggestion — select a story whose central subject is that exact required topic, never a story about a different topic or category, and never a story where the required topic is only a minor or secondary theme, preferably published within the last 72 hours. Avoid political persuasion, sensational crime, sexual violence, graphic violence, and disaster sensationalism. Do not copy long source passages. Clearly distinguish facts from interpretation. Never invent a number, person, quotation, date, publisher, or URL. The sourceUrl's hostname must exactly match one of these domains, or end with one of these suffixes: ${ALLOWED_SOURCE_HOSTS}. Never cite any other outlet — if none of these sources currently cover the required topic, search again until you find one that does, rather than using an outlet outside this list. The sourceUrl must be the exact HTTPS URL you actually used, and it must also appear in your search citations. Write the learning content in English. Provide exactly eight unique vocabulary words. Each vocabulary word must be copied verbatim, in the exact same spelling, inflection, and tense it already has in content — never a lemma, dictionary form, or a different inflection (e.g. if content says "innovating", the vocabulary word must be "innovating", not "innovate") — since it is checked by exact case-insensitive whole-word string match against content, not by meaning. Do not output HTML.`;

export function buildDailyNewsUserMessage(studyDate: string, topic: DailyNewsTopic): string {
  return `Study date in Asia/Seoul: ${studyDate}. Required topic — search for and write about exactly this topic, and no other topic or category: "${topic}". Find one recent, real news story whose central subject is that required topic, then set the JSON topic field to that same value. Create the learning article from that story. Do not include studyDate or generatedAt in the JSON.`;
}
