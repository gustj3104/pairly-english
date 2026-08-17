/**
 * Pure decision logic for reconciling Mindlogic's own reported usage
 * (`GET /credits/`'s `monthly_allocated.used`) against this server's
 * ledger (`credit_periods.committed_credits` plus any
 * `reconciliation_pending` reservations for the month).
 *
 * No automatic scheduler is implemented here — this module only computes
 * a verdict. An operator (or, later, a scheduled job) is expected to:
 *   1. Call Mindlogic's GET /credits/ for the current billing month.
 *   2. Call evaluateReconciliation() with that figure plus the pending
 *      reservations from our own DB.
 *   3. Act on the verdict via CreditService.reconcileCommit()/
 *      reconcileRelease() for the specific requestId(s) the verdict
 *      identifies as safe to resolve — never bulk-resolve pending
 *      records the verdict itself flags as ambiguous.
 */

export interface PendingReservation {
  requestId: string;
  reservedCredits: number;
}

export interface ReconciliationInput {
  /** Mindlogic's own monthly_allocated.used for this billing month. */
  providerUsedCredits: number;
  /** Our credit_periods.committed_credits for this billing month. */
  dbCommittedCredits: number;
  /** All credit_usage_records currently 'reconciliation_pending' for this billing month. */
  pendingReservations: PendingReservation[];
  /** MINDLOGIC_MONTHLY_CREDIT_LIMIT (normally 5,000). */
  configuredMonthlyLimit: number;
}

export type ReconciliationVerdictStatus =
  | 'in_sync'
  | 'unexplained_discrepancy'
  | 'ambiguous_pending_needs_manual_review'
  | 'discrepancy_exceeds_pending_reservations'
  | 'provider_reports_less_than_committed';

export interface ReconciliationVerdict {
  status: ReconciliationVerdictStatus;
  /** providerUsedCredits - dbCommittedCredits. Positive means the provider reports MORE usage than we've committed. */
  discrepancy: number;
  /**
   * requestIds safe to auto-resolve via reconcileRelease() — only ever
   * populated when there is certain evidence none of them were billed
   * (discrepancy <= 0). Never populated for a positive, unexplained, or
   * ambiguous discrepancy — see requiresManualReview.
   */
  autoReleasableRequestIds: string[];
  /** True whenever this verdict cannot be resolved by a mechanical rule and needs a human operator to look at each pending record individually. */
  requiresManualReview: boolean;
  /** Human-readable explanation, safe to show an operator (no user content, no secrets). */
  explanation: string;
  /**
   * The used-credits baseline to apply for gating NEW reservations while
   * this discrepancy is unresolved — always the more conservative
   * (higher) of what the provider reports and what our own ledger
   * records, so an unresolved gap is never used to justify approving
   * more spend than either source alone would allow.
   */
  conservativeUsedBaseline: number;
  /** Remaining budget computed from conservativeUsedBaseline and all pending reservations, floored at 0. */
  conservativeRemainingCredits: number;
}

function totalPendingCredits(pending: PendingReservation[]): number {
  return pending.reduce((sum, item) => sum + item.reservedCredits, 0);
}

export function evaluateReconciliation(input: ReconciliationInput): ReconciliationVerdict {
  const discrepancy = input.providerUsedCredits - input.dbCommittedCredits;
  const conservativeUsedBaseline = Math.max(input.providerUsedCredits, input.dbCommittedCredits);
  const conservativeRemainingCredits = Math.max(
    input.configuredMonthlyLimit -
      conservativeUsedBaseline -
      totalPendingCredits(input.pendingReservations),
    0,
  );

  const base = { discrepancy, conservativeUsedBaseline, conservativeRemainingCredits };

  if (discrepancy <= 0) {
    // The provider reports no more usage than we already know about —
    // certain evidence that none of the pending reservations were
    // billed (a discrepancy < 0, the provider reporting LESS than we've
    // committed, is itself notable and worth flagging, but it does not
    // implicate any pending request in having been charged, so releasing
    // pending reservations is still safe).
    const status: ReconciliationVerdictStatus =
      discrepancy < 0 ? 'provider_reports_less_than_committed' : 'in_sync';
    return {
      ...base,
      status,
      autoReleasableRequestIds: input.pendingReservations.map((p) => p.requestId),
      requiresManualReview: discrepancy < 0,
      explanation:
        discrepancy < 0
          ? `Provider reports ${Math.abs(discrepancy)} fewer credits used than our ledger's committed total. This does not implicate any pending reservation, so they are safe to release, but the negative gap itself should be investigated separately (possible double-count on our side or a provider-side credit/refund).`
          : 'Provider-reported usage matches (or is less than) our committed total. No pending reservation shows evidence of having been billed — all are safe to release.',
    };
  }

  // discrepancy > 0: the provider reports more usage than we've
  // committed. Do NOT optimistically ignore this.
  if (input.pendingReservations.length === 0) {
    return {
      ...base,
      status: 'unexplained_discrepancy',
      autoReleasableRequestIds: [],
      requiresManualReview: true,
      explanation: `Provider reports ${discrepancy} more credits used than our committed total, but there are no reconciliation_pending reservations to account for it. This does not resolve itself — investigate for a missed commit, a bug, or provider-side billing not reflected in our ledger.`,
    };
  }

  const totalPending = totalPendingCredits(input.pendingReservations);

  if (discrepancy > totalPending) {
    return {
      ...base,
      status: 'discrepancy_exceeds_pending_reservations',
      autoReleasableRequestIds: [],
      requiresManualReview: true,
      explanation: `Provider reports ${discrepancy} more credits used than our committed total, which exceeds the ${totalPending} credits currently held as reconciliation_pending. Even resolving every pending reservation as billed would not fully explain the gap — investigate before resolving any of them.`,
    };
  }

  // 0 < discrepancy <= totalPending: some subset of the pending
  // reservations plausibly accounts for it, but with more than one
  // pending reservation we cannot tell WHICH ONE(S) — never guess.
  return {
    ...base,
    status: 'ambiguous_pending_needs_manual_review',
    autoReleasableRequestIds: [],
    requiresManualReview: true,
    explanation:
      input.pendingReservations.length === 1
        ? `Provider reports ${discrepancy} more credits used than committed, and exactly one reservation (${input.pendingReservations[0]?.requestId}) is pending for up to ${input.pendingReservations[0]?.reservedCredits} credits — plausible that this specific request was billed ~${discrepancy} credits, but this is a suggestion, not certainty. An operator should confirm before calling reconcileCommit().`
        : `Provider reports ${discrepancy} more credits used than committed, and ${input.pendingReservations.length} reservations are pending (totaling ${totalPending} credits). The gap could be explained by any subset of them — which one(s) cannot be determined from aggregate numbers alone. Do not bulk-resolve; review each pending request individually.`,
  };
}
