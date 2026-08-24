import { describe, expect, it } from 'vitest';
import { AUTOMATIC_RETRY_COOLDOWN_MS, shouldSkipAutomaticRetry } from './repository.js';

describe('shouldSkipAutomaticRetry', () => {
  const now = new Date('2026-08-24T00:00:00.000Z');

  it('never skips a first attempt (no prior attempt recorded)', () => {
    expect(shouldSkipAutomaticRetry(null, now, undefined)).toBe(false);
  });

  it('skips an automatic retry that arrives before the cooldown elapses', () => {
    const lastAttempt = new Date(now.getTime() - AUTOMATIC_RETRY_COOLDOWN_MS / 2);
    expect(shouldSkipAutomaticRetry(lastAttempt, now, undefined)).toBe(true);
    expect(shouldSkipAutomaticRetry(lastAttempt, now, false)).toBe(true);
  });

  it('allows an automatic retry once the cooldown has fully elapsed', () => {
    const lastAttempt = new Date(now.getTime() - AUTOMATIC_RETRY_COOLDOWN_MS);
    expect(shouldSkipAutomaticRetry(lastAttempt, now, undefined)).toBe(false);
  });

  it('a forced (user-initiated) retry always bypasses the cooldown', () => {
    const justAttempted = new Date(now.getTime() - 1);
    expect(shouldSkipAutomaticRetry(justAttempted, now, true)).toBe(false);
  });
});
