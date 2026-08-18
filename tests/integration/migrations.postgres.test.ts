import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startTestDatabase,
  stopTestDatabase,
  truncateCreditTables,
  truncateStudyDayTables,
  type TestDatabase,
} from './helpers/postgres-container.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../src/db/migrations');

let testDb: TestDatabase;

beforeAll(async () => {
  // startTestDatabase() itself applies the migrations to a brand-new,
  // empty database — if that throws, this whole suite fails immediately,
  // which is the "migration applies to an empty PostgreSQL" assertion.
  testDb = await startTestDatabase();
}, 180_000);

afterAll(async () => {
  if (testDb) await stopTestDatabase(testDb);
}, 60_000);

beforeEach(async () => {
  await truncateCreditTables(testDb.pool);
  await truncateStudyDayTables(testDb.pool);
});

describe('migration application', () => {
  it('creates all tables and enum types, including the daily-reflections feature', async () => {
    const tables = await testDb.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'credit_periods',
        'credit_usage_records',
        'study_days',
        'reflections',
        'study_day_comparisons',
        'daily_news_articles',
      ]),
    );

    const enums = await testDb.pool.query<{ typname: string }>(
      `select typname from pg_type where typname in ('credit_status', 'credit_feature', 'reflection_status', 'comparison_status')`,
    );
    expect(enums.rows.map((row) => row.typname).sort()).toEqual([
      'comparison_status',
      'credit_feature',
      'credit_status',
      'reflection_status',
    ]);
  });

  it('is safe to run a second time against an already-migrated database', async () => {
    await expect(
      migrate(testDb.db, { migrationsFolder: MIGRATIONS_FOLDER }),
    ).resolves.not.toThrow();
  });
});

describe('foreign key enforcement', () => {
  it('rejects a credit_usage_records row referencing a billing_month with no credit_periods row', async () => {
    await expect(
      testDb.pool.query(
        `insert into credit_usage_records
           (request_id, billing_month, feature, model, input_tokens, output_tokens, credits_reserved, status)
         values (gen_random_uuid(), '2099-01', 'grammar_feedback', 'claude-haiku-4-5-20251001', 100, 100, 1, 'reserved')`,
      ),
    ).rejects.toMatchObject({ code: '23503' }); // foreign_key_violation
  });
});

describe('enum enforcement', () => {
  it('rejects an out-of-range credit_status value at the database level', async () => {
    await testDb.pool.query(`insert into credit_periods (billing_month) values ('2026-08')`);
    await expect(
      testDb.pool.query(
        `insert into credit_usage_records
           (request_id, billing_month, feature, model, input_tokens, output_tokens, credits_reserved, status)
         values (gen_random_uuid(), '2026-08', 'grammar_feedback', 'claude-haiku-4-5-20251001', 100, 100, 1, 'bogus_status')`,
      ),
    ).rejects.toMatchObject({ code: '22P02' }); // invalid_text_representation (bad enum input)
  });

  it('rejects an out-of-range credit_feature value at the database level', async () => {
    await testDb.pool.query(`insert into credit_periods (billing_month) values ('2026-08')`);
    await expect(
      testDb.pool.query(
        `insert into credit_usage_records
           (request_id, billing_month, feature, model, input_tokens, output_tokens, credits_reserved, status)
         values (gen_random_uuid(), '2026-08', 'not_a_real_feature', 'claude-haiku-4-5-20251001', 100, 100, 1, 'reserved')`,
      ),
    ).rejects.toMatchObject({ code: '22P02' });
  });
});

