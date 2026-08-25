import { randomUUID } from 'node:crypto';
import { ALLOWED_PARTICIPANT_KEYS } from '../../src/services/auth/allowed-participants.js';
import { computeInputFingerprint } from '../../src/services/daily-reflections/comparison-fingerprint.js';
import { reflectionComparisonSchema } from '../../src/services/reflections/schema.js';
import {
  computeFeedbackInputFingerprint,
  computeTranscriptFingerprint,
} from '../../src/services/discussion-feedback/fingerprint.js';
import type {
  DiscussionFeedbackRepository,
  FeedbackReadSnapshot,
  SaveTranscriptInput,
  SaveTranscriptResult,
} from '../../src/services/discussion-feedback/discussion-feedback-repository.js';
import type {
  ClaimFeedbackOutcome,
  FeedbackPromptInputs,
  FeedbackRow,
  FeedbackStatus,
  TranscriptRow,
  TranscriptSegment,
} from '../../src/services/discussion-feedback/types.js';
import type { InMemoryDailyReflectionRepository } from './in-memory-daily-reflection-repository.js';
import type { InMemoryComparisonRepository } from './in-memory-comparison-repository.js';

interface DiscussionRowState {
  studyDate: string;
  segments: TranscriptSegment[];
  topicIndex: number | null;
  transcriptFingerprint: string | null;
  transcriptUpdatedAt: Date | null;
  transcriptUpdatedBy: string | null;
  requestId: string | null;
  status: FeedbackStatus | null;
  model: string | null;
  inputFingerprint: string | null;
  result: unknown;
  errorCode: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

type ResolvedContext =
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

function emptyRow(studyDate: string): DiscussionRowState {
  return {
    studyDate,
    segments: [],
    topicIndex: null,
    transcriptFingerprint: null,
    transcriptUpdatedAt: null,
    transcriptUpdatedBy: null,
    requestId: null,
    status: null,
    model: null,
    inputFingerprint: null,
    result: null,
    errorCode: null,
    startedAt: null,
    completedAt: null,
  };
}

function toTranscriptRow(row: DiscussionRowState): TranscriptRow {
  return {
    studyDate: row.studyDate,
    segments: row.segments,
    topicIndex: row.topicIndex,
    transcriptFingerprint: row.transcriptFingerprint,
    updatedAt: row.transcriptUpdatedAt,
    updatedBy: row.transcriptUpdatedBy,
  };
}

function toFeedbackRow(row: DiscussionRowState): FeedbackRow {
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
  };
}

/**
 * Plain in-memory fake of DiscussionFeedbackRepository used to unit-test
 * the HTTP layer and generateDiscussionFeedback()'s guards — mirrors
 * InMemoryComparisonRepository. Reads the SAME
 * InMemoryDailyReflectionRepository/InMemoryComparisonRepository instances
 * a test's other services are backed by, so "comparison completed and not
 * stale" reflects real fake state instead of needing to be duplicated by
 * hand.
 *
 * This does NOT substitute for a real PostgreSQL transaction/locking
 * integration test — see
 * tests/integration/discussion-feedback.postgres.test.ts for that.
 */
export class InMemoryDiscussionFeedbackRepository implements DiscussionFeedbackRepository {
  private readonly rows = new Map<string, DiscussionRowState>();

  constructor(
    private readonly dailyReflectionRepository: InMemoryDailyReflectionRepository,
    private readonly comparisonRepository: InMemoryComparisonRepository,
  ) {}

  private ensureRow(studyDate: string): DiscussionRowState {
    let row = this.rows.get(studyDate);
    if (!row) {
      row = emptyRow(studyDate);
      this.rows.set(studyDate, row);
    }
    return row;
  }

  async getTranscript(studyDate: string): Promise<TranscriptRow | null> {
    const row = this.rows.get(studyDate);
    return row ? toTranscriptRow(row) : null;
  }

  async saveTranscript(input: SaveTranscriptInput): Promise<SaveTranscriptResult> {
    const article = await this.dailyReflectionRepository.getStudyDayArticle(input.studyDate);
    if (!article) {
      return { ok: false, reason: 'study_day_not_found' };
    }
    const row = this.ensureRow(input.studyDate);
    row.segments = input.segments;
    row.topicIndex = input.topicIndex;
    row.transcriptUpdatedAt = input.now;
    row.transcriptUpdatedBy = input.updatedBy;
    row.transcriptFingerprint = computeTranscriptFingerprint(input.segments);
    return { ok: true, row: toTranscriptRow(row) };
  }

