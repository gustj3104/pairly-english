const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for strings that are both `YYYY-MM-DD`-shaped AND a real
 * calendar date (rejects e.g. '2026-02-30'). Uses UTC throughout so the
 * check never depends on the host process's local timezone.
 */
export function isValidCalendarDateString(value: string): boolean {
  if (!DATE_FORMAT.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** "Today" in Asia/Seoul as 'YYYY-MM-DD' — string-comparable against the path param. */
export function seoulTodayString(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Adds (or subtracts, for a negative value) whole days to a 'YYYY-MM-DD' string, in UTC. */
function addDaysToDateString(dateString: string, days: number): string {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type StudyDateValidationResult =
  { ok: true } | { ok: false; reason: 'invalid_format' | 'too_far_in_future' };

/**
 * Validates a `:date` path param: must be a real YYYY-MM-DD calendar date,
 * and not more than `maxFutureDays` days ahead of "today" in Asia/Seoul.
 * No lower bound — arbitrarily old past dates are always valid for the
 * date format itself.
 */
export function validateStudyDate(
  value: string,
  maxFutureDays: number,
  now: Date,
): StudyDateValidationResult {
  if (!isValidCalendarDateString(value)) {
    return { ok: false, reason: 'invalid_format' };
  }
  const maxAllowedDate = addDaysToDateString(seoulTodayString(now), maxFutureDays);
  if (value > maxAllowedDate) {
    return { ok: false, reason: 'too_far_in_future' };
  }
  return { ok: true };
}
