import type { DailyNewsArticle } from '../../src/services/daily-news/schema.js';
import type {
  DailyNewsRepository,
  DailyNewsToStore,
} from '../../src/services/daily-news/repository.js';
import { validateSourceUrl } from '../../src/services/daily-news/source-url.js';

function toArticle(studyDate: string, id: string, value: DailyNewsToStore): DailyNewsArticle {
  return {
    id,
    studyDate,
    title: value.title,
    sourceName: value.sourceName,
    // Re-validated on read, same as DrizzleDailyNewsRepository's mapRow —
    // keeps this fake's `sourceUrl` policy identical to production.
    sourceUrl: validateSourceUrl(value.sourceUrl)?.href ?? null,
    publishedAt: value.publishedAt,
    generatedAt: value.generatedAt.toISOString(),
    summary: value.summary,
    content: value.content,
    vocabulary: value.vocabulary,
  };
}

/**
 * Plain in-memory stand-in for DrizzleDailyNewsRepository, for route-level
 * tests that don't need PostgreSQL. Concurrent `getOrCreate` misses for the
 * same date are serialized onto one queue (so route tests never trigger two
 * provider calls for one date) but this is NOT a proof of the real advisory
 * lock's crash-safety — that's covered against real PostgreSQL by
 * tests/integration/daily-news.postgres.test.ts.
 */
export class InMemoryDailyNewsRepository implements DailyNewsRepository {
  private readonly articles = new Map<string, DailyNewsArticle>();
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;

  async find(studyDate: string): Promise<DailyNewsArticle | null> {
    return this.articles.get(studyDate) ?? null;
  }

  async getOrCreate(
    studyDate: string,
    create: () => Promise<DailyNewsToStore>,
  ): Promise<{ article: DailyNewsArticle; cached: boolean }> {
    const run = this.queue.then(async () => {
      const existing = this.articles.get(studyDate);
      if (existing) return { article: existing, cached: true };
      const value = await create();
      const article = toArticle(studyDate, `article-${this.nextId++}`, value);
      this.articles.set(studyDate, article);
      return { article, cached: false };
    });
    // A failed creation must never persist a row, but the queue itself must
    // keep advancing so the next date-miss can still attempt generation.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
