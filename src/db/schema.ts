import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * One row per calendar month (Asia/Seoul), tracking the running totals
 * used to enforce the monthly credit hard cap.
 */
export const creditPeriods = pgTable(
  'credit_periods',
  {
    billingMonth: varchar('billing_month', { length: 7 }).primaryKey(), // 'YYYY-MM'
    committedCredits: integer('committed_credits').notNull().default(0),
    reservedCredits: integer('reserved_credits').notNull().default(0),
    providerReportedCredits: integer('provider_reported_credits').notNull().default(0),
    exhausted: boolean('exhausted').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Defense in depth: application logic should never produce a negative
    // running total, but a real PostgreSQL constraint catches it (a bad
    // migration, a manual UPDATE, a future bug) instead of silently
    // corrupting the credit ledger.
    check('credit_periods_committed_credits_non_negative', sql`${table.committedCredits} >= 0`),
    check('credit_periods_reserved_credits_non_negative', sql`${table.reservedCredits} >= 0`),
    check(
      'credit_periods_provider_reported_credits_non_negative',
      sql`${table.providerReportedCredits} >= 0`,
    ),
  ],
);

export const creditStatusEnum = pgEnum('credit_status', [
  'reserved',
  'completed',
  'failed',
  'released',
  // Transmission/billing status to Mindlogic could not be determined
  // (timeout, connection reset, response cut off mid-stream) — the
  // reservation is held, not released, until an operator reconciles it
  // against Mindlogic's own /credits/ usage report. See
  // src/services/credits/reconciliation.ts.
  'reconciliation_pending',
]);

export const creditFeatureEnum = pgEnum('credit_feature', [
  'reflection_comparison',
  'grammar_feedback',
  'vocabulary_extraction',
  'news_processing',
  'reconciliation_adjustment',
  // Minimal bare-messages provider contract check (scripts/mindlogic-contract-check.ts)
  // — not a user-facing feature, but still goes through the real credit ledger.
  'provider_contract_check',
]);

/**
 * One row per AI request. Deliberately excludes original content
 * (essays, news text, transcripts, audio) — only accounting metadata.
 */
export const creditUsageRecords = pgTable(
  'credit_usage_records',
  {
    requestId: uuid('request_id').primaryKey(),
    billingMonth: varchar('billing_month', { length: 7 })
      .notNull()
      .references(() => creditPeriods.billingMonth),
    feature: creditFeatureEnum('feature').notNull(),
    model: text('model').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    creditsReserved: integer('credits_reserved').notNull(),
    creditsUsed: integer('credits_used'),
    status: creditStatusEnum('status').notNull(),
    errorCode: text('error_code'),
    userRef: text('user_ref'),
    retryCount: integer('retry_count').notNull().default(0),
  },
  (table) => [
    check('credit_usage_records_input_tokens_non_negative', sql`${table.inputTokens} >= 0`),
    check('credit_usage_records_output_tokens_non_negative', sql`${table.outputTokens} >= 0`),
    check('credit_usage_records_credits_reserved_non_negative', sql`${table.creditsReserved} >= 0`),
    check(
      'credit_usage_records_credits_used_non_negative',
      sql`${table.creditsUsed} IS NULL OR ${table.creditsUsed} >= 0`,
    ),
    check('credit_usage_records_retry_count_non_negative', sql`${table.retryCount} >= 0`),
    // Every reconciliation_pending row must record why it's pending —
    // an operator reconciling the ledger needs to know what happened
    // without cross-referencing application logs.
    check(
      'credit_usage_records_reconciliation_pending_has_error_code',
      sql`${table.status} != 'reconciliation_pending' OR ${table.errorCode} IS NOT NULL`,
    ),
  ],
);
