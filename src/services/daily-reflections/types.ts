export interface StudyDayArticleInput {
  id: string;
  title: string;
  sourceUrl: string | null;
  summary: string | null;
}

export interface StudyDayArticle {
  id: string;
  title: string;
  sourceUrl: string | null;
  summary: string | null;
}

export interface SubmitReflectionInput {
  studyDate: string;
  article: StudyDayArticleInput;
  /** Normalized (trim + NFKC + lowercase) session name — never client-supplied. */
  participantKey: string;
  displayName: string;
  content: string;
  submittedAt: Date;
}

export type SubmitReflectionResult =
  | { ok: true; submittedAt: Date; alreadySubmitted: boolean }
  | { ok: false; reason: 'article_mismatch' }
  | { ok: false; reason: 'participant_limit_reached' };

export interface ReflectionRow {
  studyDate: string;
  participantKey: string;
  displayName: string;
  content: string;
  status: 'submitted';
  submittedAt: Date;
}

export interface DiscussionCompletion {
  completedAt: Date;
  completedBy: string;
}

export type MarkDiscussionCompletedResult =
  { ok: true; completion: DiscussionCompletion } | { ok: false; reason: 'study_day_not_found' };

/**
 * Storage-agnostic contract for the daily-reflection feature. The real
 * implementation (DrizzleDailyReflectionRepository) enforces the
 * max-2-participants-per-day invariant with a PostgreSQL transaction and
 * `SELECT ... FOR UPDATE` row lock on `study_days`, mirroring
 * src/services/credits/credit-repository.ts::reserveCredits. An in-memory
 * fake (tests/helpers/in-memory-daily-reflection-repository.ts)
 * implements the same contract for fast unit tests of the HTTP layer —
 * it does NOT substitute for the real-PostgreSQL concurrency test in
 * tests/integration/study-days.postgres.test.ts.
 */
export interface DailyReflectionRepository {
  /**
   * Runs the full submit algorithm atomically:
   *  1. Ensure the study_days row exists (first submitter's article wins).
   *  2. Lock that row for the rest of this call.
   *  3. Reject with 'article_mismatch' if the locked row's article differs.
   *  4. If this participant already submitted, return that row's
   *     submittedAt idempotently (content is never overwritten).
   *  5. Otherwise, reject with 'participant_limit_reached' once 2 distinct
   *     participants have already submitted for this date.
   *  6. Otherwise, insert the new reflection row.
   */
  submitReflection(input: SubmitReflectionInput): Promise<SubmitReflectionResult>;
  getReflectionsForDate(studyDate: string): Promise<ReflectionRow[]>;
  getStudyDayArticle(studyDate: string): Promise<StudyDayArticle | null>;
  /**
   * Idempotent, first-participant-wins — mirrors submitReflection's
   * article-info seeding. Returns `study_day_not_found` if no study_days
   * row exists yet for the date (the discussion step is only reachable
   * after both reflections have been submitted, which always creates the
   * row first, but this is defended against rather than assumed).
   */
  markDiscussionCompleted(
    studyDate: string,
    displayName: string,
    completedAt: Date,
  ): Promise<MarkDiscussionCompletedResult>;
  getDiscussionCompletion(studyDate: string): Promise<DiscussionCompletion | null>;
}
