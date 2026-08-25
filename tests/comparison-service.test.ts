import { describe, expect, it } from 'vitest';
import { ComparisonService } from '../src/services/daily-reflections/comparison-service.js';
import type {
  ClaimGenerationOutcome,
  ClaimRetryOutcome,
  ComparisonRepository,
  ComputeFingerprint,
  StudyDayComparisonRow,
} from '../src/services/daily-reflections/comparison-repository.js';
import type { ReflectionComparisonResult } from '../src/services/reflections/schema.js';

function validResult() {
  return {
    commonGround: [{ point: 'p', mine: 'm', partner: 'pt' }],
    differences: [
      { topic: 't', mine: { stance: 's1', quote: 'q1' }, partner: { stance: 's2', quote: 'q2' } },
    ],
    topics: [
      { question: 'q1?', reason: 'r1', difficulty: 'Intermediate' },
      { question: 'q2?', reason: 'r2', difficulty: 'Advanced' },
      { question: 'q3?', reason: 'r3', difficulty: 'Intermediate' },
    ],
  };
}

class StubRepository implements ComparisonRepository {
  claimGenerationResult: ClaimGenerationOutcome = { outcome: 'partner_not_ready' };
  claimRetryResult: ClaimRetryOutcome = { outcome: 'not_started' };
  byDate: StudyDayComparisonRow | null = null;

  async claimGeneration(
    _studyDate: string,
    _model: string,
    _computeFingerprint: ComputeFingerprint,
  ): Promise<ClaimGenerationOutcome> {
    return this.claimGenerationResult;
  }
  async completeGeneration(): Promise<void> {}
  async failGeneration(): Promise<void> {}
  async markReconciliationPending(): Promise<void> {}
  async getByDate(): Promise<StudyDayComparisonRow | null> {
    return this.byDate;
  }
  async getReadSnapshot() {
    return {
      comparison: this.byDate,
      currentInputFingerprint: this.byDate?.inputFingerprint ?? null,
    };
  }
  async getDiscussionTopic() {
    return { outcome: 'not_ready' as const };
  }
  async setDiscussionTopic() {
    return { outcome: 'not_ready' as const };
  }
  async claimGuideRegeneration(): Promise<ClaimGenerationOutcome> {
    return this.claimGenerationResult;
  }
  async claimRetry(): Promise<ClaimRetryOutcome> {
    return this.claimRetryResult;
  }
  async findStaleProcessing(): Promise<StudyDayComparisonRow[]> {
    return [];
  }
}

function row(overrides: Partial<StudyDayComparisonRow> = {}): StudyDayComparisonRow {
  return {
    studyDate: '2026-08-17',
    requestId: '11111111-1111-1111-1111-111111111111',
    status: 'completed',
    model: 'gpt-5.4-mini',
    inputFingerprint: 'deadbeef',
    result: validResult(),
    errorCode: null,
    startedAt: new Date(),
    completedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ComparisonService.claimGeneration', () => {
  it('validates a cached result and returns it parsed on success', async () => {
    const repository = new StubRepository();
    repository.claimGenerationResult = { outcome: 'cached', result: validResult() };
    const service = new ComparisonService(repository);

    const outcome = await service.claimGeneration('2026-08-17');
    expect(outcome).toEqual({ outcome: 'cached', result: validResult() });
  });

  it('returns cached_corrupted when the stored result fails schema validation', async () => {
    const repository = new StubRepository();
    repository.claimGenerationResult = { outcome: 'cached', result: { bogus: true } };
    const service = new ComparisonService(repository);

    const outcome = await service.claimGeneration('2026-08-17');
    expect(outcome).toEqual({ outcome: 'cached_corrupted' });
  });

  it('passes through non-cached outcomes unchanged', async () => {
    const repository = new StubRepository();
    repository.claimGenerationResult = { outcome: 'in_progress' };
    const service = new ComparisonService(repository);
    expect(await service.claimGeneration('2026-08-17')).toEqual({ outcome: 'in_progress' });
  });
});

describe('ComparisonService.getComparison — read-side validation', () => {
  it('returns the parsed result for a valid completed row', async () => {
    const repository = new StubRepository();
    repository.byDate = row();
    const service = new ComparisonService(repository);

    const result = await service.getComparison('2026-08-17');
    expect(result).toEqual({ status: 'completed', result: validResult() });
  });

  it('returns status "corrupted" for a completed row whose result fails schema validation, never passing it through', async () => {
    const repository = new StubRepository();
    repository.byDate = row({ result: { totally: 'wrong shape' } });
    const service = new ComparisonService(repository);

    const result = await service.getComparison('2026-08-17');
    expect(result).toEqual({ status: 'corrupted' });
  });

  it('returns not_started when no row exists', async () => {
    const repository = new StubRepository();
    const service = new ComparisonService(repository);
    expect(await service.getComparison('2026-08-17')).toEqual({ status: 'not_started' });
  });

  it('passes through processing/failed/reconciliation_pending rows without touching result', async () => {
    const repository = new StubRepository();
    const service = new ComparisonService(repository);

    repository.byDate = row({ status: 'processing', result: null, completedAt: null });
    expect(await service.getComparison('2026-08-17')).toEqual({ status: 'processing' });

    repository.byDate = row({ status: 'failed', result: null, errorCode: 'upstream_failed' });
    expect(await service.getComparison('2026-08-17')).toEqual({
      status: 'failed',
      errorCode: 'upstream_failed',
    });

    repository.byDate = row({
      status: 'reconciliation_pending',
      result: null,
      errorCode: 'timeout',
    });
    expect(await service.getComparison('2026-08-17')).toEqual({ status: 'reconciliation_pending' });
  });
});

describe('ComparisonService.completeWithResult — write-side re-validation', () => {
  it('throws rather than persisting a result that fails schema validation', async () => {
    const repository = new StubRepository();
    const service = new ComparisonService(repository);
    // Deliberately malformed for this defense-in-depth test — cast past
    // the type system the same way a real caller's runtime bug would
    // bypass it (the whole point is that this method doesn't trust its
    // static type either).
    const malformed = { bogus: true } as unknown as ReflectionComparisonResult;
    await expect(service.completeWithResult('2026-08-17', 'req-1', malformed)).rejects.toThrow();
  });
});
