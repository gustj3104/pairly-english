const SEOUL_TIME_ZONE = 'Asia/Seoul';

/**
 * Reads the calendar date in Asia/Seoul regardless of the server's own
 * timezone, so billing-month and reset-date boundaries are stable no
 * matter where this process is deployed.
 */
function getSeoulDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

/** Returns the current billing month as `YYYY-MM` in Asia/Seoul. */
export function getBillingMonth(date: Date = new Date()): string {
  const { year, month } = getSeoulDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Returns the date (`YYYY-MM-DD`) of the next monthly reset in Asia/Seoul. */
export function getNextResetDate(date: Date = new Date()): string {
  const { year, month } = getSeoulDateParts(date);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}