describe('check constraint enforcement', () => {
  it('rejects a negative reserved_credits value on credit_periods', async () => {
    await expect(
      testDb.pool.query(
        `insert into credit_periods (billing_month, reserved_credits) values ('2026-08', -1)`,
      ),
    ).rejects.toMatchObject({ code: '23514' }); // check_violation
  });

  it('rejects a negative credits_reserved value on credit_usage_records', async () => {
    await testDb.pool.query(`insert into credit_periods (billing_month) values ('2026-08')`);
    await expect(
      testDb.pool.query(
        `insert into credit_usage_records
           (request_id, billing_month, feature, model, input_tokens, output_tokens, credits_reserved, status)
         values (gen_random_uuid(), '2026-08', 'grammar_feedback', 'claude-haiku-4-5-20251001', 100, 100, -5, 'reserved')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a reconciliation_pending row with no error_code', async () => {
    await testDb.pool.query(`insert into credit_periods (billing_month) values ('2026-08')`);
    await expect(
      testDb.pool.query(
        `insert into credit_usage_records
           (request_id, billing_month, feature, model, input_tokens, output_tokens, credits_reserved, status)
         values (gen_random_uuid(), '2026-08', 'grammar_feedback', 'claude-haiku-4-5-20251001', 100, 100, 5, 'reconciliation_pending')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts a reconciliation_pending row that does have an error_code', async () => {
    await testDb.pool.query(`insert into credit_periods (billing_month) values ('2026-08')`);
    await expect(
      testDb.pool.query(
        `insert into credit_usage_records
           (request_id, billing_month, feature, model, input_tokens, output_tokens, credits_reserved, status, error_code)
         values (gen_random_uuid(), '2026-08', 'grammar_feedback', 'claude-haiku-4-5-20251001', 100, 100, 5, 'reconciliation_pending', 'timeout')`,
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe('integer round-trip precision', () => {
  it('returns integer credit columns as JS numbers, not strings, with no precision loss', async () => {
    // Schema uses `integer` (int4) throughout, not numeric/decimal or
    // bigint — node-postgres returns int4 natively as a JS number, unlike
    // numeric/bigint which come back as strings. This test pins that.
    const largeValue = 1_999_999_999; // well within int4 range, close to the practical ceiling
    await testDb.pool.query(
      `insert into credit_periods (billing_month, committed_credits) values ('2026-08', $1)`,
      [largeValue],
    );

    const raw = await testDb.pool.query<{ committed_credits: unknown }>(
      `select committed_credits from credit_periods where billing_month = '2026-08'`,
    );
    expect(typeof raw.rows[0]?.committed_credits).toBe('number');
    expect(raw.rows[0]?.committed_credits).toBe(largeValue);

    const viaDrizzle = await testDb.db.execute(
      sql`select committed_credits from credit_periods where billing_month = '2026-08'`,
    );
    expect(typeof viaDrizzle.rows[0]?.committed_credits).toBe('number');
    expect(viaDrizzle.rows[0]?.committed_credits).toBe(largeValue);
  });
});

describe('daily-reflections foreign key enforcement', () => {
  it('rejects a reflections row referencing a study_date with no study_days row', async () => {
    await expect(
      testDb.pool.query(
        `insert into reflections
           (study_date, participant_key, display_name, content, submitted_at, updated_at)
         values ('2099-01-01', 'alex', 'Alex', 'A sufficiently long reflection body for this test.', now(), now())`,
      ),
    ).rejects.toMatchObject({ code: '23503' }); // foreign_key_violation
  });
});

describe('daily-reflections enum enforcement', () => {
  it('rejects an out-of-range reflection_status value at the database level', async () => {
    await testDb.pool.query(
      `insert into study_days (study_date, article_id, article_title) values ('2026-08-17', 'a1', 'Title')`,
    );
    await expect(
      testDb.pool.query(
        `insert into reflections
           (study_date, participant_key, display_name, content, status, submitted_at, updated_at)
         values ('2026-08-17', 'alex', 'Alex', 'A sufficiently long reflection body for this test.', 'bogus_status', now(), now())`,
      ),
    ).rejects.toMatchObject({ code: '22P02' }); // invalid_text_representation (bad enum input)
  });
});

describe('daily-reflections check constraint enforcement', () => {
  it('rejects a blank display_name', async () => {
    await testDb.pool.query(
      `insert into study_days (study_date, article_id, article_title) values ('2026-08-17', 'a1', 'Title')`,
    );
    await expect(
      testDb.pool.query(
        `insert into reflections
           (study_date, participant_key, display_name, content, submitted_at, updated_at)
         values ('2026-08-17', 'alex', '   ', 'A sufficiently long reflection body for this test.', now(), now())`,
      ),
    ).rejects.toMatchObject({ code: '23514' }); // check_violation
  });

  it('rejects blank content', async () => {
    await testDb.pool.query(
      `insert into study_days (study_date, article_id, article_title) values ('2026-08-17', 'a1', 'Title')`,
    );
    await expect(
      testDb.pool.query(
        `insert into reflections
           (study_date, participant_key, display_name, content, submitted_at, updated_at)
         values ('2026-08-17', 'alex', 'Alex', '   ', now(), now())`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('daily-reflections unique constraint enforcement', () => {
  it('rejects a second reflection for the same (study_date, participant_key)', async () => {
    await testDb.pool.query(
      `insert into study_days (study_date, article_id, article_title) values ('2026-08-17', 'a1', 'Title')`,
    );
    await testDb.pool.query(
      `insert into reflections
         (study_date, participant_key, display_name, content, submitted_at, updated_at)
       values ('2026-08-17', 'alex', 'Alex', 'A sufficiently long reflection body for this test.', now(), now())`,
    );
    await expect(
      testDb.pool.query(
        `insert into reflections
           (study_date, participant_key, display_name, content, submitted_at, updated_at)
         values ('2026-08-17', 'alex', 'Alex', 'A different sufficiently long reflection body.', now(), now())`,
      ),
    ).rejects.toMatchObject({ code: '23505' }); // unique_violation
  });
});

describe('study_day_comparisons foreign key enforcement', () => {
  it('rejects a study_day_comparisons row referencing a study_date with no study_days row', async () => {
    await expect(
      testDb.pool.query(
        `insert into study_day_comparisons
           (study_date, request_id, status, model, input_fingerprint, started_at, updated_at)
         values ('2099-01-01', gen_random_uuid(), 'processing', 'gpt-5.4-mini', 'deadbeef', now(), now())`,
      ),
    ).rejects.toMatchObject({ code: '23503' }); // foreign_key_violation
  });
});

describe('study_day_comparisons enum enforcement', () => {
  it('rejects an out-of-range comparison_status value at the database level', async () => {
    await testDb.pool.query(
      `insert into study_days (study_date, article_id, article_title) values ('2026-08-17', 'a1', 'Title')`,
    );
    await expect(
      testDb.pool.query(
        `insert into study_day_comparisons
           (study_date, request_id, status, model, input_fingerprint, started_at, updated_at)
         values ('2026-08-17', gen_random_uuid(), 'bogus_status', 'gpt-5.4-mini', 'deadbeef', now(), now())`,
      ),
    ).rejects.toMatchObject({ code: '22P02' }); // invalid_text_representation (bad enum input)
  });
});

describe('study_day_comparisons check constraint enforcement', () => {
  it('rejects a completed row with no result', async () => {
    await testDb.pool.query(
      `insert into study_days (study_date, article_id, article_title) values ('2026-08-17', 'a1', 'Title')`,
    );
    await expect(
      testDb.pool.query(
        `insert into study_day_comparisons
           (study_date, request_id, status, model, input_fingerprint, started_at, updated_at)
         values ('2026-08-17', gen_random_uuid(), 'completed', 'gpt-5.4-mini', 'deadbeef', now(), now())`,
      ),
    ).rejects.toMatchObject({ code: '23514' }); // check_violation
  });

  it('rejects a non-completed row that does have a result', async () => {
    await testDb.pool.query(
      `insert into study_days (study_date, article_id, article_title) values ('2026-08-17', 'a1', 'Title')`,
    );
    await expect(
      testDb.pool.query(
        `insert into study_day_comparisons
           (study_date, request_id, status, model, input_fingerprint, result, started_at, updated_at)
         values ('2026-08-17', gen_random_uuid(), 'processing', 'gpt-5.4-mini', 'deadbeef', '{}'::jsonb, now(), now())`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts a completed row that does have a result', async () => {
    await testDb.pool.query(
      `insert into study_days (study_date, article_id, article_title) values ('2026-08-17', 'a1', 'Title')`,
    );
    await expect(
      testDb.pool.query(
        `insert into study_day_comparisons
           (study_date, request_id, status, model, input_fingerprint, result, started_at, updated_at, completed_at)
         values ('2026-08-17', gen_random_uuid(), 'completed', 'gpt-5.4-mini', 'deadbeef', '{}'::jsonb, now(), now(), now())`,
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe('study_day_comparisons unique constraint enforcement', () => {
  it('rejects a second row with the same request_id', async () => {
    await testDb.pool.query(
      `insert into study_days (study_date, article_id, article_title) values ('2026-08-17', 'a1', 'Title')`,
    );
    await testDb.pool.query(
      `insert into study_days (study_date, article_id, article_title) values ('2026-08-18', 'a1', 'Title')`,
    );
    const sharedRequestId = '11111111-1111-1111-1111-111111111111';
    await testDb.pool.query(
      `insert into study_day_comparisons
         (study_date, request_id, status, model, input_fingerprint, started_at, updated_at)
       values ('2026-08-17', $1, 'processing', 'gpt-5.4-mini', 'deadbeef', now(), now())`,
      [sharedRequestId],
    );
    await expect(
      testDb.pool.query(
        `insert into study_day_comparisons
           (study_date, request_id, status, model, input_fingerprint, started_at, updated_at)
         values ('2026-08-18', $1, 'processing', 'gpt-5.4-mini', 'deadbeef', now(), now())`,
        [sharedRequestId],
      ),
    ).rejects.toMatchObject({ code: '23505' }); // unique_violation
  });
});
