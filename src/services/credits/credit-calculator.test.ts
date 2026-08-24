import { describe, expect, it } from 'vitest';
import {
  calculateCredits,
  calculateUsagePercent,
  calculateWarningLevel,
} from './credit-calculator.js';

describe('calculateCredits', () => {
  it('computes input and output credits per thousand tokens and rounds up', () => {
    // 1500 input tokens * 1/1000 = 1.5, 500 output tokens * 5/1000 = 2.5 -> 4 -> ceil(4) = 4
    expect(calculateCredits('claude-haiku-4-5-20251001', 1500, 500)).toBe(4);
  });

  it('rounds up any fractional remainder conservatively', () => {
    // 100 input tokens -> 0.1 credits, 0 output -> ceil(0.1) = 1
    expect(calculateCredits('claude-haiku-4-5-20251001', 100, 0)).toBe(1);
  });

  it('returns 0 for a zero-token request', () => {
    expect(calculateCredits('claude-haiku-4-5-20251001', 0, 0)).toBe(0);
  });

  // gpt-5.6-luna's rate is the one entry in MODEL_CREDIT_RATES confirmed against Mindlogic's
  // own published docs (docs.mindlogic.ai/docs/puts/factchat/product/model-credits): 0.2
  // credits/1000 input tokens, 1.2 credits/1000 output tokens — see credit-rates.ts.
  it('computes the official gpt-5.6-luna rate (0.2 input / 1.2 output credits per 1000 tokens)', () => {
    // 2000 input tokens * 0.2/1000 = 0.4, 500 output tokens * 1.2/1000 = 0.6 -> 1.0 -> ceil(1.0) = 1
    expect(calculateCredits('gpt-5.6-luna', 2000, 500)).toBe(1);
    // 100 input tokens * 0.2/1000 = 0.02 -> ceil(0.02) = 1 (rounds up any fractional remainder)
    expect(calculateCredits('gpt-5.6-luna', 100, 0)).toBe(1);
    // 10000 input tokens * 0.2/1000 = 2, 1000 output tokens * 1.2/1000 = 1.2 -> 3.2 -> ceil = 4
    expect(calculateCredits('gpt-5.6-luna', 10000, 1000)).toBe(4);
    expect(calculateCredits('gpt-5.6-luna', 0, 0)).toBe(0);
  });
});

describe('calculateUsagePercent', () => {
  it('computes a percentage rounded to two decimals', () => {
    expect(calculateUsagePercent(2500, 5000)).toBe(50);
    expect(calculateUsagePercent(1234, 5000)).toBeCloseTo(24.68, 2);
  });

  it('returns 0 when the limit is not positive', () => {
    expect(calculateUsagePercent(100, 0)).toBe(0);
  });
});

describe('calculateWarningLevel', () => {
  it('returns ok below 80%', () => {
    expect(calculateWarningLevel(3999, 5000)).toBe('ok');
  });

  it('returns warning80 at exactly 80%', () => {
    expect(calculateWarningLevel(4000, 5000)).toBe('warning80');
  });

  it('returns warning90 at exactly 90%', () => {
    expect(calculateWarningLevel(4500, 5000)).toBe('warning90');
  });

  it('returns exhausted once used reaches the limit', () => {
    expect(calculateWarningLevel(5000, 5000)).toBe('exhausted');
    expect(calculateWarningLevel(5001, 5000)).toBe('exhausted');
  });
});
