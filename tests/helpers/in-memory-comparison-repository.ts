import { randomUUID } from 'node:crypto';
import type {
  ClaimGenerationOutcome,
  ClaimRetryOutcome,
  ComparisonRepository,
  ComputeFingerprint,
  StudyDayComparisonRow,
} from '../../src/services/daily-reflections/comparison-repository.js';
import type { InMemoryDailyReflectionRepository } from './in-memory-daily-reflection-repository.js';

/**
 * Plain in-memory fake of ComparisonRepository used to unit-test the HTTP
 * layer and ComparisonService's business rules — mirrors
 * InMemoryDailyReflectionRepository. Reads the SAME
 * InMemoryDailyReflectionRepository instance a test's DailyReflectionService
 * is backed by, so "exactly 2 reflections submitted" reflects real fake
 * state instead of needing to be duplicated by hand.
 *
 * This does NOT substitute for a real PostgreSQL transaction/locking
 * integration test — see
 * tests/integration/study-days-comparison.postgres.test.ts for that
 * (including the ~20-way concurrent POST /compare race and the concurrent
 * -retry race).
 */
export class InMemoryComparisonRepository implements ComparisonRepository {
  private readonly rows = new Map<string, StudyDayComparisonRow>();

  constructor(private readonly dailyReflectionRepository: InMemoryDailyReflectionRepository) {}

  async claimGeneration(
    studyDate: string,
    model: string,
    computeFingerprint: ComputeFingerprint,
  ): Promise<ClaimGenerationOutcome> {
    const article = await this.dailyReflectionRepository.getStudyDayArticle(studyDate);
    if (!article) {
      return { outcome: 'partner_not_ready' };
    }

    const reflectionRows = await this.dailyReflectionRepository.getReflectionsForDate(studyDate);
    if (reflectionRows.length !== 2) {
      return { outcome: 'partner_not_ready' };
    }

    const fingerprint = computeFingerprint({
      articleId: article.id,
      reflections: reflectionRows.map((r) => ({
        participantKey: r.participantKey,
        content: r.content,
      })),
    });

    const existing = this.rows.get(studyDate);
    const now = new Date();

    if (!existing) {
      const requestId = randomUUID();
      this.rows.set(studyDate, {
        studyDate,
        requestId,
        status: 'processing',
        model,
        inputFingerprint: fingerprint,
        result: null,
        errorCode: null,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
      });
      return { outcome: 'claimed', requestId, fingerprint };
    }

    if (existing.status === 'completed') {
      if (existing.inputFingerprint === fingerprint) {
        return { outcome: 'cached', result: existing.result };
      }
      const requestId = randomUUID();
      this.rows.set(studyDate, {
        ...existing,
        requestId,
        status: 'processing',
        model,
        inputFingerprint: fingerprint,
        result: null,
        errorCode: null,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
      });
      return { outcome: 'claimed', requestId, fingerprint };
    }

    if (existing.status === 'processing') {
      return { outcome: 'in_progress' };
    }

    if (existing.status === 'reconciliation_pending') {
      return { outcome: 'reconciliation_pending' };
    }

    return { outcome: 'failed', errorCode: existing.errorCode };
  }

  async completeGeneration(studyDate: string, requestId: string, result: unknown): Promise<void> {
    const existing = this.rows.get(studyDate);
    if (!existing || existing.requestId !== requestId) return;
    const now = new Date();
    this.rows.set(studyDate, {
      ...existing,
      status: 'completed',
      result,
      errorCode: null,
      completedAt: now,
      updatedAt: now,
    });
  }

  async failGeneration(studyDate: string, requestId: string, errorCode: string): Promise<void> {
    const existing = this.rows.get(studyDate);
    if (!existing || existing.requestId !== requestId) return;
    this.rows.set(studyDate, {
      ...existing,
      status: 'failed',
      errorCode,
      updatedAt: new Date(),
    });
  }

  async markReconciliationPending(
    studyDate: string,
    requestId: string,
    errorCode: string,
  ): Promise<void> {
    const existing = this.rows.get(studyDate);
    if (!existing || existing.requestId !== requestId) return;
    this.rows.set(studyDate, {
      ...existing,
      status: 'reconciliation_pending',
      errorCode,
      updatedAt: new Date(),
    });
  }

  async getByDate(studyDate: string): Promise<StudyDayComparisonRow | null> {
    return this.rows.get(studyDate) ?? null;
  }

  async claimRetry(studyDate: string): Promise<ClaimRetryOutcome> {
    const existing = this.rows.get(studyDate);
    if (!existing) return { outcome: 'not_started' };
    if (existing.status === 'completed') return { outcome: 'completed' };
    if (existing.status === 'reconciliation_pending') return { outcome: 'reconciliation_pending' };
    if (existing.status === 'processing') return { outcome: 'processing' };

    const requestId = randomUUID();
    const now = new Date();
    this.rows.set(studyDate, {
      ...existing,
      requestId,
      status: 'processing',
      errorCode: null,
      startedAt: now,
      completedAt: null,
      updatedAt: now,
    });
    return { outcome: 'claimed', requestId };
  }

  async findStaleProcessing(
    olderThanMs: number,
    now: Date = new Date(),
  ): Promise<StudyDayComparisonRow[]> {
    const threshold = now.getTime() - olderThanMs;
    return [...this.rows.values()].filter(
      (row) => row.status === 'processing' && row.startedAt.getTime() < threshold,
    );
  }
}
