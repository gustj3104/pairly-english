import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  reflections,
  studyDayComparisons,
  studyDayDiscussions,
  studyDays,
} from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import type { DiscussionFeedbackResultJson } from '../../db/schema.js';
import { ALLOWED_PARTICIPANT_KEYS } from '../auth/allowed-participants.js';
import { computeInputFingerprint } from '../daily-reflections/comparison-fingerprint.js';
import { reflectionComparisonSchema } from '../reflections/schema.js';
import { computeFeedbackInputFingerprint, computeTranscriptFingerprint } from './fingerprint.js';
import type {
  ClaimFeedbackOutcome,
  FeedbackPromptInputs,
  FeedbackRow,
  FeedbackStatus,
  TranscriptRow,
  TranscriptSegment,
} from './types.js';

type Db = NodePgDatabase<typeof schema>;
type DiscussionRow = typeof studyDayDiscussions.$inferSelect;
type StudyDayRow = typeof studyDays.$inferSelect;
type ReflectionRowRaw = typeof reflections.$inferSelect;
type ComparisonRow = typeof studyDayComparisons.$inferSelect;

export interface SaveTranscriptInput {
  studyDate: string;
  segments: TranscriptSegment[];
  topicIndex: number;
  updatedBy: string;
  now: Date;
}

export type SaveTranscriptResult =
  { ok: true; row: TranscriptRow } | { ok: false; reason: 'study_day_not_found' };

export interface FeedbackReadSnapshot {
  feedback: FeedbackRow | null;
  /**
   * The current expected feedbackInputFingerprint, recomputed from live
   * article/topic/transcript state — or null if it cannot currently be
   * computed at all (no transcript yet, comparison not completed/stale,
   * topic mismatch, etc.), which the caller treats as "definitely stale"
   * relative to any existing completed row.
   */
  currentInputFingerprint: string | null;
}

function toTranscriptRow(row: DiscussionRow): TranscriptRow {
  return {
    studyDate: row.studyDate,
    segments: row.transcript?.segments ?? [],
    topicIndex: row.topicIndex,
    transcriptFingerprint: row.transcriptFingerprint,
    updatedAt: row.transcriptUpdatedAt,
    updatedBy: row.transcriptUpdatedBy,
  };
}

