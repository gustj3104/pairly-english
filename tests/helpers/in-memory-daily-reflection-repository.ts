import type {
  DailyReflectionRepository,
  DiscussionCompletion,
  MarkDiscussionCompletedResult,
  ReflectionRow,
  StudyDayArticle,
  SubmitReflectionInput,
  SubmitReflectionResult,
} from '../../src/services/daily-reflections/types.js';

interface StudyDayRow {
  studyDate: string;
  articleId: string;
  articleTitle: string;
  articleSourceUrl: string | null;
  articleSummary: string | null;
  discussionCompletion: DiscussionCompletion | null;
}

const MAX_PARTICIPANTS_PER_DAY = 2;

/**
 * Plain in-memory fake of DailyReflectionRepository used to unit-test the
 * HTTP layer and DailyReflectionService's business rules. This does NOT
 * substitute for a real PostgreSQL transaction/locking integration test —
 * see tests/integration/study-days.postgres.test.ts for that.
 */
export class InMemoryDailyReflectionRepository implements DailyReflectionRepository {
  private readonly studyDays = new Map<string, StudyDayRow>();
  private readonly reflectionsByDate = new Map<string, ReflectionRow[]>();

  async submitReflection(input: SubmitReflectionInput): Promise<SubmitReflectionResult> {
    let day = this.studyDays.get(input.studyDate);
    if (!day) {
      day = {
        studyDate: input.studyDate,
        articleId: input.article.id,
        articleTitle: input.article.title,
        articleSourceUrl: input.article.sourceUrl,
        articleSummary: input.article.summary,
        discussionCompletion: null,
      };
      this.studyDays.set(input.studyDate, day);
    }

    if (day.articleId !== input.article.id) {
      return { ok: false, reason: 'article_mismatch' };
    }

    const existingRows = this.reflectionsByDate.get(input.studyDate) ?? [];
    const existing = existingRows.find((row) => row.participantKey === input.participantKey);
    if (existing) {
      return { ok: true, submittedAt: existing.submittedAt, alreadySubmitted: true };
    }

    if (existingRows.length >= MAX_PARTICIPANTS_PER_DAY) {
      return { ok: false, reason: 'participant_limit_reached' };
    }

    const row: ReflectionRow = {
      studyDate: input.studyDate,
      participantKey: input.participantKey,
      displayName: input.displayName,
      content: input.content,
      status: 'submitted',
      submittedAt: input.submittedAt,
    };
    this.reflectionsByDate.set(input.studyDate, [...existingRows, row]);

    return { ok: true, submittedAt: row.submittedAt, alreadySubmitted: false };
  }

  async getReflectionsForDate(studyDate: string): Promise<ReflectionRow[]> {
    return [...(this.reflectionsByDate.get(studyDate) ?? [])];
  }

  async getStudyDayArticle(studyDate: string): Promise<StudyDayArticle | null> {
    const day = this.studyDays.get(studyDate);
    if (!day) return null;
    return {
      id: day.articleId,
      title: day.articleTitle,
      sourceUrl: day.articleSourceUrl,
      summary: day.articleSummary,
    };
  }

  async markDiscussionCompleted(
    studyDate: string,
    displayName: string,
    completedAt: Date,
  ): Promise<MarkDiscussionCompletedResult> {
    const day = this.studyDays.get(studyDate);
    if (!day) return { ok: false, reason: 'study_day_not_found' };

    if (!day.discussionCompletion) {
      day.discussionCompletion = { completedAt, completedBy: displayName };
    }
    return { ok: true, completion: day.discussionCompletion };
  }

  async getDiscussionCompletion(studyDate: string): Promise<DiscussionCompletion | null> {
    return this.studyDays.get(studyDate)?.discussionCompletion ?? null;
  }
}
