export type CreditStatus = 'reserved' | 'completed' | 'failed' | 'released';

export type CreditFeature =
  | 'reflection_comparison'
  | 'grammar_feedback'
  | 'vocabulary_extraction'
  | 'news_processing'
  | 'reconciliation_adjustment';

export interface CreditUsageRecord {
  requestId: string;
  billingMonth: string;
  feature: CreditFeature;
  model: string;
  requestedAt: Date;
  inputTokens: number;
  outputTokens: number;
  creditsReserved: number;
  creditsUsed: number | null;
  status: CreditStatus;
  errorCode: string | null;
  userRef: string | null;
  retryCount: number;
}

export interface UsageSummary {
  billingMonth: string;
  usedCredits: number;
  reservedCredits: number;
  remainingCredits: number;
  limitCredits: number;
  usagePercent: number;
  nextResetDate: string;
  warningLevel: 'ok' | 'warning80' | 'warning90' | 'exhausted';
  aiFeaturesAvailable: boolean;
}

export interface ReserveCreditsRequest {
  requestId: string;
  feature: CreditFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  userRef?: string;
  now?: Date;
}

export type ReserveCreditsResult =
  | { ok: true; record: CreditUsageRecord; idempotentReplay?: boolean }
  | { ok: false; reason: 'limit_exceeded'; usage: UsageSummary };

export interface ReserveCreditsRepositoryInput {
  requestId: string;
  billingMonth: string;
  feature: CreditFeature;
  model: string;
  requestedAt: Date;
  inputTokens: number;
  outputTokens: number;
  estimatedCredits: number;
  userRef?: string;
}

/**
 * Storage-agnostic contract for credit accounting. The real implementation
 * (DrizzleCreditRepository) enforces atomicity with a PostgreSQL transaction
 * and row lock; an in-memory fake implements the same contract for unit
 * tests of CreditService's business rules. See tests/helpers for the fake
 * and README for the status of real-database integration tests.
 */
export interface CreditRepository {
  reserveCredits(
    input: ReserveCreditsRepositoryInput,
    monthlyLimit: number,
  ): Promise<ReserveCreditsResult>;
  /** Throws CreditRecordNotFoundError / InvalidCreditTransitionError (./errors.js) if requestId is unknown or not currently 'reserved'. */
  commitCredits(requestId: string, creditsUsed: number): Promise<void>;
  /** Throws CreditRecordNotFoundError / InvalidCreditTransitionError (./errors.js) if requestId is unknown or not currently 'reserved'. */
  releaseCredits(requestId: string, errorCode?: string): Promise<void>;
  markExhausted(billingMonth: string): Promise<void>;
  getUsageSummary(billingMonth: string, limitCredits: number, now: Date): Promise<UsageSummary>;
}
