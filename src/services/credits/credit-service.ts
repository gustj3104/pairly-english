import { isAllowedModel } from '../mindlogic/credit-rates.js';
import { calculateCredits } from './credit-calculator.js';
import { getBillingMonth } from './billing-period.js';
import type {
  CreditRepository,
  ReserveCreditsRequest,
  ReserveCreditsResult,
  UsageSummary,
} from './types.js';

export class ModelNotAllowedError extends Error {
  constructor(model: string) {
    super(`Model not allowed: ${model}`);
    this.name = 'ModelNotAllowedError';
  }
}

export class CreditService {
  constructor(
    private readonly repository: CreditRepository,
    private readonly monthlyLimit: number,
  ) {}

  /**
   * Reserves credits before an outbound Mindlogic call. Rejects (without
   * calling Mindlogic) when committed + reserved + this request would
   * exceed the monthly limit. Replaying the same requestId returns the
   * original reservation instead of reserving twice.
   */
  async reserveCredits(input: ReserveCreditsRequest): Promise<ReserveCreditsResult> {
    if (!isAllowedModel(input.model)) {
      throw new ModelNotAllowedError(input.model);
    }
    const now = input.now ?? new Date();
    const billingMonth = getBillingMonth(now);
    const estimatedCredits = calculateCredits(input.model, input.inputTokens, input.outputTokens);

    return this.repository.reserveCredits(
      {
        requestId: input.requestId,
        billingMonth,
        feature: input.feature,
        model: input.model,
        requestedAt: now,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimatedCredits,
        userRef: input.userRef,
      },
      this.monthlyLimit,
    );
  }

  commitCredits(requestId: string, actualCredits: number): Promise<void> {
    return this.repository.commitCredits(requestId, actualCredits);
  }

  releaseCredits(requestId: string, errorCode?: string): Promise<void> {
    return this.repository.releaseCredits(requestId, errorCode);
  }

  /**
   * Holds a reservation as 'reconciliation_pending' — used when whether
   * Mindlogic received/billed the request is unknown (timeout, connection
   * reset, mid-response disconnect). reserved_credits is left untouched
   * so it keeps counting against the monthly budget until an operator
   * calls reconcileCommit()/reconcileRelease() below.
   */
  markReconciliationPending(requestId: string, errorCode: string): Promise<void> {
    return this.repository.markReconciliationPending(requestId, errorCode);
  }

  /** Operator-invoked, after confirming against Mindlogic's /credits/ that this request WAS billed. */
  reconcileCommit(requestId: string, actualCredits: number): Promise<void> {
    return this.repository.reconcileCommit(requestId, actualCredits);
  }

  /** Operator-invoked, after confirming against Mindlogic's /credits/ that this request was NOT billed. */
  reconcileRelease(requestId: string): Promise<void> {
    return this.repository.reconcileRelease(requestId);
  }

  markExhausted(billingMonth: string): Promise<void> {
    return this.repository.markExhausted(billingMonth);
  }

  getUsageSummary(now: Date = new Date()): Promise<UsageSummary> {
    const billingMonth = getBillingMonth(now);
    return this.repository.getUsageSummary(billingMonth, this.monthlyLimit, now);
  }
}
