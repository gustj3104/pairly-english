import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../db/schema.js';
import { dailyNewsArticles } from '../../db/schema.js';
import { generatedDailyNewsSchema } from './schema.js';
import type { DailyNewsArticle, GeneratedDailyNews } from './schema.js';

type Db = NodePgDatabase<typeof schema>;
export interface DailyNewsToStore extends GeneratedDailyNews {
  generatedAt: Date;
}

function mapRow(row: typeof dailyNewsArticles.$inferSelect): DailyNewsArticle {
  const vocabulary = generatedDailyNewsSchema.shape.vocabulary.parse(row.vocabulary);
  return {
    id: row.id,
    studyDate: row.studyDate,
    title: row.title,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    publishedAt: row.publishedAt.toISOString(),
    generatedAt: row.generatedAt.toISOString(),
    summary: row.summary,
    content: row.content,
    vocabulary,
  };
}

export interface DailyNewsRepository {
  find(studyDate: string): Promise<DailyNewsArticle | null>;
  getOrCreate(
    studyDate: string,
    create: () => Promise<DailyNewsToStore>,
  ): Promise<{ article: DailyNewsArticle; cached: boolean }>;
}

export class DrizzleDailyNewsRepository implements DailyNewsRepository {
  constructor(private readonly db: Db) {}
  async find(studyDate: string): Promise<DailyNewsArticle | null> {
    const row = await this.db.query.dailyNewsArticles.findFirst({
      where: eq(dailyNewsArticles.studyDate, studyDate),
    });
    return row ? mapRow(row) : null;
  }
  async getOrCreate(
    studyDate: string,
    create: () => Promise<DailyNewsToStore>,
  ): Promise<{ article: DailyNewsArticle; cached: boolean }> {
    return this.db.transaction(async (tx) => {
      // Transaction-scoped advisory lock is released automatically on commit,
      // rollback, connection loss, or process death. The date is also UNIQUE.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`daily-news:${studyDate}`}))`);
      const existing = await tx.query.dailyNewsArticles.findFirst({
        where: eq(dailyNewsArticles.studyDate, studyDate),
      });
      if (existing) return { article: mapRow(existing), cached: true };
      const value = await create();
      const [inserted] = await tx
        .insert(dailyNewsArticles)
        .values({
          studyDate,
          ...value,
          publishedAt: new Date(value.publishedAt),
          vocabulary: value.vocabulary,
        })
        .returning();
      if (!inserted) throw new Error('daily news insert failed');
      return { article: mapRow(inserted), cached: false };
    });
  }
}