  private async resolveContext(studyDate: string): Promise<ResolvedContext> {
    const row = this.rows.get(studyDate);
    const segments = row?.segments ?? [];
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

    const article = await this.dailyReflectionRepository.getStudyDayArticle(studyDate);
    const reflectionRows = await this.dailyReflectionRepository.getReflectionsForDate(studyDate);
    const comparison = await this.comparisonRepository.getByDate(studyDate);

    if (
      !article ||
      !comparison ||
      comparison.status !== 'completed' ||
      reflectionRows.length !== 2
    ) {
      return { ready: false, reason: 'topic_not_ready' };
    }

    const comparisonFingerprint = computeInputFingerprint(
      article.id,
      reflectionRows.map((r) => ({ participantKey: r.participantKey, content: r.content })),
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
      row?.topicIndex === null ||
      row?.topicIndex === undefined
    ) {
      return { ready: false, reason: 'topic_not_ready' };
    }
    if (selectedTopicIndex !== row.topicIndex) {
      return { ready: false, reason: 'topic_changed' };
    }
    const topic = parsedComparison.data.topics[selectedTopicIndex];
    if (!topic || !topic.discussionGuide) {
      return { ready: false, reason: 'topic_not_ready' };
    }

    const participants = ALLOWED_PARTICIPANT_KEYS.filter((key) => presentKeys.has(key)).map(
      (key) => {
        const reflection = reflectionRows.find((r) => r.participantKey === key);
        return { participantKey: key, displayName: reflection?.displayName ?? key };
      },
    );

    const transcriptFingerprint =
      row?.transcriptFingerprint ?? computeTranscriptFingerprint(segments);
    const fingerprint = computeFeedbackInputFingerprint({
      articleId: article.id,
      topicQuestion: topic.question,
      discussionGuide: topic.discussionGuide,
      transcriptFingerprint,
      participantKeys: [...presentKeys],
    });

    return {
      ready: true,
      fingerprint,
      promptInputs: {
        articleTitle: article.title,
        articleSummary: article.summary,
        topicQuestion: topic.question,
        discussionGuide: topic.discussionGuide,
        participants,
        segments,
      },
    };
  }

  async getFeedbackReadSnapshot(studyDate: string): Promise<FeedbackReadSnapshot> {
    const row = this.rows.get(studyDate);
    const context = await this.resolveContext(studyDate);
    return {
      feedback: row ? toFeedbackRow(row) : null,
      currentInputFingerprint: context.ready ? context.fingerprint : null,
    };
  }

  async claimFeedbackGeneration(studyDate: string, model: string): Promise<ClaimFeedbackOutcome> {
    const row = this.ensureRow(studyDate);
    const context = await this.resolveContext(studyDate);
    if (!context.ready) {
      return { outcome: context.reason };
    }
    if (row.status === 'completed' && row.inputFingerprint === context.fingerprint) {
      return { outcome: 'cached', result: row.result };
    }
    if (row.status === 'processing') {
      return { outcome: 'in_progress' };
    }
    if (row.status === 'reconciliation_pending') {
      return { outcome: 'reconciliation_pending' };
    }

    const requestId = randomUUID();
    row.requestId = requestId;
    row.status = 'processing';
    row.model = model;
    row.inputFingerprint = context.fingerprint;
    row.result = null;
    row.errorCode = null;
    row.startedAt = new Date();
    row.completedAt = null;

    return {
      outcome: 'claimed',
      requestId,
      fingerprint: context.fingerprint,
      promptInputs: context.promptInputs,
    };
  }

  async completeFeedback(studyDate: string, requestId: string, result: unknown): Promise<void> {
    const row = this.rows.get(studyDate);
    if (!row || row.requestId !== requestId) return;
    row.status = 'completed';
    row.result = result;
    row.errorCode = null;
    row.completedAt = new Date();
  }

  async failFeedback(studyDate: string, requestId: string, errorCode: string): Promise<void> {
    const row = this.rows.get(studyDate);
    if (!row || row.requestId !== requestId) return;
    row.status = 'failed';
    row.errorCode = errorCode;
  }

  async markFeedbackReconciliationPending(
    studyDate: string,
    requestId: string,
    errorCode: string,
  ): Promise<void> {
    const row = this.rows.get(studyDate);
    if (!row || row.requestId !== requestId) return;
    row.status = 'reconciliation_pending';
    row.errorCode = errorCode;
  }
}
