import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * One row per calendar month (Asia/Seoul), tracking the running totals
 * used to enforce the monthly credit hard cap.
 */
export const creditPeriods = pgTable('credit_periods', {
  billingMonth: varchar('billing_month', { length: 7 }).primaryKey(), // 'YYYY-MM'
  committedCredits: integer('committed_credits').notNull().default(0),
  reservedCredits: integer('reserved_credits').notNull().default(0),
  providerReportedCredits: integer('provider_reported_credits').notNull().default(0),
  exhausted: boolean('exhausted').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creditStatusEnum = pgEnum('credit_status', [
  'reserved',
  'completed',
  'failed',
  'released',
]);

export const creditFeatureEnum = pgEnum('credit_feature', [
  'reflection_comparison',
  'grammar_feedback',
  'vocabulary_extraction',
  'news_processing',
  'reconciliation_adjustment',
]);

/**
 * One row per AI request. Deliberately excludes original content
 * (essays, news text, transcripts, audio) — only accounting metadata.
 */
export const creditUsageRecords = pgTable('credit_usage_records', {
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
});
