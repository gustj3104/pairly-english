export type CreditStatus =
  | 'reserved'
  | 'completed'
  | 'failed'
  | 'released'
  // Transmission/billing status to the AI provider is unknown (timeout,
  // connection reset, response cut off mid-stream). Held, not released,
  // until an operator reconciles it against the provider's own usage
  // report — see reconcileCommit()/reconcileRelease() below.
  | 'reconciliation_pending';

export type CreditFeature =
  | 'reflection_comparison'
  | 'daily_news'
  | 'grammar_feedback'
  | 'vocabulary_extraction'
  | 'news_processing'
  | 'reconciliation_adjustment'
  // Minimal bare-messages provider contract check (scripts/mindlogic-contract-check.ts)
  // — not a user-facing feature, but still goes through the real credit ledger.
  | 'provider_contract_check';

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
  | { ok: false; reason: 'limit_exceeded'; usage: UsageSummary }
  /**
   * The same requestId already has a reservation stuck in
   * 'reconciliation_pending' — its transmission/billing status is
   * unknown, so this call must NOT proceed to call the provider again.
   */
  | { ok: false; reason: 'reconciliation_pending'; record: CreditUsageRecord };

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
 *
 * State machine for credit_usage_records.status:
 *   reserved -> completed              (commitCredits)
 *   reserved -> released               (releaseCredits)
 *   reserved -> reconciliation_pending (markReconciliationPending)
 *   reconciliation_pending -> completed (reconcileCommit)
 *   reconciliation_pending -> released  (reconcileRelease)
 * Any other transition throws InvalidCreditTransitionError.
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
  /**
   * Moves a 'reserved' record to 'reconciliation_pending' WITHOUT
   * touching reserved_credits — the reservation keeps counting against
   * the monthly budget until an operator resolves it. Throws
   * CreditRecordNotFoundError / InvalidCreditTransitionError if
   * requestId is unknown or not currently 'reserved'.
   */
  markReconciliationPending(requestId: string, errorCode: string): Promise<void>;
  /**
   * Operator-invoked: confirms a pending reservation WAS billed for
   * `actualCredits` — moves reconciliation_pending -> completed. Throws
   * CreditRecordNotFoundError / InvalidCreditTransitionError if
   * requestId is unknown or not currently 'reconciliation_pending'.
   */
  reconcileCommit(requestId: string, actualCredits: number): Promise<void>;
  /**
   * Operator-invoked: confirms a pending reservation was NOT billed —
   * moves reconciliation_pending -> released. Throws
   * CreditRecordNotFoundError / InvalidCreditTransitionError if
   * requestId is unknown or not currently 'reconciliation_pending'.
   */
  reconcileRelease(requestId: string): Promise<void>;
  markExhausted(billingMonth: string): Promise<void>;
  getUsageSummary(billingMonth: string, limitCredits: number, now: Date): Promise<UsageSummary>;
}
