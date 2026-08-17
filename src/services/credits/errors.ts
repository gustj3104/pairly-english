import type { UsageSummary } from './types.js';

/**
 * Stable, non-secret codes safe to expose in a future API error envelope.
 * Never leak PostgreSQL constraint names or raw SQL error text alongside these.
 */
export type CreditErrorCode =
  | 'CREDIT_LIMIT_EXCEEDED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_CREDIT_TRANSITION'
  | 'CREDIT_RECORD_NOT_FOUND';

/**
 * Internal signal used inside DrizzleCreditRepository.reserveCredits to
 * unwind the transaction (so the just-inserted usage record rolls back
 * along with everything else) when a reservation would exceed the
 * monthly limit. Callers of CreditRepository never see this thrown —
 * reserveCredits() catches it and converts it back into the existing
 * `{ ok: false, reason: 'limit_exceeded', usage }` result. Exported so a
 * future API route can throw/map it directly if it calls the repository
 * without going through that conversion.
 */
export class CreditLimitExceededError extends Error {
  readonly code: CreditErrorCode = 'CREDIT_LIMIT_EXCEEDED';
  readonly usage: UsageSummary;

  constructor(usage: UsageSummary) {
    super('Monthly credit limit exceeded');
    this.name = 'CreditLimitExceededError';
    this.usage = usage;
  }
}

/**
 * Thrown when a requestId is reused with a materially different payload
 * (feature, model, reserved credits, or userRef) than the reservation
 * already on record. Idempotency means "the same request retried", not
 * "any request with this id" — a mismatch is a caller bug, not a replay.
 */
export class IdempotencyConflictError extends Error {
  readonly code: CreditErrorCode = 'IDEMPOTENCY_CONFLICT';
  readonly requestId: string;

  constructor(requestId: string) {
    super(`Reservation payload for requestId ${requestId} conflicts with an existing reservation`);
    this.name = 'IdempotencyConflictError';
    this.requestId = requestId;
  }
}

export class CreditRecordNotFoundError extends Error {
  readonly code: CreditErrorCode = 'CREDIT_RECORD_NOT_FOUND';

  constructor(requestId: string) {
    super(`No credit usage record found for requestId ${requestId}`);
    this.name = 'CreditRecordNotFoundError';
  }
}

export type CreditTransitionAction =
  'commit' | 'release' | 'mark_reconciliation_pending' | 'reconcile_commit' | 'reconcile_release';

const EXPECTED_STATUS_BY_ACTION: Record<CreditTransitionAction, string> = {
  commit: 'reserved',
  release: 'reserved',
  mark_reconciliation_pending: 'reserved',
  reconcile_commit: 'reconciliation_pending',
  reconcile_release: 'reconciliation_pending',
};

/**
 * Thrown when a credit-record state transition is attempted from the
 * wrong status — e.g. committing twice, releasing an already-completed
 * record, or reconciling a record that was never marked pending.
 * Callers must not silently ignore this.
 */
export class InvalidCreditTransitionError extends Error {
  readonly code: CreditErrorCode = 'INVALID_CREDIT_TRANSITION';

  constructor(requestId: string, fromStatus: string, action: CreditTransitionAction) {
    super(
      `Cannot ${action} credit usage record ${requestId}: current status is '${fromStatus}', expected '${EXPECTED_STATUS_BY_ACTION[action]}'`,
    );
    this.name = 'InvalidCreditTransitionError';
  }
}
