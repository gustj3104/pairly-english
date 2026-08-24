import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { reflections, studyDayComparisons, studyDays } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import type {
  DailyReflectionRepository,
  DiscussionCompletion,
  MarkDiscussionCompletedResult,
  ReflectionRow,
  StudyDayArticle,
  SubmitReflectionInput,
  SubmitReflectionResult,
} from './types.js';

type Db = NodePgDatabase<typeof schema>;

const MAX_PARTICIPANTS_PER_DAY = 2;

function toReflectionRow(row: typeof reflections.$inferSelect): ReflectionRow {
  return {
    id: row.id,
    studyDate: row.studyDate,
    participantKey: row.participantKey,
    displayName: row.displayName,
    content: row.content,
    status: row.status,
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * PostgreSQL-backed DailyReflectionRepository. Atomicity for
 * submitReflection comes from a transaction combined with
 * `SELECT ... FOR UPDATE` on the study_days row for the date, so every
 * concurrent submission for that date is serialized through the same
 * lock before it can check-then-write the participant count — this is
 * what makes the max-2-participants rule race-free, mirroring
 * src/services/credits/credit-repository.ts::reserveCredits exactly.
 *
 * Covered by tests/integration/study-days.postgres.test.ts against a real
 * PostgreSQL instance (Testcontainers), including a ~20-way concurrent
 * submission race.
 */
export class DrizzleDailyReflectionRepository implements DailyReflectionRepository {
  constructor(private readonly db: Db) {}

  async submitReflection(input: SubmitReflectionInput): Promise<SubmitReflectionResult> {
    return this.db.transaction(async (tx) => {
      // SELECT ... FOR UPDATE cannot lock a row that doesn't exist yet, so
      // two concurrent first-submissions for a brand-new date would
      // otherwise both fall through to INSERT and race on the PK.
      // Upserting the row first (idempotent, Postgres-serialized on the
      // unique index) guarantees the row exists before we lock it — the
      // first submitter's article info wins and seeds the row.
      await tx
        .insert(studyDays)
        .values({
          studyDate: input.studyDate,
          articleId: input.article.id,
          articleTitle: input.article.title,
          articleSourceUrl: input.article.sourceUrl,
          articleSummary: input.article.summary,
        })
        .onConflictDoNothing();

      // Locks the one row every submission for this date must pass
      // through — same participant or not. Holding this lock for the rest
      // of the transaction is what makes the article-mismatch check and
      // the participant-count check below race-free: nothing else can be
      // submitting for this date while we hold it.
      const [day] = await tx
        .select()
        .from(studyDays)
        .where(eq(studyDays.studyDate, input.studyDate))
        .for('update');

      if (!day) {
        throw new Error(`study_days row for ${input.studyDate} could not be created`);
      }

      const [comparison] = await tx
        .select({ status: studyDayComparisons.status })
        .from(studyDayComparisons)
        .where(eq(studyDayComparisons.studyDate, input.studyDate));
      if (comparison?.status === 'processing') {
        return { ok: false, reason: 'comparison_in_progress' } as const;
      }

      const [existing] = await tx
        .select()
        .from(reflections)
        .where(
          and(
            eq(reflections.studyDate, input.studyDate),
            eq(reflections.participantKey, input.participantKey),
          ),
        );

      if (existing) {
        if (existing.content === input.content) {
          return {
            ok: true,
            reflection: toReflectionRow(existing),
            alreadySubmitted: true,
            updated: false,
          } as const;
        }
        const [updated] = await tx
          .update(reflections)
          .set({ content: input.content, displayName: input.displayName, updatedAt: input.submittedAt })
          .where(eq(reflections.id, existing.id))
          .returning();
        if (!updated) throw new Error(`reflection ${existing.id} could not be updated`);
        return {
          ok: true,
          reflection: toReflectionRow(updated),
          alreadySubmitted: true,
          updated: true,
        } as const;
      }

      if (day.articleId !== input.article.id) {
        return { ok: false, reason: 'article_mismatch' } as const;
      }

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(reflections)
        .where(eq(reflections.studyDate, input.studyDate));

      if ((countRow?.count ?? 0) >= MAX_PARTICIPANTS_PER_DAY) {
        return { ok: false, reason: 'participant_limit_reached' } as const;
      }

      const [inserted] = await tx
        .insert(reflections)
        .values({
          studyDate: input.studyDate,
          participantKey: input.participantKey,
          displayName: input.displayName,
          content: input.content,
          status: 'submitted',
          submittedAt: input.submittedAt,
          updatedAt: input.submittedAt,
        })
        .returning();

      if (!inserted) {
        // Unreachable in practice: nothing else can be writing this
        // (study_date, participant_key) pair while we hold the lock.
        // Guarded for type-safety and defense in depth.
        throw new Error(
          `reflections row for (${input.studyDate}, participant) could not be inserted`,
        );
      }

      return {
        ok: true,
        reflection: toReflectionRow(inserted),
        alreadySubmitted: false,
        updated: false,
      } as const;
    });
  }

  async getReflectionsForDate(studyDate: string): Promise<ReflectionRow[]> {
    const rows = await this.db
      .select()
      .from(reflections)
      .where(eq(reflections.studyDate, studyDate));

    return rows.map(toReflectionRow);
  }

  async getStudyDayArticle(studyDate: string): Promise<StudyDayArticle | null> {
    const [day] = await this.db.select().from(studyDays).where(eq(studyDays.studyDate, studyDate));
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
    // COALESCE makes this a single atomic first-writer-wins statement — no
    // transaction/row lock needed, since a second concurrent call for the
    // same date just no-ops onto whatever the first one already wrote.
    const [row] = await this.db
      .update(studyDays)
      .set({
        discussionCompletedAt: sql`coalesce(${studyDays.discussionCompletedAt}, ${completedAt})`,
        discussionCompletedBy: sql`coalesce(${studyDays.discussionCompletedBy}, ${displayName})`,
        updatedAt: new Date(),
      })
      .where(eq(studyDays.studyDate, studyDate))
      .returning({
        completedAt: studyDays.discussionCompletedAt,
        completedBy: studyDays.discussionCompletedBy,
      });

    if (!row || row.completedAt === null || row.completedBy === null) {
      return { ok: false, reason: 'study_day_not_found' };
    }

    return { ok: true, completion: { completedAt: row.completedAt, completedBy: row.completedBy } };
  }

  async getDiscussionCompletion(studyDate: string): Promise<DiscussionCompletion | null> {
    const [day] = await this.db.select().from(studyDays).where(eq(studyDays.studyDate, studyDate));
    if (!day || day.discussionCompletedAt === null || day.discussionCompletedBy === null)
      return null;

    return { completedAt: day.discussionCompletedAt, completedBy: day.discussionCompletedBy };
  }
}
