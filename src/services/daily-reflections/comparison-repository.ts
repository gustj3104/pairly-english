import { randomUUID } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { reflections, studyDayComparisons, studyDays } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import type { FingerprintReflectionInput } from './comparison-fingerprint.js';

type Db = NodePgDatabase<typeof schema>;

export type ComparisonStatus = 'processing' | 'completed' | 'failed' | 'reconciliation_pending';

export interface StudyDayComparisonRow {
  studyDate: string;
  requestId: string;
  status: ComparisonStatus;
  model: string;
  inputFingerprint: string;
  /** Raw, unvalidated JSONB as read from the DB — callers must re-validate before trusting it. */
  result: unknown;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}

export type ComputeFingerprint = (input: {
  articleId: string;
  reflections: FingerprintReflectionInput[];
}) => string;

export type ClaimGenerationOutcome =
  | { outcome: 'partner_not_ready' }
  | { outcome: 'claimed'; requestId: string; fingerprint: string }
  /** Raw, unvalidated JSONB — see StudyDayComparisonRow.result. */
  | { outcome: 'cached'; result: unknown }
  | { outcome: 'in_progress' }
  | { outcome: 'reconciliation_pending' }
  | { outcome: 'failed'; errorCode: string | null };

export type ClaimRetryOutcome =
  | { outcome: 'not_started' }
  | { outcome: 'processing' }
  | { outcome: 'completed' }
  | { outcome: 'reconciliation_pending' }
  | { outcome: 'claimed'; requestId: string };

/**
 * Storage-agnostic contract for the study-day-comparison caching/locking
 * feature. Mirrors the DailyReflectionRepository / CreditRepository
 * split-interface pattern so unit tests can inject an in-memory fake
 * (tests/helpers/in-memory-comparison-repository.ts) while integration
 * tests exercise DrizzleComparisonRepository against real PostgreSQL.
 */
export interface ComparisonRepository {
  /**
   * Phase 1 of the two-phase design (README "Study-day comparison"): one
   * short transaction, never held across a Mindlogic call.
   *  1. Lock study_days for this date; no row => partner_not_ready.
   *  2. Exactly 2 reflections required => otherwise partner_not_ready.
   *  3. Compute the input fingerprint via `computeFingerprint`.
   *  4. Lock study_day_comparisons for this date (may not exist yet).
   *  5. Branch: no row / stale-fingerprint completed row => INSERT/UPDATE a
   *     fresh 'processing' claim (outcome 'claimed'); matching-fingerprint
   *     completed row => 'cached'; 'processing' => 'in_progress';
   *     'reconciliation_pending' => 'reconciliation_pending'; 'failed' =>
   *     'failed' (POST /compare must never auto-retry a failed row).
   */
  claimGeneration(
    studyDate: string,
    model: string,
    computeFingerprint: ComputeFingerprint,
  ): Promise<ClaimGenerationOutcome>;

  /** Phase 2 settlement: the claimer's Mindlogic call succeeded. */
  completeGeneration(studyDate: string, requestId: string, result: unknown): Promise<void>;

  /** Phase 2 settlement: the claimer's Mindlogic call failed (certain, non-billing-ambiguous failure). */
  failGeneration(studyDate: string, requestId: string, errorCode: string): Promise<void>;

  /** Phase 2 settlement: Mindlogic's transmission/billing status for this attempt is unknown. */
  markReconciliationPending(studyDate: string, requestId: string, errorCode: string): Promise<void>;

  /** Read-only lookup for GET /study-days/:date/comparison. */
  getByDate(studyDate: string): Promise<StudyDayComparisonRow | null>;

  /**
   * Claims retry rights on a 'failed' row via its own short,
   * separately-locked transaction: re-checks the row is STILL 'failed'
   * while holding the lock (this is what makes concurrent retries
   * race-safe — only the winner gets 'claimed'), then atomically flips it
   * to 'processing' with a brand-new request_id. The old failed attempt's
   * request_id (and its credit_usage_records row) is never reused or
   * touched.
   */
  claimRetry(studyDate: string): Promise<ClaimRetryOutcome>;

