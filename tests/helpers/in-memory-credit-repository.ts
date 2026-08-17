import { buildUsageSummary } from '../../src/services/credits/usage-summary.js';
import {
  CreditRecordNotFoundError,
  IdempotencyConflictError,
  InvalidCreditTransitionError,
} from '../../src/services/credits/errors.js';
import type {
  CreditRepository,
  CreditUsageRecord,
  ReserveCreditsRepositoryInput,
  ReserveCreditsResult,
  UsageSummary,
} from '../../src/services/credits/types.js';

interface Period {
  committedCredits: number;
  reservedCredits: number;
  exhausted: boolean;
}

/**
 * Plain in-memory fake of CreditRepository used to unit-test
 * CreditService's business rules (limit enforcement, idempotency).
 * This does NOT substitute for a real PostgreSQL transaction/locking
 * integration test — see README for that follow-up.
 */
export class InMemoryCreditRepository implements CreditRepository {
  private readonly periods = new Map<string, Period>();
  private readonly records = new Map<string, CreditUsageRecord>();

  private getOrCreatePeriod(billingMonth: string): Period {
    const existing = this.periods.get(billingMonth);
    if (existing) return existing;
    const created: Period = { committedCredits: 0, reservedCredits: 0, exhausted: false };
    this.periods.set(billingMonth, created);
    return created;
  }

  async reserveCredits(
    input: ReserveCreditsRepositoryInput,
    monthlyLimit: number,
  ): Promise<ReserveCreditsResult> {
    const existing = this.records.get(input.requestId);
    if (existing) {
      const matches =
        input.feature === existing.feature &&
        input.model === existing.model &&
        input.estimatedCredits === existing.creditsReserved &&
        (input.userRef ?? null) === existing.userRef;
      if (!matches) {
        throw new IdempotencyConflictError(input.requestId);
      }
      if (existing.status === 'reconciliation_pending') {
        return { ok: false, reason: 'reconciliation_pending', record: existing };
      }
      return { ok: true, record: existing, idempotentReplay: true };
    }

    const period = this.getOrCreatePeriod(input.billingMonth);

    if (period.committedCredits + period.reservedCredits + input.estimatedCredits > monthlyLimit) {
      return {
        ok: false,
        reason: 'limit_exceeded',
        usage: buildUsageSummary({
          billingMonth: input.billingMonth,
          committedCredits: period.committedCredits,
          reservedCredits: period.reservedCredits,
          limitCredits: monthlyLimit,
          now: input.requestedAt,
          exhausted: period.exhausted,
        }),
      };
    }

    period.reservedCredits += input.estimatedCredits;

    const record: CreditUsageRecord = {
      requestId: input.requestId,
      billingMonth: input.billingMonth,
      feature: input.feature,
      model: input.model,
      requestedAt: input.requestedAt,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      creditsReserved: input.estimatedCredits,
      creditsUsed: null,
      status: 'reserved',
      errorCode: null,
      userRef: input.userRef ?? null,
      retryCount: 0,
    };
    this.records.set(input.requestId, record);

    return { ok: true, record };
  }

  async commitCredits(requestId: string, creditsUsed: number): Promise<void> {
    const record = this.records.get(requestId);
    if (!record) throw new CreditRecordNotFoundError(requestId);
    if (record.status !== 'reserved')
      throw new InvalidCreditTransitionError(requestId, record.status, 'commit');

    const period = this.getOrCreatePeriod(record.billingMonth);
    period.reservedCredits -= record.creditsReserved;
    period.committedCredits += creditsUsed;

    record.status = 'completed';
    record.creditsUsed = creditsUsed;
  }

  async releaseCredits(requestId: string, errorCode?: string): Promise<void> {
    const record = this.records.get(requestId);
    if (!record) throw new CreditRecordNotFoundError(requestId);
    if (record.status !== 'reserved')
      throw new InvalidCreditTransitionError(requestId, record.status, 'release');

    const period = this.getOrCreatePeriod(record.billingMonth);
    period.reservedCredits -= record.creditsReserved;

    record.status = 'released';
    record.errorCode = errorCode ?? null;
  }

  async markReconciliationPending(requestId: string, errorCode: string): Promise<void> {
    const record = this.records.get(requestId);
    if (!record) throw new CreditRecordNotFoundError(requestId);
    if (record.status !== 'reserved') {
      throw new InvalidCreditTransitionError(
        requestId,
        record.status,
        'mark_reconciliation_pending',
      );
    }
    // Deliberately no period update — reserved_credits is untouched.
    record.status = 'reconciliation_pending';
    record.errorCode = errorCode;
  }

  async reconcileCommit(requestId: string, actualCredits: number): Promise<void> {
    const record = this.records.get(requestId);
    if (!record) throw new CreditRecordNotFoundError(requestId);
    if (record.status !== 'reconciliation_pending') {
      throw new InvalidCreditTransitionError(requestId, record.status, 'reconcile_commit');
    }

    const period = this.getOrCreatePeriod(record.billingMonth);
    period.reservedCredits -= record.creditsReserved;
    period.committedCredits += actualCredits;

    record.status = 'completed';
    record.creditsUsed = actualCredits;
  }

  async reconcileRelease(requestId: string): Promise<void> {
    const record = this.records.get(requestId);
    if (!record) throw new CreditRecordNotFoundError(requestId);
    if (record.status !== 'reconciliation_pending') {
      throw new InvalidCreditTransitionError(requestId, record.status, 'reconcile_release');
    }

    const period = this.getOrCreatePeriod(record.billingMonth);
    period.reservedCredits -= record.creditsReserved;

    record.status = 'released';
  }

  async markExhausted(billingMonth: string): Promise<void> {
    const period = this.getOrCreatePeriod(billingMonth);
    period.exhausted = true;
  }

  async getUsageSummary(
    billingMonth: string,
    limitCredits: number,
    now: Date,
  ): Promise<UsageSummary> {
    const period = this.getOrCreatePeriod(billingMonth);
    return buildUsageSummary({
      billingMonth,
      committedCredits: period.committedCredits,
      reservedCredits: period.reservedCredits,
      limitCredits,
      now,
      exhausted: period.exhausted,
    });
  }
}
