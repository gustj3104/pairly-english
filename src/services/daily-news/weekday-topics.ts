/**
 * Single source of truth for the fixed weekday → topic mapping that
 * constrains daily-news generation. `topicForStudyDate` is the only way
 * callers should derive a topic — never hardcode the mapping elsewhere.
 */
export const DAILY_NEWS_TOPICS = [
  'Technology',
  'Business & Economy',
  'Science',
  'Environment',
  'Culture & Entertainment',
  'Lifestyle & Health',
  'World & Society',
] as const;

export type DailyNewsTopic = (typeof DAILY_NEWS_TOPICS)[number];

/**
 * Derives the weekday index (0=Sunday..6=Saturday, matching
 * Date#getUTCDay) for a `studyDate` ('YYYY-MM-DD') using Date.UTC on the
 * string's own year/month/day components. This depends only on the
 * calendar date itself — never on the host process's local timezone or
 * the current wall-clock time — so it returns the same weekday no matter
 * which TZ the server runs under or what time it is right now.
 */
function weekdayIndexForStudyDate(studyDate: string): number {
  const parts = studyDate.split('-').map(Number);
  const [year, month, day] = parts;
  if (parts.length !== 3 || year === undefined || month === undefined || day === undefined) {
    throw new Error(`weekdayIndexForStudyDate: invalid study date "${studyDate}"`);
  }
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Fixed topic for a `studyDate`. Assumes the caller has already validated
 * `studyDate` (e.g. via validateStudyDate at the route layer) — there is
 * deliberately no fallback topic for an unparseable date; an invalid
 * input throws instead of silently returning some default topic.
 */
export function topicForStudyDate(studyDate: string): DailyNewsTopic {
  const weekday = weekdayIndexForStudyDate(studyDate);
  switch (weekday) {
    case 1:
      return 'Technology'; // Monday
    case 2:
      return 'Business & Economy'; // Tuesday
    case 3:
      return 'Science'; // Wednesday
    case 4:
      return 'Environment'; // Thursday
    case 5:
      return 'Culture & Entertainment'; // Friday
    case 6:
      return 'Lifestyle & Health'; // Saturday
    case 0:
      return 'World & Society'; // Sunday
    default:
      throw new Error(`topicForStudyDate: invalid weekday index ${weekday} for "${studyDate}"`);
  }
}
