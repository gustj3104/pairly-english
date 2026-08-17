import { calculateUsagePercent, calculateWarningLevel } from './credit-calculator.js';
import { getNextResetDate } from './billing-period.js';
import type { UsageSummary } from './types.js';

export function buildUsageSummary(params: {
  billingMonth: string;
  committedCredits: number;
  reservedCredits: number;
  limitCredits: number;
  now: Date;
  exhausted: boolean;
}): UsageSummary {
  const usedCredits = params.committedCredits;
  // Reserved credits are provisionally spoken-for capacity: the warning
  // level and percentage should reflect them too, so a client sees a
  // rising warning even before a reservation is committed.
  const occupiedCredits = usedCredits + params.reservedCredits;
  const remainingCredits = Math.max(params.limitCredits - occupiedCredits, 0);
  const computedWarningLevel = calculateWarningLevel(occupiedCredits, params.limitCredits);
  const warningLevel = params.exhausted ? 'exhausted' : computedWarningLevel;

  return {
    billingMonth: params.billingMonth,
    usedCredits,
    reservedCredits: params.reservedCredits,
    remainingCredits,
    limitCredits: params.limitCredits,
    usagePercent: calculateUsagePercent(occupiedCredits, params.limitCredits),
    nextResetDate: getNextResetDate(params.now),
    warningLevel,
    aiFeaturesAvailable: warningLevel !== 'exhausted',
  };
}
