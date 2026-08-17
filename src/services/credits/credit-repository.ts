import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { creditPeriods, creditUsageRecords } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import { buildUsageSummary } from './usage-summary.js';
import type {
  CreditRepository,
  CreditUsageRecord,
  ReserveCreditsRepositoryInput,
  ReserveCreditsResult,
  UsageSummary,
} from './types.js';

type Db = NodePgDatabase<typeof schema>;

function toCreditUsageRecord(row: typeof creditUsageRecords.$inferSelect): CreditUsageRecord {
  return {
    requestId: row.requestId,
    billingMonth: row.billingMonth,
    feature: row.feature,
    model: row.model,
    requestedAt: row.requestedAt,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    creditsReserved: row.creditsReserved,
    creditsUsed: row.creditsUsed,
    status: row.status,
    errorCode: row.errorCode,
    userRef: row.userRef,
    retryCount: row.retryCount,
  };
}

/**
 * PostgreSQL-backed CreditRepository. Atomicity for reserveCredits comes
 * from a transaction combined with `SELECT ... FOR UPDATE` on the
 * credit_periods row for the billing month, so concurrent reservations
 * are serialized against the same limit check.
 *
 * Not yet covered by automated tests against a real PostgreSQL instance —
 * see README for the planned Testcontainers-based integration test.
 */
export class DrizzleCreditRepository implements CreditRepository {
  constructor(private readonly db: Db) {}

  async reserveCredits(
    input: ReserveCreditsRepositoryInput,
    monthlyLimit: number,
  ): Promise<ReserveCreditsResult> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.query.creditUsageRecords.findFirst({
        where: eq(creditUsageRecords.requestId, input.requestId),
      });
      if (existing) {
        return { ok: true, record: toCreditUsageRecord(existing), idempotentReplay: true } as const;
      }

      const [period] = await tx
        .select()
        .from(creditPeriods)
        .where(eq(creditPeriods.billingMonth, input.billingMonth))
        .for('update');

      const committed = period?.committedCredits ?? 0;
      const reserved = period?.reservedCredits ?? 0;

      if (committed + reserved + input.estimatedCredits > monthlyLimit) {
        const usage = buildUsageSummary({
          billingMonth: input.billingMonth,
          committedCredits: committed,
          reservedCredits: reserved,
          limitCredits: monthlyLimit,
          now: input.requestedAt,
          exhausted: period?.exhausted ?? false,
        });
        return { ok: false, reason: 'limit_exceeded', usage } as const;
      }

      if (period) {
        await tx
          .update(creditPeriods)
          .set({ reservedCredits: reserved + input.estimatedCredits, updatedAt: new Date() })
          .where(eq(creditPeriods.billingMonth, input.billingMonth));
      } else {
        await tx.insert(creditPeriods).values({
          billingMonth: input.billingMonth,
          reservedCredits: input.estimatedCredits,
        });
      }

      const [inserted] = await tx
        .insert(creditUsageRecords)
        .values({
          requestId: input.requestId,
          billingMonth: input.billingMonth,
          feature: input.feature,
          model: input.model,
          requestedAt: input.requestedAt,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          creditsReserved: input.estimatedCredits,
          status: 'reserved',
          userRef: input.userRef ?? null,
        })
        .returning();

      if (!inserted) {
        throw new Error('Failed to insert credit usage record');
      }

      return { ok: true, record: toCreditUsageRecord(inserted) } as const;
    });
  }

  async commitCredits(requestId: string, creditsUsed: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const record = await tx.query.creditUsageRecords.findFirst({
        where: eq(creditUsageRecords.requestId, requestId),
      });
      if (!record || record.status !== 'reserved') return;

      await tx
        .update(creditUsageRecords)
        .set({ status: 'completed', creditsUsed })
        .where(eq(creditUsageRecords.requestId, requestId));

      const [period] = await tx
        .select()
        .from(creditPeriods)
        .where(eq(creditPeriods.billingMonth, record.billingMonth))
        .for('update');
      if (!period) return;

      await tx
        .update(creditPeriods)
        .set({
          reservedCredits: period.reservedCredits - record.creditsReserved,
          committedCredits: period.committedCredits + creditsUsed,
          updatedAt: new Date(),
        })
        .where(eq(creditPeriods.billingMonth, record.billingMonth));
    });
  }

  async releaseCredits(requestId: string, errorCode?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const record = await tx.query.creditUsageRecords.findFirst({
        where: eq(creditUsageRecords.requestId, requestId),
      });
      if (!record || record.status !== 'reserved') return;

      await tx
        .update(creditUsageRecords)
        .set({ status: errorCode ? 'failed' : 'released', errorCode: errorCode ?? null })
        .where(eq(creditUsageRecords.requestId, requestId));

      const [period] = await tx
        .select()
        .from(creditPeriods)
        .where(eq(creditPeriods.billingMonth, record.billingMonth))
        .for('update');
      if (!period) return;

      await tx
        .update(creditPeriods)
        .set({
          reservedCredits: period.reservedCredits - record.creditsReserved,
          updatedAt: new Date(),
        })
        .where(eq(creditPeriods.billingMonth, record.billingMonth));
    });
  }

  async markExhausted(billingMonth: string): Promise<void> {
    await this.db
      .insert(creditPeriods)
      .values({ billingMonth, exhausted: true })
      .onConflictDoUpdate({
        target: creditPeriods.billingMonth,
        set: { exhausted: true, updatedAt: new Date() },
      });
  }

  async getUsageSummary(
    billingMonth: string,
    limitCredits: number,
    now: Date,
  ): Promise<UsageSummary> {
    const period = await this.db.query.creditPeriods.findFirst({
      where: eq(creditPeriods.billingMonth, billingMonth),
    });

    return buildUsageSummary({
      billingMonth,
      committedCredits: period?.committedCredits ?? 0,
      reservedCredits: period?.reservedCredits ?? 0,
      limitCredits,
      now,
      exhausted: period?.exhausted ?? false,
    });
  }
}
