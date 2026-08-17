import { describe, expect, it } from 'vitest';
import { getBillingMonth, getNextResetDate } from './billing-period.js';

describe('getBillingMonth', () => {
  it('reads the calendar month in Asia/Seoul, not the local server timezone', () => {
    // 2026-01-31T16:30:00Z is 2026-02-01 01:30 in Asia/Seoul (UTC+9) —
    // a UTC-naive implementation would report January.
    const date = new Date('2026-01-31T16:30:00.000Z');
    expect(getBillingMonth(date)).toBe('2026-02');
  });

  it('stays in the previous month just before the Seoul day boundary', () => {
    // 2026-01-31T14:59:00Z is 2026-01-31 23:59 in Asia/Seoul.
    const date = new Date('2026-01-31T14:59:00.000Z');
    expect(getBillingMonth(date)).toBe('2026-01');
  });
});

describe('getNextResetDate', () => {
  it('returns the first day of the following month', () => {
    const date = new Date('2026-08-17T03:00:00.000Z'); // 2026-08-17 12:00 KST
    expect(getNextResetDate(date)).toBe('2026-09-01');
  });

  it('rolls over the year at December', () => {
    const date = new Date('2026-12-15T03:00:00.000Z'); // 2026-12-15 12:00 KST
    expect(getNextResetDate(date)).toBe('2027-01-01');
  });
});