  /**
   * Purely informational: finds rows stuck at status='processing' for
   * longer than `olderThanMs`. Never takes action — no automatic
   * lease/TTL takeover exists anywhere in this codebase by design (see
   * README "Crash safety / manual recovery"). For an operator to inspect,
   * then manually cross-reference against credit_usage_records by the
   * shared request_id and decide whether to mark the row 'failed' or
   * 'reconciliation_pending'.
   */
  findStaleProcessing(olderThanMs: number, now?: Date): Promise<StudyDayComparisonRow[]>;
}

function toRow(row: typeof studyDayComparisons.$inferSelect): StudyDayComparisonRow {
  return {
    studyDate: row.studyDate,
    requestId: row.requestId,
    status: row.status,
    model: row.model,
    inputFingerprint: row.inputFingerprint,
    result: row.result,
    errorCode: row.errorCode,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * PostgreSQL-backed ComparisonRepository. Atomicity comes from the same
 * transaction + `SELECT ... FOR UPDATE` pattern as
 * DrizzleCreditRepository.reserveCredits /
 * DrizzleDailyReflectionRepository.submitReflection: claimGeneration locks
 * study_days then study_day_comparisons, all within one short transaction
 * that never spans the actual Mindlogic call (that happens entirely
 * outside any transaction — see src/routes/study-days.ts). claimRetry
 * locks only study_day_comparisons, re-checking 'failed' under the lock so
 * concurrent retries collapse into exactly one winner.
 *
 * Covered by tests/integration/study-days-comparison.postgres.test.ts,
 * including a ~20-way concurrent POST /compare race and a concurrent-retry
 * race, both against real PostgreSQL.
 */
export class DrizzleComparisonRepository implements ComparisonRepository {
  constructor(private readonly db: Db) {}

  async claimGeneration(
    studyDate: string,
    model: string,
    computeFingerprint: ComputeFingerprint,
  ): Promise<ClaimGenerationOutcome> {
    return this.db.transaction(async (tx) => {
      // Locks the same study_days row every reflection PUT already passes
      // through (DrizzleDailyReflectionRepository.submitReflection) —
      // serializes concurrent compare attempts for this date against each
      // other, and against any concurrent submission.
      const [day] = await tx
        .select()
        .from(studyDays)
        .where(eq(studyDays.studyDate, studyDate))
        .for('update');

      if (!day) {
        return { outcome: 'partner_not_ready' } as const;
      }

      const reflectionRows = await tx
        .select()
        .from(reflections)
        .where(eq(reflections.studyDate, studyDate));

      if (reflectionRows.length !== 2) {
        return { outcome: 'partner_not_ready' } as const;
      }

      const fingerprint = computeFingerprint({
        articleId: day.articleId,
        reflections: reflectionRows.map((r) => ({
          participantKey: r.participantKey,
          content: r.content,
        })),
      });

      // May not exist yet — that's fine, it just means "no prior state".
      const [existing] = await tx
        .select()
        .from(studyDayComparisons)
        .where(eq(studyDayComparisons.studyDate, studyDate))
        .for('update');

      const now = new Date();

      if (!existing) {
        const requestId = randomUUID();
        await tx.insert(studyDayComparisons).values({
          studyDate,
          requestId,
          status: 'processing',
          model,
          inputFingerprint: fingerprint,
          startedAt: now,
          updatedAt: now,
        });
        return { outcome: 'claimed', requestId, fingerprint } as const;
      }

      if (existing.status === 'completed') {
        if (existing.inputFingerprint === fingerprint) {
          return { outcome: 'cached', result: existing.result } as const;
        }
        // Defensive-only, effectively unreachable: reflections are
        // immutable once submitted, so the fingerprint for a given date
        // can never legitimately change. If it somehow does, the stored
        // result no longer corresponds to the current inputs — treat the
        // same as "no row" and overwrite with a fresh claim.
        const requestId = randomUUID();
        await tx
          .update(studyDayComparisons)
          .set({
            requestId,
            status: 'processing',
            model,
            inputFingerprint: fingerprint,
            result: null,
            errorCode: null,
            startedAt: now,
            completedAt: null,
            updatedAt: now,
          })
          .where(eq(studyDayComparisons.studyDate, studyDate));
        return { outcome: 'claimed', requestId, fingerprint } as const;
      }

      if (existing.status === 'processing') {
        return { outcome: 'in_progress' } as const;
      }

      if (existing.status === 'reconciliation_pending') {
        return { outcome: 'reconciliation_pending' } as const;
      }

      // 'failed' — POST /compare must never silently re-claim this; only
      // claimRetry() (via the explicit retry endpoint) may transition it.
      return { outcome: 'failed', errorCode: existing.errorCode } as const;
    });
  }

  async completeGeneration(studyDate: string, requestId: string, result: unknown): Promise<void> {
    const now = new Date();
    await this.db
      .update(studyDayComparisons)
      .set({ status: 'completed', result, errorCode: null, completedAt: now, updatedAt: now })
      .where(
        and(
          eq(studyDayComparisons.studyDate, studyDate),
          eq(studyDayComparisons.requestId, requestId),
        ),
      );
  }

  async failGeneration(studyDate: string, requestId: string, errorCode: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(studyDayComparisons)
      .set({ status: 'failed', errorCode, updatedAt: now })
      .where(
        and(
          eq(studyDayComparisons.studyDate, studyDate),
          eq(studyDayComparisons.requestId, requestId),
        ),
      );
  }

  async markReconciliationPending(
    studyDate: string,
    requestId: string,
    errorCode: string,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(studyDayComparisons)
      .set({ status: 'reconciliation_pending', errorCode, updatedAt: now })
      .where(
        and(
          eq(studyDayComparisons.studyDate, studyDate),
          eq(studyDayComparisons.requestId, requestId),
        ),
      );
  }

  async getByDate(studyDate: string): Promise<StudyDayComparisonRow | null> {
    const [row] = await this.db
      .select()
      .from(studyDayComparisons)
      .where(eq(studyDayComparisons.studyDate, studyDate));
    return row ? toRow(row) : null;
  }

  async claimRetry(studyDate: string): Promise<ClaimRetryOutcome> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(studyDayComparisons)
        .where(eq(studyDayComparisons.studyDate, studyDate))
        .for('update');

      if (!existing) {
        return { outcome: 'not_started' } as const;
      }
      if (existing.status === 'completed') {
        return { outcome: 'completed' } as const;
      }
      if (existing.status === 'reconciliation_pending') {
        return { outcome: 'reconciliation_pending' } as const;
      }
      if (existing.status === 'processing') {
        return { outcome: 'processing' } as const;
      }

      // 'failed', still true under the lock — this caller wins the retry.
      const requestId = randomUUID();
      const now = new Date();
      await tx
        .update(studyDayComparisons)
        .set({
          requestId,
          status: 'processing',
          errorCode: null,
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(studyDayComparisons.studyDate, studyDate),
            eq(studyDayComparisons.status, 'failed'),
          ),
        );

      return { outcome: 'claimed', requestId } as const;
    });
  }

  async findStaleProcessing(
    olderThanMs: number,
    now: Date = new Date(),
  ): Promise<StudyDayComparisonRow[]> {
    const threshold = new Date(now.getTime() - olderThanMs);
    const rows = await this.db
      .select()
      .from(studyDayComparisons)
      .where(
        and(
          eq(studyDayComparisons.status, 'processing'),
          lt(studyDayComparisons.startedAt, threshold),
        ),
      );
    return rows.map(toRow);
  }
}
