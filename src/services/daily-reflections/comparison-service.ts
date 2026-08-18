import { getFeatureModelConfig } from '../mindlogic/feature-config.js';
import { reflectionComparisonSchema } from '../reflections/schema.js';
import type { ReflectionComparisonResult } from '../reflections/schema.js';
import { computeInputFingerprint } from './comparison-fingerprint.js';
import type { ComparisonRepository, StudyDayComparisonRow } from './comparison-repository.js';

const FEATURE = 'reflection_comparison' as const;

export type ComparisonClaimOutcome =
  | { outcome: 'partner_not_ready' }
  | { outcome: 'claimed'; requestId: string }
  | { outcome: 'cached'; result: ReflectionComparisonResult }
  /** A stored 'completed' row's result no longer validates against the schema. */
  | { outcome: 'cached_corrupted' }
  | { outcome: 'in_progress' }
  | { outcome: 'reconciliation_pending' }
  | { outcome: 'failed'; errorCode: string | null };

export type ComparisonRetryClaimOutcome =
  | { outcome: 'not_started' }
  | { outcome: 'processing' }
  | { outcome: 'completed' }
  | { outcome: 'reconciliation_pending' }
  | { outcome: 'claimed'; requestId: string };

export type ComparisonReadResult =
  | { status: 'not_started' }
  | { status: 'processing' }
  | { status: 'completed'; result: ReflectionComparisonResult }
  | { status: 'failed'; errorCode: string | null }
  | { status: 'reconciliation_pending' }
  /** A stored 'completed' row's result no longer validates against the schema. */
  | { status: 'corrupted' };

/**
 * Thin service wrapping ComparisonRepository, mirroring DailyReflectionService's
 * split from DailyReflectionRepository — except this wrapper does real work
 * beyond pass-through: independent schema (re-)validation at both the
 * write boundary (immediately before persisting a 'completed' result —
 * defense in depth, on top of the validation compareReflections() already
 * did) and the read boundary ("read-side validation", independent of the
 * write-side check — see README "Study-day comparison"), plus resolving
 * the feature's configured model so callers/routes never need to import
 * mindlogic/feature-config.js themselves.
 */
export class ComparisonService {
  constructor(private readonly repository: ComparisonRepository) {}

  async claimGeneration(studyDate: string): Promise<ComparisonClaimOutcome> {
    const { model } = getFeatureModelConfig(FEATURE);
    const claim = await this.repository.claimGeneration(
      studyDate,
      model,
      ({ articleId, reflections }) => computeInputFingerprint(articleId, reflections),
    );

    switch (claim.outcome) {
      case 'partner_not_ready':
        return { outcome: 'partner_not_ready' };
      case 'claimed':
        return { outcome: 'claimed', requestId: claim.requestId };
      case 'in_progress':
        return { outcome: 'in_progress' };
      case 'reconciliation_pending':
        return { outcome: 'reconciliation_pending' };
      case 'failed':
        return { outcome: 'failed', errorCode: claim.errorCode };
      case 'cached': {
        const parsed = reflectionComparisonSchema.safeParse(claim.result);
        if (!parsed.success) {
          return { outcome: 'cached_corrupted' };
        }
        return { outcome: 'cached', result: parsed.data };
      }
    }
  }

  /**
   * Immediately re-validates before persisting — never trust a single
   * validation pass crossing a storage boundary (matches this codebase's
   * existing philosophy elsewhere, e.g. reflectionComparisonSchema itself
   * re-validating Mindlogic's structured-output response independent of
   * the request-side JSON Schema). Throws if validation somehow fails
   * here (it already passed once inside compareReflections(), so this is
   * a defense-in-depth backstop, not an expected path) rather than
   * silently persisting an unvalidated blob.
   */
  async completeWithResult(
    studyDate: string,
    requestId: string,
    result: ReflectionComparisonResult,
  ): Promise<void> {
    // Declared `async` deliberately (not a plain function returning
    // `this.repository...`) so a validation failure becomes a REJECTED
    // promise, matching this method's `Promise<void>` contract — a
    // synchronous throw here would otherwise escape immediately rather
    // than surfacing through `await`/`.catch()` the way every caller
    // expects.
    const parsed = reflectionComparisonSchema.safeParse(result);
    if (!parsed.success) {
      throw new Error(
        'reflectionComparisonSchema re-validation failed immediately before persisting a completed study_day_comparisons row',
      );
    }
    return this.repository.completeGeneration(studyDate, requestId, parsed.data);
  }

  completeWithFailure(studyDate: string, requestId: string, errorCode: string): Promise<void> {
    return this.repository.failGeneration(studyDate, requestId, errorCode);
  }

  completeWithReconciliationPending(
    studyDate: string,
    requestId: string,
    errorCode: string,
  ): Promise<void> {
    return this.repository.markReconciliationPending(studyDate, requestId, errorCode);
  }

  async getComparison(studyDate: string): Promise<ComparisonReadResult> {
    const row = await this.repository.getByDate(studyDate);
    if (!row) return { status: 'not_started' };
    if (row.status === 'processing') return { status: 'processing' };
    if (row.status === 'reconciliation_pending') return { status: 'reconciliation_pending' };
    if (row.status === 'failed') return { status: 'failed', errorCode: row.errorCode };

    // 'completed' — read-side validation, independent of the write-side
    // check in completeWithResult above.
    const parsed = reflectionComparisonSchema.safeParse(row.result);
    if (!parsed.success) return { status: 'corrupted' };
    return { status: 'completed', result: parsed.data };
  }

  async claimRetry(studyDate: string): Promise<ComparisonRetryClaimOutcome> {
    const claim = await this.repository.claimRetry(studyDate);
    switch (claim.outcome) {
      case 'not_started':
        return { outcome: 'not_started' };
      case 'processing':
        return { outcome: 'processing' };
      case 'completed':
        return { outcome: 'completed' };
      case 'reconciliation_pending':
        return { outcome: 'reconciliation_pending' };
      case 'claimed':
        return { outcome: 'claimed', requestId: claim.requestId };
    }
  }

  /** Purely informational — see ComparisonRepository.findStaleProcessing. */
  findStaleProcessing(olderThanMs: number, now?: Date): Promise<StudyDayComparisonRow[]> {
    return this.repository.findStaleProcessing(olderThanMs, now);
  }
}
