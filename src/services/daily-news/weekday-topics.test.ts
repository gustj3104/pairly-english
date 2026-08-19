import { afterEach, describe, expect, it } from 'vitest';
import { topicForStudyDate } from './weekday-topics.js';

describe('topicForStudyDate — fixed weekday topics', () => {
  it('Monday → Technology', () => expect(topicForStudyDate('2026-08-17')).toBe('Technology'));
  it('Tuesday → Business & Economy', () =>
    expect(topicForStudyDate('2026-08-18')).toBe('Business & Economy'));
  it('Wednesday → Science', () => expect(topicForStudyDate('2026-08-19')).toBe('Science'));
  it('Thursday → Environment', () => expect(topicForStudyDate('2026-08-20')).toBe('Environment'));
  it('Friday → Culture & Entertainment', () =>
    expect(topicForStudyDate('2026-08-21')).toBe('Culture & Entertainment'));
  it('Saturday → Lifestyle & Health', () =>
    expect(topicForStudyDate('2026-08-22')).toBe('Lifestyle & Health'));
  it('Sunday → World & Society', () =>
    expect(topicForStudyDate('2026-08-23')).toBe('World & Society'));
});

describe('topicForStudyDate — boundary dates', () => {
  it('leap year date (2024-02-29, a Thursday)', () =>
    expect(topicForStudyDate('2024-02-29')).toBe('Environment'));
  it('non-leap-year Feb 28 (2023-02-28, a Tuesday)', () =>
    expect(topicForStudyDate('2023-02-28')).toBe('Business & Economy'));
  it('month boundary: Jan 31 → Feb 1 (2026, Sat → Sun)', () => {
    expect(topicForStudyDate('2026-01-31')).toBe('Lifestyle & Health');
    expect(topicForStudyDate('2026-02-01')).toBe('World & Society');
  });
  it('year boundary: Dec 31 → Jan 1 (2025-12-31 Wed → 2026-01-01 Thu)', () => {
    expect(topicForStudyDate('2025-12-31')).toBe('Science');
    expect(topicForStudyDate('2026-01-01')).toBe('Environment');
  });
  it('Sunday → Monday boundary (2026-08-23 Sun → 2026-08-24 Mon)', () => {
    expect(topicForStudyDate('2026-08-23')).toBe('World & Society');
    expect(topicForStudyDate('2026-08-24')).toBe('Technology');
  });
});

describe('topicForStudyDate — timezone independence', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('returns the same topic for the same studyDate under every host TZ', () => {
    const zones = ['UTC', 'Pacific/Kiritimati', 'Etc/GMT+12', 'America/Los_Angeles', 'Asia/Seoul'];
    const dates = ['2026-08-17', '2026-08-23', '2024-02-29', '2026-01-01', '2025-12-31'];
    for (const date of dates) {
      const results = zones.map((zone) => {
        process.env.TZ = zone;
        return topicForStudyDate(date);
      });
      expect(new Set(results).size).toBe(1);
    }
  });
});

describe('topicForStudyDate — invalid input fails closed', () => {
  it('throws instead of returning a fallback topic for a malformed date', () => {
    expect(() => topicForStudyDate('not-a-date')).toThrow();
    expect(() => topicForStudyDate('2026-08')).toThrow();
    expect(() => topicForStudyDate('')).toThrow();
  });
});
