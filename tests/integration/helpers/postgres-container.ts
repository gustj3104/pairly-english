import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../../../src/db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../src/db/migrations');

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  db: NodePgDatabase<typeof schema>;
}

/**
 * Starts a throwaway PostgreSQL container (Testcontainers), applies the
 * real Drizzle migrations from src/db/migrations, and returns a ready
 * connection. Never touches a developer's local or remote database —
 * connection details come entirely from the ephemeral container.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('pairly_english_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const db = drizzle(pool, { schema });

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return { container, pool, db };
}

export async function stopTestDatabase(testDb: TestDatabase): Promise<void> {
  await testDb.pool.end();
  await testDb.container.stop();
}

/** Clears both tables between tests so each test starts from an empty ledger. */
export async function truncateCreditTables(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE TABLE credit_usage_records, credit_periods RESTART IDENTITY CASCADE');
}

/** Clears both daily-reflection tables between tests so each test starts from an empty state. */
export async function truncateStudyDayTables(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE TABLE reflections, study_days RESTART IDENTITY CASCADE');
}
