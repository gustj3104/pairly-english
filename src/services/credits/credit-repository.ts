import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { creditPeriods, creditUsageRecords } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import { buildUsageSummary } from './usage-summary.js';
import {
  CreditLimitExceededError,
  CreditRecordNotFoundError,
  IdempotencyConflictError,
  InvalidCreditTransitionError,
} from './errors.js';
import type {
  CreditRepository,
  CreditUsageRecord,
  ReserveCreditsRepositoryInput,
  ReserveCreditsResult,
  UsageSummary,
} from './types.js';

type Db = NodePgDatabase<typeof schema>;
type CreditUsageRecordRow = typeof creditUsageRecords.$inferSelect;

function toCreditUsageRecord(row: CreditUsageRecordRow): CreditUsageRecord {
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
 * A requestId replay must carry the same logical request. If the caller
 * reuses a requestId with a different feature/model/reserved-amount/
 * userRef, that's a bug on the caller's side, not a legitimate retry —
 * silently returning the old reservation would hide it.
 */
function assertSamePayload(
  input: ReserveCreditsRepositoryInput,
  existing: CreditUsageRecordRow,
): void {
  const matches =
    input.feature === existing.feature &&
    input.model === existing.model &&
    input.estimatedCredits === existing.creditsReserved &&
    (input.userRef ?? null) === existing.userRef;

  if (!matches) {
    throw new IdempotencyConflictError(input.requestId);
  }
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
    return this.db
      .transaction(async (tx) => {
        // SELECT ... FOR UPDATE cannot lock a row that doesn't exist yet, so
        // two concurrent first-reservations of a brand-new billing month
        // would otherwise both fall through to INSERT and race on the PK.
        // Upserting a zeroed row first (idempotent, Postgres-serialized on
        // the unique index) guarantees the row exists before we lock it.
        await tx
          .insert(creditPeriods)
          .values({ billingMonth: input.billingMonth })
          .onConflictDoNothing();

        // Locks the one row every reservation for this month must pass
        // through — same requestId or not. Holding this lock for the rest
        // of the transaction is what makes the requestId claim below race
        // -free: nothing else can be reserving against this month while we
        // hold it, so there is no gap between "check" and "act".
        const [period] = await tx
          .select()
          .from(creditPeriods)
          .where(eq(creditPeriods.billingMonth, input.billingMonth))
          .for('update');

        if (!period) {
          throw new Error(`credit_periods row for ${input.billingMonth} could not be created`);
        }

        // Atomically claim this requestId. A concurrent or prior call that
        // already claimed it makes this a no-op (0 rows) — never a thrown
        // unique-violation. (Even outside this month's lock, PostgreSQL's
        // own unique-index arbitration on request_id would still prevent
        // two callers from both winning; the period lock additionally
        // makes the limit check below atomic with the claim.)
        const [claimed] = await tx
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
          .onConflictDoNothing({ target: creditUsageRecords.requestId })
          .returning();

        if (!claimed) {
          // Someone else already holds this requestId — this call is a
          // replay, not a new reservation. reserved_credits must not move.
          const existing = await tx.query.creditUsageRecords.findFirst({
            where: eq(creditUsageRecords.requestId, input.requestId),
          });
          if (!existing) {
            // Unreachable in practice: a conflict on request_id guarantees
            // a row exists. Guarded for type-safety and defense in depth.
            throw new Error(
              `credit_usage_records row for ${input.requestId} could not be found after a conflicting insert`,
            );
          }
          assertSamePayload(input, existing);

          if (existing.status === 'reconciliation_pending') {
            // Transmission/billing status for this requestId is still
            // unknown — must not proceed to call the provider again.
            return {
              ok: false,
              reason: 'reconciliation_pending',
              record: toCreditUsageRecord(existing),
            } as const;
          }

          return {
            ok: true,
            record: toCreditUsageRecord(existing),
            idempotentReplay: true,
          } as const;
        }

        // We won the claim: this is a genuinely new reservation. Run the
        // limit check now, still holding the period lock.
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
          // Throwing aborts the whole transaction — the usage record we
          // just inserted above is rolled back along with it, so a
          // rejected reservation never leaves a ledger row.
          throw new CreditLimitExceededError(usage);
        }

        await tx
          .update(creditPeriods)
          .set({
            reservedCredits: period.reservedCredits + input.estimatedCredits,
            updatedAt: new Date(),
          })
          .where(eq(creditPeriods.billingMonth, input.billingMonth));

        return { ok: true, record: toCreditUsageRecord(claimed) } as const;
      })
      .catch((error: unknown) => {
        if (error instanceof CreditLimitExceededError) {
          return { ok: false, reason: 'limit_exceeded', usage: error.usage } as const;
        }
        throw error;
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

  async markReconciliationPending(requestId: string, errorCode: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(creditUsageRecords)
        .set({ status: 'reconciliation_pending', errorCode })
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
        throw new InvalidCreditTransitionError(
          requestId,
          existing.status,
          'mark_reconciliation_pending',
        );
      }

      // Deliberately no credit_periods update: reserved_credits stays
      // exactly as it was, continuing to count against the monthly
      // budget until an operator reconciles this record.
    });
  }

  async reconcileCommit(requestId: string, actualCredits: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(creditUsageRecords)
        .set({ status: 'completed', creditsUsed: actualCredits })
        .where(
          and(
            eq(creditUsageRecords.requestId, requestId),
            eq(creditUsageRecords.status, 'reconciliation_pending'),
          ),
        )
        .returning();

      if (!updated) {
        const existing = await tx.query.creditUsageRecords.findFirst({
          where: eq(creditUsageRecords.requestId, requestId),
        });
        if (!existing) throw new CreditRecordNotFoundError(requestId);
        throw new InvalidCreditTransitionError(requestId, existing.status, 'reconcile_commit');
      }

      await tx
        .update(creditPeriods)
        .set({
          reservedCredits: sql`${creditPeriods.reservedCredits} - ${updated.creditsReserved}`,
          committedCredits: sql`${creditPeriods.committedCredits} + ${actualCredits}`,
          updatedAt: new Date(),
        })
        .where(eq(creditPeriods.billingMonth, updated.billingMonth));
    });
  }

  async reconcileRelease(requestId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(creditUsageRecords)
        .set({ status: 'released' })
        .where(
          and(
            eq(creditUsageRecords.requestId, requestId),
            eq(creditUsageRecords.status, 'reconciliation_pending'),
          ),
        )
        .returning();

      if (!updated) {
        const existing = await tx.query.creditUsageRecords.findFirst({
          where: eq(creditUsageRecords.requestId, requestId),
        });
        if (!existing) throw new CreditRecordNotFoundError(requestId);
        throw new InvalidCreditTransitionError(requestId, existing.status, 'reconcile_release');
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
