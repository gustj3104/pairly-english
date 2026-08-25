import { createHash } from 'node:crypto';
import type { TranscriptSegment } from './types.js';

/**
 * Deterministic, irreversible (SHA-256) fingerprint of a transcript's
 * segments — used to detect whether a saved transcript has changed since
 * feedback was last generated for it (see comparison-fingerprint.ts for
 * the equivalent pattern on study_day_comparisons). Field order in the
 * canonical object is fixed explicitly (not just "whatever JSON.stringify
 * does to the segment object") so this never silently drifts if
 * TranscriptSegment's field order changes.
 */
export function computeTranscriptFingerprint(segments: TranscriptSegment[]): string {
  const canonical = JSON.stringify(
    segments.map((segment) => ({
      id: segment.id,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      speakerKey: segment.speakerKey,
    })),
  );
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface FeedbackFingerprintInput {
  articleId: string;
  topicQuestion: string;
  discussionGuide: { openingQuestion: string; followUpQuestions: string[] };
  transcriptFingerprint: string;
  participantKeys: string[];
}

/**
 * Deterministic, irreversible fingerprint of "the exact inputs that would
 * be sent to Mindlogic for this date's discussion feedback": the article
 * id, the selected topic's question + discussion guide, the transcript's
 * own fingerprint, and the sorted set of participant keys. Sorting
 * participantKeys guarantees order-independence, mirroring
 * comparison-fingerprint.ts's sort-before-hash rationale.
 */
export function computeFeedbackInputFingerprint(input: FeedbackFingerprintInput): string {
  const canonical = JSON.stringify({
    articleId: input.articleId,
    topicQuestion: input.topicQuestion,
    discussionGuide: {
      openingQuestion: input.discussionGuide.openingQuestion,
      followUpQuestions: [...input.discussionGuide.followUpQuestions],
    },
    transcriptFingerprint: input.transcriptFingerprint,
    participantKeys: [...input.participantKeys].sort(),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
