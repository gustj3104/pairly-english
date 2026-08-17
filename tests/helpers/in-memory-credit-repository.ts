import { buildUsageSummary } from '../../src/services/credits/usage-summary.js';
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
    if (!record || record.status !== 'reserved') return;

    const period = this.getOrCreatePeriod(record.billingMonth);
    period.reservedCredits -= record.creditsReserved;
    period.committedCredits += creditsUsed;

    record.status = 'completed';
    record.creditsUsed = creditsUsed;
  }

  async releaseCredits(requestId: string, errorCode?: string): Promise<void> {
    const record = this.records.get(requestId);
    if (!record || record.status !== 'reserved') return;

    const period = this.getOrCreatePeriod(record.billingMonth);
    period.reservedCredits -= record.creditsReserved;

    record.status = errorCode ? 'failed' : 'released';
    record.errorCode = errorCode ?? null;
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