function toFeedbackRow(row: DiscussionRow): FeedbackRow {
  return {
    studyDate: row.studyDate,
    requestId: row.requestId,
    status: row.status as FeedbackStatus | null,
    model: row.model,
    inputFingerprint: row.inputFingerprint,
    result: row.result,
    errorCode: row.errorCode,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

type ResolvedFeedbackContext =
  | {
      ready: false;
      reason:
        | 'no_transcript'
        | 'unassigned_segments'
        | 'single_speaker_only'
        | 'topic_not_ready'
        | 'topic_changed';
    }
  | { ready: true; fingerprint: string; promptInputs: FeedbackPromptInputs };

/**
 * Pure function (no I/O) shared by claimFeedbackGeneration (given rows
 * read under its own lock) and getFeedbackReadSnapshot (given a plain
 * read) — resolves "are the real inputs for feedback generation currently
 * ready, and if so what fingerprint/promptInputs do they produce" without
 * ever writing to study_day_comparisons or altering its result shape.
 */
function resolveFeedbackContext(input: {
  day: StudyDayRow | undefined;
  reflectionRows: ReflectionRowRaw[];
  comparison: ComparisonRow | undefined;
  discussionRow: DiscussionRow | undefined;
}): ResolvedFeedbackContext {
  const segments = input.discussionRow?.transcript?.segments ?? [];
  if (segments.length === 0) {
    return { ready: false, reason: 'no_transcript' };
  }
  if (segments.some((segment) => segment.speakerKey === null)) {
    return { ready: false, reason: 'unassigned_segments' };
  }
  const presentKeys = new Set(segments.map((segment) => segment.speakerKey as string));
  if (!ALLOWED_PARTICIPANT_KEYS.every((key) => presentKeys.has(key))) {
    return { ready: false, reason: 'single_speaker_only' };
  }

  const { day, reflectionRows, comparison, discussionRow } = input;
  if (!day || !comparison || comparison.status !== 'completed' || reflectionRows.length !== 2) {
    return { ready: false, reason: 'topic_not_ready' };
  }

  const comparisonFingerprint = computeInputFingerprint(
    day.articleId,
    reflectionRows.map((row) => ({ participantKey: row.participantKey, content: row.content })),
  );
  if (comparison.inputFingerprint !== comparisonFingerprint) {
    return { ready: false, reason: 'topic_not_ready' };
  }

  const parsedComparison = reflectionComparisonSchema.safeParse(comparison.result);
  if (!parsedComparison.success) {
    return { ready: false, reason: 'topic_not_ready' };
  }
  const selectedTopicIndex = parsedComparison.data.selectedTopicIndex;
  if (
    selectedTopicIndex === undefined ||
    discussionRow?.topicIndex === null ||
    discussionRow?.topicIndex === undefined
  ) {
    return { ready: false, reason: 'topic_not_ready' };
  }
  if (selectedTopicIndex !== discussionRow.topicIndex) {
    return { ready: false, reason: 'topic_changed' };
  }
  const topic = parsedComparison.data.topics[selectedTopicIndex];
  if (!topic || !topic.discussionGuide) {
    return { ready: false, reason: 'topic_not_ready' };
  }

  const participants = ALLOWED_PARTICIPANT_KEYS.filter((key) => presentKeys.has(key)).map((key) => {
    const reflection = reflectionRows.find((row) => row.participantKey === key);
    return { participantKey: key, displayName: reflection?.displayName ?? key };
  });

  const transcriptFingerprint =
    discussionRow?.transcriptFingerprint ?? computeTranscriptFingerprint(segments);
  const fingerprint = computeFeedbackInputFingerprint({
    articleId: day.articleId,
    topicQuestion: topic.question,
    discussionGuide: topic.discussionGuide,
    transcriptFingerprint,
    participantKeys: [...presentKeys],
  });

  return {
    ready: true,
    fingerprint,
    promptInputs: {
      articleTitle: day.articleTitle,
      articleSummary: day.articleSummary,
      topicQuestion: topic.question,
      discussionGuide: topic.discussionGuide,
      participants,
      segments,
    },
  };
}

/**
 * Storage-agnostic contract for the discussion-transcript + feedback
 * feature. Mirrors ComparisonRepository's split-interface pattern (see
 * comparison-repository.ts) so unit tests can inject an in-memory fake
 * (tests/helpers/in-memory-discussion-feedback-repository.ts) while
 * integration tests exercise DrizzleDiscussionFeedbackRepository against
 * real PostgreSQL. Never touches study_day_comparisons or its `result`
 * shape — only reads it to validate readiness/topic-match.
 */
export interface DiscussionFeedbackRepository {
  getTranscript(studyDate: string): Promise<TranscriptRow | null>;
  saveTranscript(input: SaveTranscriptInput): Promise<SaveTranscriptResult>;

  /** Pure read for GET .../discussion/feedback — never calls Mindlogic, never reserves credits. */
  getFeedbackReadSnapshot(studyDate: string): Promise<FeedbackReadSnapshot>;

  /**
   * One short transaction, never held across the Mindlogic call:
   *  1. Lock (creating if missing) study_day_discussions for this date —
   *     serializes concurrent POST .../feedback claims for the same date.
   *  2. Validate preconditions: a transcript exists with every segment
   *     speaker-assigned and both ALLOWED_PARTICIPANT_KEYS present; the
   *     corresponding study_day_comparisons row is completed, not stale,
   *     and its selectedTopicIndex matches the transcript's topicIndex.
   *  3. Compute the feedbackInputFingerprint from real article/topic/
   *     transcript data.
   *  4. Branch: matching-fingerprint completed row => 'cached';
   *     'processing' => 'in_progress'; 'reconciliation_pending' =>
   *     'reconciliation_pending'; otherwise (never started, 'failed', or
   *     'completed'-but-stale) => fresh 'processing' claim ('claimed'),
   *     which also assembles the real prompt inputs (article title/
   *     summary, selected topic question + discussion guide, both real
   *     displayNames, and the transcript segments).
   *
   * Unlike ComparisonRepository, a 'failed' row here IS reclaimed by this
   * same claim (there is no separate POST .../feedback/retry endpoint) —
   * 'reconciliation_pending' is still never auto-reclaimed.
   */
  claimFeedbackGeneration(studyDate: string, model: string): Promise<ClaimFeedbackOutcome>;

  completeFeedback(studyDate: string, requestId: string, result: unknown): Promise<void>;
  failFeedback(studyDate: string, requestId: string, errorCode: string): Promise<void>;
  markFeedbackReconciliationPending(
    studyDate: string,
    requestId: string,
    errorCode: string,
  ): Promise<void>;
}

/**
 * PostgreSQL-backed DiscussionFeedbackRepository. Atomicity for
 * claimFeedbackGeneration comes from the same transaction +
 * `SELECT ... FOR UPDATE` pattern as ComparisonRepository.claimGeneration.
 *
 * Covered by tests/integration/discussion-feedback.postgres.test.ts,
 * including a concurrent-POST-/feedback race and a real-CHECK-constraint
 * test, and asserting study_day_comparisons is completely untouched.
 */
export class DrizzleDiscussionFeedbackRepository implements DiscussionFeedbackRepository {
  constructor(private readonly db: Db) {}

  async getTranscript(studyDate: string): Promise<TranscriptRow | null> {
    const [row] = await this.db
      .select()
      .from(studyDayDiscussions)
      .where(eq(studyDayDiscussions.studyDate, studyDate));
    return row ? toTranscriptRow(row) : null;
  }

  async saveTranscript(input: SaveTranscriptInput): Promise<SaveTranscriptResult> {
    return this.db.transaction(async (tx) => {
      const [day] = await tx
        .select({ studyDate: studyDays.studyDate })
        .from(studyDays)
        .where(eq(studyDays.studyDate, input.studyDate))
        .for('share');
      if (!day) {
        return { ok: false, reason: 'study_day_not_found' } as const;
      }

      const transcriptFingerprint = computeTranscriptFingerprint(input.segments);
      const values = {
        studyDate: input.studyDate,
        transcript: { segments: input.segments },
        transcriptUpdatedAt: input.now,
        transcriptUpdatedBy: input.updatedBy,
        transcriptFingerprint,
        topicIndex: input.topicIndex,
        updatedAt: input.now,
      };

      const [row] = await tx
        .insert(studyDayDiscussions)
        .values(values)
        .onConflictDoUpdate({
          target: studyDayDiscussions.studyDate,
          // Deliberately only the transcript columns — feedback_* columns
          // (and any in-flight/completed feedback) are left completely
          // untouched by a transcript save. Staleness surfaces on read via
          // fingerprint comparison, never by deleting old feedback here.
          set: {
            transcript: values.transcript,
            transcriptUpdatedAt: values.transcriptUpdatedAt,
            transcriptUpdatedBy: values.transcriptUpdatedBy,
            transcriptFingerprint: values.transcriptFingerprint,
            topicIndex: values.topicIndex,
            updatedAt: values.updatedAt,
          },
        })
        .returning();

      if (!row) {
        throw new Error(`study_day_discussions row for ${input.studyDate} could not be upserted`);
      }

      return { ok: true, row: toTranscriptRow(row) } as const;
    });
  }

  async getFeedbackReadSnapshot(studyDate: string): Promise<FeedbackReadSnapshot> {
    const [row] = await this.db
      .select()
      .from(studyDayDiscussions)
      .where(eq(studyDayDiscussions.studyDate, studyDate));
    const [day] = await this.db.select().from(studyDays).where(eq(studyDays.studyDate, studyDate));
    const reflectionRows = await this.db
      .select()
      .from(reflections)
      .where(eq(reflections.studyDate, studyDate));
    const [comparison] = await this.db
      .select()
      .from(studyDayComparisons)
      .where(eq(studyDayComparisons.studyDate, studyDate));

    const context = resolveFeedbackContext({ day, reflectionRows, comparison, discussionRow: row });

    return {
      feedback: row ? toFeedbackRow(row) : null,
      currentInputFingerprint: context.ready ? context.fingerprint : null,
    };
  }

  async claimFeedbackGeneration(studyDate: string, model: string): Promise<ClaimFeedbackOutcome> {
    return this.db.transaction(async (tx) => {
      await tx.insert(studyDayDiscussions).values({ studyDate }).onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(studyDayDiscussions)
        .where(eq(studyDayDiscussions.studyDate, studyDate))
        .for('update');

      if (!row) {
        throw new Error(`study_day_discussions row for ${studyDate} could not be created`);
      }

      const [day] = await tx.select().from(studyDays).where(eq(studyDays.studyDate, studyDate));
      const reflectionRows = await tx
        .select()
        .from(reflections)
        .where(eq(reflections.studyDate, studyDate));
      const [comparison] = await tx
        .select()
        .from(studyDayComparisons)
        .where(eq(studyDayComparisons.studyDate, studyDate));

      const context = resolveFeedbackContext({
        day,
        reflectionRows,
        comparison,
        discussionRow: row,
      });
      if (!context.ready) {
        return { outcome: context.reason } as const;
      }

      if (row.status === 'completed' && row.inputFingerprint === context.fingerprint) {
        return { outcome: 'cached', result: row.result } as const;
      }
      if (row.status === 'processing') {
        return { outcome: 'in_progress' } as const;
      }
      if (row.status === 'reconciliation_pending') {
        return { outcome: 'reconciliation_pending' } as const;
      }

      // Never started, 'failed', or 'completed'-but-stale (fingerprint
      // mismatch) — all three claim a fresh 'processing' attempt.
      const requestId = randomUUID();
      const now = new Date();
      await tx
        .update(studyDayDiscussions)
        .set({
          requestId,
          status: 'processing',
          model,
          inputFingerprint: context.fingerprint,
          result: null,
          errorCode: null,
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        })
        .where(eq(studyDayDiscussions.studyDate, studyDate));

      return {
        outcome: 'claimed',
        requestId,
        fingerprint: context.fingerprint,
        promptInputs: context.promptInputs,
      } as const;
    });
  }

  async completeFeedback(studyDate: string, requestId: string, result: unknown): Promise<void> {
    const now = new Date();
    await this.db
      .update(studyDayDiscussions)
      .set({
        status: 'completed',
        result: result as DiscussionFeedbackResultJson,
        errorCode: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(studyDayDiscussions.studyDate, studyDate),
          eq(studyDayDiscussions.requestId, requestId),
        ),
      );
  }

  async failFeedback(studyDate: string, requestId: string, errorCode: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(studyDayDiscussions)
      .set({ status: 'failed', errorCode, updatedAt: now })
      .where(
        and(
          eq(studyDayDiscussions.studyDate, studyDate),
          eq(studyDayDiscussions.requestId, requestId),
        ),
      );
  }

  async markFeedbackReconciliationPending(
    studyDate: string,
    requestId: string,
    errorCode: string,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(studyDayDiscussions)
      .set({ status: 'reconciliation_pending', errorCode, updatedAt: now })
      .where(
        and(
          eq(studyDayDiscussions.studyDate, studyDate),
          eq(studyDayDiscussions.requestId, requestId),
        ),
      );
  }
}
