import type { DiscussionTranscriptSegmentJson } from '../../db/schema.js';

export type TranscriptSegment = DiscussionTranscriptSegmentJson;

export interface TranscriptPayload {
  segments: TranscriptSegment[];
}

export type FeedbackStatus = 'processing' | 'completed' | 'failed' | 'reconciliation_pending';

/** Read-only view of a study_day_discussions row's transcript columns. */
export interface TranscriptRow {
  studyDate: string;
  segments: TranscriptSegment[];
  topicIndex: number | null;
  transcriptFingerprint: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** Read-only view of a study_day_discussions row's feedback columns. */
export interface FeedbackRow {
  studyDate: string;
  requestId: string | null;
  status: FeedbackStatus | null;
  model: string | null;
  inputFingerprint: string | null;
  /** Raw, unvalidated JSONB as read from the DB — callers must re-validate before trusting it. */
  result: unknown;
  errorCode: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** Everything a feedback-generation prompt needs, assembled from real stored data (never client-supplied). */
export interface FeedbackPromptInputs {
  articleTitle: string;
  articleSummary: string | null;
  topicQuestion: string;
  discussionGuide: { openingQuestion: string; followUpQuestions: string[] };
  /** Exactly the participant keys present among the transcript's segments, each with their real displayName. */
  participants: { participantKey: 'hyeonseo' | 'hyunji'; displayName: string }[];
  segments: TranscriptSegment[];
}

export type ClaimFeedbackOutcome =
  | { outcome: 'no_transcript' }
  | { outcome: 'unassigned_segments' }
  | { outcome: 'single_speaker_only' }
  | { outcome: 'topic_not_ready' }
  | { outcome: 'topic_changed' }
  | { outcome: 'in_progress' }
  // Never auto-reclaimed by POST /feedback (mirrors the codebase's
  // universal reconciliation_pending rule) — an operator must resolve it.
  | { outcome: 'reconciliation_pending' }
  /** Raw, unvalidated JSONB — see FeedbackRow.result. */
  | { outcome: 'cached'; result: unknown }
  | {
      outcome: 'claimed';
      requestId: string;
      fingerprint: string;
      promptInputs: FeedbackPromptInputs;
    };
