import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { creditPeriods, creditUsageRecords } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import { buildUsageSummary } from './usage-summary.js';
import { CreditRecordNotFoundError, InvalidCreditTransitionError } from './errors.js';
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
 * against the same month are serialized against the same limit check.
 *
 * commitCredits/releaseCredits use a single conditional
 * `UPDATE ... WHERE status = 'reserved' RETURNING *` to atomically claim
 * the state transition (so two concurrent settlements of the same
 * requestId can't both succeed), followed by an in-place arithmetic
 * UPDATE on credit_periods (`reserved_credits = reserved_credits - $n`),
 * which Postgres itself serializes per-row without needing a separate
 * lock statement.
 *
 * Covered by tests/integration/credit-repository.postgres.test.ts against
 * a real PostgreSQL instance (Testcontainers). See README for scope.
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

      // SELECT ... FOR UPDATE cannot lock a row that doesn't exist yet, so
      // two concurrent first-reservations of a brand-new billing month
      // would otherwise both fall through to INSERT and race on the PK.
      // Upserting a zeroed row first (idempotent, Postgres-serialized on
      // the unique index) guarantees the row exists before we lock it.
      await tx
        .insert(creditPeriods)
        .values({ billingMonth: input.billingMonth })
        .onConflictDoNothing();

      const [period] = await tx
        .select()
        .from(creditPeriods)
        .where(eq(creditPeriods.billingMonth, input.billingMonth))
        .for('update');

      if (!period) {
        throw new Error(`credit_periods row for ${input.billingMonth} could not be created`);
      }

      if (
        period.committedCredits + period.reservedCredits + input.estimatedCredits >
        monthlyLimit
      ) {
        const usage = buildUsageSummary({
          billingMonth: input.billingMonth,
          committedCredits: period.committedCredits,
          reservedCredits: period.reservedCredits,
          limitCredits: monthlyLimit,
          now: input.requestedAt,
          exhausted: period.exhausted,
        });
        return { ok: false, reason: 'limit_exceeded', usage } as const;
      }

      await tx
        .update(creditPeriods)
        .set({
          reservedCredits: period.reservedCredits + input.estimatedCredits,
          updatedAt: new Date(),
        })
        .where(eq(creditPeriods.billingMonth, input.billingMonth));

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
      const [updated] = await tx
        .update(creditUsageRecords)
        .set({ status: 'completed', creditsUsed })
        .where(
          and(
            eq(creditUsageRecords.requestId, requestId),
            eq(creditUsageRecords.status, 'reserved'),
          ),
        )
        .returning();

      if (!updated) {
        const existing = await tx.query.creditUsageRecords.findFirst({
          where: eq(creditUsageRecords.requestId, requestId),
        });
        if (!existing) throw new CreditRecordNotFoundError(requestId);
        throw new InvalidCreditTransitionError(requestId, existing.status, 'commit');
      }

      await tx
        .update(creditPeriods)
        .set({
          reservedCredits: sql`${creditPeriods.reservedCredits} - ${updated.creditsReserved}`,
          committedCredits: sql`${creditPeriods.committedCredits} + ${creditsUsed}`,
          updatedAt: new Date(),
        })
        .where(eq(creditPeriods.billingMonth, updated.billingMonth));
    });
  }

  async releaseCredits(requestId: string, errorCode?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(creditUsageRecords)
        .set({ status: 'released', errorCode: errorCode ?? null })
        .where(
          and(
            eq(creditUsageRecords.requestId, requestId),
            eq(creditUsageRecords.status, 'reserved'),
          ),
        )
        .returning();

      if (!updated) {
        const existing = await tx.query.creditUsageRecords.findFirst({
          where: eq(creditUsageRecords.requestId, requestId),
        });
        if (!existing) throw new CreditRecordNotFoundError(requestId);
        throw new InvalidCreditTransitionError(requestId, existing.status, 'release');
      }

      await tx
        .update(creditPeriods)
        .set({
          reservedCredits: sql`${creditPeriods.reservedCredits} - ${updated.creditsReserved}`,
          updatedAt: new Date(),
        })
        .where(eq(creditPeriods.billingMonth, updated.billingMonth));
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
