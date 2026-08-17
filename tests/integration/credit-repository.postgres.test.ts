import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  startTestDatabase,
  stopTestDatabase,
  truncateCreditTables,
  type TestDatabase,
} from './helpers/postgres-container.js';
import { DrizzleCreditRepository } from '../../src/services/credits/credit-repository.js';
import { creditPeriods, creditUsageRecords } from '../../src/db/schema.js';
import type { ReserveCreditsRepositoryInput } from '../../src/services/credits/types.js';

/**
 * Integration tests against a real, throwaway PostgreSQL instance
 * (Testcontainers). These exercise the actual transaction + row-locking
 * behavior of DrizzleCreditRepository — the in-memory fake used by the
 * fast unit tests (tests/helpers/in-memory-credit-repository.ts) verifies
 * CreditService's business logic only, not PostgreSQL's transaction or
 * locking semantics.
 */

let testDb: TestDatabase;
let repository: DrizzleCreditRepository;

beforeAll(async () => {
  testDb = await startTestDatabase();
  repository = new DrizzleCreditRepository(testDb.db);
}, 180_000);

afterAll(async () => {
  if (testDb) await stopTestDatabase(testDb);
}, 60_000);

beforeEach(async () => {
  await truncateCreditTables(testDb.pool);
});

const MONTH = '2026-08';
const LIMIT = 5000;

function reservation(
  overrides: Partial<ReserveCreditsRepositoryInput> = {},
): ReserveCreditsRepositoryInput {
  return {
    requestId: crypto.randomUUID(),
    billingMonth: MONTH,
    feature: 'grammar_feedback',
    model: 'claude-haiku-4-5-20251001',
    requestedAt: new Date('2026-08-17T03:00:00.000Z'),
    inputTokens: 1000,
    outputTokens: 1000,
    estimatedCredits: 6,
    ...overrides,
  };
}

async function getPeriod(billingMonth = MONTH) {
  const [period] = await testDb.db
    .select()
    .from(creditPeriods)
    .where(eq(creditPeriods.billingMonth, billingMonth));
  return period;
}

async function getRecord(requestId: string) {
  const [record] = await testDb.db
    .select()
    .from(creditUsageRecords)
    .where(eq(creditUsageRecords.requestId, requestId));
  return record;
}

describe('reserveCredits — basic reservation on an empty month', () => {
  it('creates the credit_periods row and increments reserved_credits', async () => {
    const input = reservation({ estimatedCredits: 6 });
    const result = await repository.reserveCredits(input, LIMIT);

    expect(result.ok).toBe(true);

    const period = await getPeriod();
    expect(period?.reservedCredits).toBe(6);
    expect(period?.committedCredits).toBe(0);
  });

  it('inserts a reserved credit_usage_records row', async () => {
    const input = reservation({ estimatedCredits: 6 });
    await repository.reserveCredits(input, LIMIT);

    const record = await getRecord(input.requestId);
    expect(record).toBeDefined();
    expect(record?.status).toBe('reserved');
    expect(record?.creditsReserved).toBe(6);
    expect(record?.billingMonth).toBe(MONTH);
  });
});

describe('commitCredits — successful settlement', () => {
  it('decrements reserved, adds actual usage to committed, marks completed, keeps token counts', async () => {
    const input = reservation({ estimatedCredits: 6, inputTokens: 1200, outputTokens: 900 });
    await repository.reserveCredits(input, LIMIT);

    await repository.commitCredits(input.requestId, 5);

    const period = await getPeriod();
    expect(period?.reservedCredits).toBe(0);
    expect(period?.committedCredits).toBe(5);

    const record = await getRecord(input.requestId);
    expect(record?.status).toBe('completed');
    expect(record?.creditsUsed).toBe(5);
    expect(record?.inputTokens).toBe(1200);
    expect(record?.outputTokens).toBe(900);
  });
});

describe('releaseCredits — failure release', () => {
  it('decrements reserved without touching committed, marks released, records the error code', async () => {
    const input = reservation({ estimatedCredits: 6 });
    await repository.reserveCredits(input, LIMIT);

    await repository.releaseCredits(input.requestId, 'mindlogic_5xx');

    const period = await getPeriod();
    expect(period?.reservedCredits).toBe(0);
    expect(period?.committedCredits).toBe(0);

    const record = await getRecord(input.requestId);
    expect(record?.status).toBe('released');
    expect(record?.errorCode).toBe('mindlogic_5xx');
  });
});

describe('idempotency', () => {
  it('reserving the same requestId twice only counts once', async () => {
    const input = reservation({ estimatedCredits: 6 });

    const first = await repository.reserveCredits(input, LIMIT);
    const second = await repository.reserveCredits(input, LIMIT);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.idempotentReplay).toBe(true);

    const period = await getPeriod();
    expect(period?.reservedCredits).toBe(6);

    const records = await testDb.db
      .select()
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.requestId, input.requestId));
    expect(records).toHaveLength(1);
  });
});

