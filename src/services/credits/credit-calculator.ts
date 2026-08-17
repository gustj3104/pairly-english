import { MODEL_CREDIT_RATES, type AllowedModel } from '../mindlogic/credit-rates.js';

export type WarningLevel = 'ok' | 'warning80' | 'warning90' | 'exhausted';

/**
 * Credits are computed per token bucket and summed, then rounded up.
 * The Mindlogic docs do not specify a rounding rule, so we round up
 * conservatively rather than risk under-billing against the hard cap.
 */
export function calculateCredits(
  model: AllowedModel,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = MODEL_CREDIT_RATES[model];
  const inputCredits = (inputTokens / 1000) * rate.inputCreditsPerThousandTokens;
  const outputCredits = (outputTokens / 1000) * rate.outputCreditsPerThousandTokens;
  return Math.ceil(inputCredits + outputCredits);
}

export function calculateUsagePercent(usedCredits: number, limitCredits: number): number {
  if (limitCredits <= 0) return 0;
  return Math.round((usedCredits / limitCredits) * 10000) / 100;
}

export function calculateWarningLevel(usedCredits: number, limitCredits: number): WarningLevel {
  if (limitCredits <= 0 || usedCredits >= limitCredits) return 'exhausted';
  const percent = (usedCredits / limitCredits) * 100;
  if (percent >= 90) return 'warning90';
  if (percent >= 80) return 'warning80';
  return 'ok';
}
