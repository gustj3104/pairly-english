import { getFeatureModelConfig } from '../mindlogic/feature-config.js';
import { discussionFeedbackResultSchema } from './schema.js';
import type {
  DiscussionFeedbackRepository,
  SaveTranscriptInput,
  SaveTranscriptResult,
} from './discussion-feedback-repository.js';
import type { ClaimFeedbackOutcome, TranscriptSegment } from './types.js';

const FEATURE = 'grammar_feedback' as const;

export interface TranscriptView {
  studyDate: string;
  topicIndex: number | null;
  segments: TranscriptSegment[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export type SaveTranscriptOutcome =
  { ok: true; transcript: TranscriptView } | { ok: false; reason: 'study_day_not_found' };

export type FeedbackReadResult =
  | { status: 'not_started' }
  | { status: 'processing' }
  | {
      status: 'completed';
      result: ReturnType<typeof discussionFeedbackResultSchema.parse>;
      stale: boolean;
    }
  | { status: 'failed'; errorCode: string | null }
  | { status: 'reconciliation_pending' }
  /** A stored 'completed' row's result no longer validates against the schema. */
  | { status: 'corrupted' };

/**
 * Thin service wrapping DiscussionFeedbackRepository, mirroring
 * ComparisonService's split from ComparisonRepository — independent
 * schema re-validation at both the write boundary (immediately before
 * persisting a 'completed' feedback result) and the read boundary
 * (GET .../discussion/feedback), plus resolving the feature's configured
 * model so the route never needs to import mindlogic/feature-config.js.
 * Deliberately never calls Mindlogic or the credit service itself — see
 * src/routes/discussion-feedback.ts for the orchestration that ties this,
 * generateDiscussionFeedback(), and the credit/Mindlogic clients together.
 */
export class DiscussionFeedbackService {
  constructor(private readonly repository: DiscussionFeedbackRepository) {}

  async getTranscript(studyDate: string): Promise<TranscriptView> {
    const row = await this.repository.getTranscript(studyDate);
    return {
      studyDate,
      topicIndex: row?.topicIndex ?? null,
      segments: row?.segments ?? [],
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  async saveTranscript(input: SaveTranscriptInput): Promise<SaveTranscriptOutcome> {
    const result: SaveTranscriptResult = await this.repository.saveTranscript(input);
    if (!result.ok) return result;
    return {
      ok: true,
      transcript: {
        studyDate: result.row.studyDate,
        topicIndex: result.row.topicIndex,
        segments: result.row.segments,
        updatedAt: result.row.updatedAt?.toISOString() ?? null,
        updatedBy: result.row.updatedBy,
      },
    };
  }

  async getFeedback(studyDate: string): Promise<FeedbackReadResult> {
    const snapshot = await this.repository.getFeedbackReadSnapshot(studyDate);
    const row = snapshot.feedback;
    if (!row || row.status === null) return { status: 'not_started' };
    if (row.status === 'processing') return { status: 'processing' };
    if (row.status === 'reconciliation_pending') return { status: 'reconciliation_pending' };
    if (row.status === 'failed') return { status: 'failed', errorCode: row.errorCode };

    // 'completed' — read-side validation, independent of the write-side
    // check in completeFeedback below.
    const parsed = discussionFeedbackResultSchema.safeParse(row.result);
    if (!parsed.success) return { status: 'corrupted' };

    const stale =
      snapshot.currentInputFingerprint === null ||
      row.inputFingerprint !== snapshot.currentInputFingerprint;

    return { status: 'completed', result: parsed.data, stale };
  }

  claimFeedbackGeneration(studyDate: string): Promise<ClaimFeedbackOutcome> {
    const { model } = getFeatureModelConfig(FEATURE);
    return this.repository.claimFeedbackGeneration(studyDate, model);
  }

  /**
   * Immediately re-validates before persisting — defense in depth on top
   * of the validation generateDiscussionFeedback() already did (mirrors
   * ComparisonService.completeWithResult).
   */
  async completeFeedback(studyDate: string, requestId: string, result: unknown): Promise<void> {
    const parsed = discussionFeedbackResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new Error(
        'discussionFeedbackResultSchema re-validation failed immediately before persisting a completed study_day_discussions feedback row',
      );
    }
    return this.repository.completeFeedback(studyDate, requestId, parsed.data);
  }

  failFeedback(studyDate: string, requestId: string, errorCode: string): Promise<void> {
    return this.repository.failFeedback(studyDate, requestId, errorCode);
  }

  markFeedbackReconciliationPending(
    studyDate: string,
    requestId: string,
    errorCode: string,
  ): Promise<void> {
    return this.repository.markFeedbackReconciliationPending(studyDate, requestId, errorCode);
  }
}