describe('monthly limit', () => {
  it('allows a reservation that brings the month to exactly the limit', async () => {
    await repository.reserveCredits(reservation({ estimatedCredits: LIMIT - 100 }), LIMIT);
    const result = await repository.reserveCredits(reservation({ estimatedCredits: 100 }), LIMIT);

    expect(result.ok).toBe(true);
    const period = await getPeriod();
    expect(period?.reservedCredits).toBe(LIMIT);
  });

  it('rejects a reservation that would exceed the limit by even 1 credit', async () => {
    await repository.reserveCredits(reservation({ estimatedCredits: LIMIT - 100 }), LIMIT);
    const rejectedInput = reservation({ estimatedCredits: 101 });
    const result = await repository.reserveCredits(rejectedInput, LIMIT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('limit_exceeded');

    // The rejected request must not have left any trace in the ledger.
    const record = await getRecord(rejectedInput.requestId);
    expect(record).toBeUndefined();
    const period = await getPeriod();
    expect(period?.reservedCredits).toBe(LIMIT - 100);
  });
});

describe('real concurrency race over the monthly limit', () => {
  it('never lets successful reservations exceed the limit, rejects the rest cleanly, no deadlock', async () => {
    // 10 concurrent requests at 600 credits each = 6000 requested against a
    // 5000 limit. Exactly floor(5000/600) = 8 can fit (4800), leaving 200
    // of headroom — too little for a 9th 600-credit request, so exactly 2
    // must be rejected regardless of arrival order.
    const inputs = Array.from({ length: 10 }, () =>
      reservation({ estimatedCredits: 600, inputTokens: 600_000 }),
    );

    // Fired concurrently — NOT awaited one at a time — so they genuinely
    // race for the same credit_periods row inside Postgres.
    const settled = await Promise.allSettled(
      inputs.map((input) => repository.reserveCredits(input, LIMIT)),
    );

    // No deadlock, no unexpected DB error: every call must resolve, none reject.
    for (const outcome of settled) {
      expect(outcome.status).toBe('fulfilled');
    }
    const results = settled.map((outcome) => {
      if (outcome.status !== 'fulfilled') throw new Error('unexpected rejection');
      return outcome.value;
    });

    const succeeded = results.filter((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);

    expect(succeeded).toHaveLength(8);
    expect(rejected).toHaveLength(2);
    for (const result of rejected) {
      if (!result.ok) expect(result.reason).toBe('limit_exceeded');
    }

    const period = await getPeriod();
    expect(period?.reservedCredits).toBe(4800);
    expect(period?.reservedCredits).toBeLessThanOrEqual(LIMIT);
    expect(period?.reservedCredits).toBeGreaterThanOrEqual(0);

    // Rejected requests must not have written a usage record.
    const records = await testDb.db
      .select()
      .from(creditUsageRecords)
      .where(eq(creditUsageRecords.billingMonth, MONTH));
    expect(records).toHaveLength(8);
  });
});

describe('double-settlement guards', () => {
  it('rejects committing the same requestId twice and does not double-count committed credits', async () => {
    const input = reservation({ estimatedCredits: 6 });
    await repository.reserveCredits(input, LIMIT);
    await repository.commitCredits(input.requestId, 6);

    await expect(repository.commitCredits(input.requestId, 6)).rejects.toThrow();

    const period = await getPeriod();
    expect(period?.committedCredits).toBe(6);
    expect(period?.reservedCredits).toBe(0);
  });

  it('rejects releasing the same requestId twice and does not double-decrement reserved', async () => {
    const input = reservation({ estimatedCredits: 6 });
    await repository.reserveCredits(input, LIMIT);
    await repository.releaseCredits(input.requestId, 'boom');

    await expect(repository.releaseCredits(input.requestId, 'boom')).rejects.toThrow();

    const period = await getPeriod();
    expect(period?.reservedCredits).toBe(0);
    expect(period?.reservedCredits).toBeGreaterThanOrEqual(0);
  });

  it('rejects releasing a request that was already committed', async () => {
    const input = reservation({ estimatedCredits: 6 });
    await repository.reserveCredits(input, LIMIT);
    await repository.commitCredits(input.requestId, 6);

    await expect(repository.releaseCredits(input.requestId, 'too_late')).rejects.toThrow();

    const record = await getRecord(input.requestId);
    expect(record?.status).toBe('completed');
  });

  it('rejects committing a request that was already released', async () => {
    const input = reservation({ estimatedCredits: 6 });
    await repository.reserveCredits(input, LIMIT);
    await repository.releaseCredits(input.requestId, 'boom');

    await expect(repository.commitCredits(input.requestId, 6)).rejects.toThrow();

    const record = await getRecord(input.requestId);
    expect(record?.status).toBe('released');
  });

  it('never drives reserved_credits negative under concurrent double-settlement attempts', async () => {
    const input = reservation({ estimatedCredits: 6 });
    await repository.reserveCredits(input, LIMIT);

    // Race a commit and a release for the same requestId — only one may win.
    const settled = await Promise.allSettled([
      repository.commitCredits(input.requestId, 6),
      repository.releaseCredits(input.requestId, 'race'),
    ]);

    const fulfilledCount = settled.filter((outcome) => outcome.status === 'fulfilled').length;
    expect(fulfilledCount).toBe(1);

    const period = await getPeriod();
    expect(period?.reservedCredits).toBe(0);
    expect(period?.reservedCredits).toBeGreaterThanOrEqual(0);
  });
});
