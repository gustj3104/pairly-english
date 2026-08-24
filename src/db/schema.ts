import {
  boolean,
  check,
  date,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
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
  'daily_news',
  'dictionary_translation',
  'dictionary_generation',
  'grammar_feedback',
  'vocabulary_extraction',
  'news_processing',
  'reconciliation_adjustment',
  // Minimal bare-messages provider contract check (scripts/mindlogic-contract-check.ts)
  // — not a user-facing feature, but still goes through the real credit ledger.
  'provider_contract_check',
]);

/** One validated, generated learning article per Asia/Seoul study date. */
export const dailyNewsArticles = pgTable('daily_news_articles', {
  id: uuid('id').primaryKey().defaultRandom(),
  studyDate: date('study_date', { mode: 'string' }).notNull().unique(),
  title: varchar('title', { length: 240 }).notNull(),
  sourceName: varchar('source_name', { length: 120 }).notNull(),
  sourceUrl: varchar('source_url', { length: 2048 }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
  summary: varchar('summary', { length: 1200 }).notNull(),
  content: text('content').notNull(),
  vocabulary: jsonb('vocabulary').notNull(),
});

export interface DictionaryMeaningJson {
  senseId: string;
  partOfSpeech: string;
  koreanTranslations: string[];
  definition: string;
  example: string;
}

/**
 * Legacy column, kept only so pre-AI (FreeDictionaryAPI/Wiktionary) rows still satisfy the
 * table's NOT NULL constraint without a migration. Current (cacheSchemaVersion >= 5, AI-only)
 * rows write a fixed internal sentinel here (see AI_GENERATED_ATTRIBUTION in
 * src/services/dictionary/repository.ts) — never a real external source — and this field is
 * never returned by the public API or shown in the UI. See "Dictionary lookup" in the README.
 */
export interface DictionaryAttributionJson {
  provider: string;
  name: string;
  license: string;
  licenseUrl: string;
}

const LEGACY_FREEDICTIONARYAPI_ATTRIBUTION_DEFAULT = sql`'{"provider":"FreeDictionaryAPI.com","name":"Wiktionary","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0/"}'::jsonb`;

/**
 * Bounded, cached dictionary lookup results. cacheSchemaVersion >= 5 (see
 * AI_DICTIONARY_CACHE_SCHEMA_VERSION in repository.ts) means a single-call Mindlogic AI result;
 * anything lower is a pre-AI (FreeDictionaryAPI/Wiktionary) row that always gets regenerated on
 * its next lookup rather than served. Mindlogic response bodies are never persisted verbatim.
 */
export const dictionaryEntries = pgTable(
  'dictionary_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queryWord: varchar('query_word', { length: 60 }).notNull(),
    normalizedWord: varchar('normalized_word', { length: 60 }).notNull().unique(),
    meanings: jsonb('meanings').$type<DictionaryMeaningJson[]>().notNull(),
    koreanTranslations: jsonb('korean_translations').$type<string[]>().notNull().default([]),
    koreanTranslationAttemptedAt: timestamp('korean_translation_attempted_at', {
      withTimezone: true,
    }),
    // Set every time an AI lookup attempt finishes (success or failure), never left untouched on
    // a failure. Lets getOrRefresh() throttle automatic re-attempts for a word whose lookup keeps
    // failing, without ever permanently caching the failure itself as a successful entry (only a
    // real success bumps cacheSchemaVersion to AI_DICTIONARY_CACHE_SCHEMA_VERSION). Column name
    // predates the single-call AI redesign (see repository.ts) but is reused as-is to avoid a
    // migration.
    pronunciation: varchar('pronunciation', { length: 240 }),
    // Legacy column from the removed FreeDictionaryAPI/dictionaryapi.dev providers. AI lookups
    // never produce audio and always write null; kept only so old rows still read back cleanly.
    audioUrl: varchar('audio_url', { length: 2048 }),
    // NOT NULL with no real per-row meaning for an AI-generated entry (there is no external
    // source URL) — AI rows write a fixed internal sentinel (see AI_GENERATED_SOURCE_URL in
    // repository.ts), never a real fetchable link, and it is never returned by the public API.
    sourceUrl: varchar('source_url', { length: 2048 }).notNull(),
    // Every row written before this column existed came from FreeDictionaryAPI, so the DB-level
    // default backfills existing legacy rows accurately. AI rows always set this explicitly to
    // AI_GENERATED_ATTRIBUTION (repository.ts) — never a real external license/source.
    attribution: jsonb('attribution')
      .$type<DictionaryAttributionJson>()
      .notNull()
      .default(LEGACY_FREEDICTIONARYAPI_ATTRIBUTION_DEFAULT),
    cacheSchemaVersion: integer('cache_schema_version').notNull().default(1),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('dictionary_entries_expires_at_idx').on(table.expiresAt),
    check('dictionary_entries_query_word_non_blank', sql`length(trim(${table.queryWord})) > 0`),
    check(
      'dictionary_entries_normalized_word_non_blank',
      sql`length(trim(${table.normalizedWord})) > 0`,
    ),
    check('dictionary_entries_meanings_non_empty', sql`jsonb_array_length(${table.meanings}) > 0`),
    check('dictionary_entries_expiry_after_fetch', sql`${table.expiresAt} > ${table.fetchedAt}`),
    check('dictionary_entries_cache_schema_version_positive', sql`${table.cacheSchemaVersion} > 0`),
    check(
      'dictionary_entries_attribution_is_object',
      sql`jsonb_typeof(${table.attribution}) = 'object'`,
    ),
  ],
);

export const savedVocabulary = pgTable(
  'saved_vocabulary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    participantKey: text('participant_key').notNull(),
    word: varchar('word', { length: 60 }).notNull(),
    normalizedWord: varchar('normalized_word', { length: 60 })
      .notNull()
      .references(() => dictionaryEntries.normalizedWord, { onDelete: 'restrict' }),
    senseId: varchar('sense_id', { length: 64 }).notNull(),
    pronunciation: varchar('pronunciation', { length: 240 }),
    // Legacy column; AI-saved vocabulary never has audio and always writes null.
    audioUrl: varchar('audio_url', { length: 2048 }),
    partOfSpeech: varchar('part_of_speech', { length: 80 }).notNull(),
    definition: text('definition').notNull(),
    example: text('example'),
    koreanTranslations: jsonb('korean_translations').$type<string[]>().notNull().default([]),
    // NOT NULL with no real per-row meaning for an AI-generated save — see the dictionaryEntries
    // comment above; kept as a fixed internal sentinel, never a real source, never returned by
    // the public API.
    sourceUrl: varchar('source_url', { length: 2048 }).notNull(),
    // Snapshotted at save time, same rationale as koreanTranslations above: a later cache
    // refresh of this word must never silently change the attribution already shown for a word
    // the user already saved. AI saves always snapshot AI_GENERATED_ATTRIBUTION.
    attribution: jsonb('attribution')
      .$type<DictionaryAttributionJson>()
      .notNull()
      .default(LEGACY_FREEDICTIONARYAPI_ATTRIBUTION_DEFAULT),
    articleId: uuid('article_id').references(() => dailyNewsArticles.id, { onDelete: 'set null' }),
    contextSentence: varchar('context_sentence', { length: 1000 }),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('saved_vocabulary_participant_word_sense_unique').on(
      table.participantKey,
      table.normalizedWord,
      table.senseId,
    ),
    index('saved_vocabulary_participant_saved_at_idx').on(table.participantKey, table.savedAt),
    check('saved_vocabulary_participant_non_blank', sql`length(trim(${table.participantKey})) > 0`),
    check('saved_vocabulary_definition_non_blank', sql`length(trim(${table.definition})) > 0`),
    check(
      'saved_vocabulary_part_of_speech_non_blank',
      sql`length(trim(${table.partOfSpeech})) > 0`,
    ),
    check(
      'saved_vocabulary_korean_translations_array',
      sql`jsonb_typeof(${table.koreanTranslations}) = 'array'`,
    ),
    check(
      'saved_vocabulary_attribution_is_object',
      sql`jsonb_typeof(${table.attribution}) = 'object'`,
    ),
  ],
);

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

/**
 * One row per calendar day of the "daily reflection" MVP feature. Seeded
 * by whichever participant submits first (INSERT ... ON CONFLICT DO
 * NOTHING in DrizzleDailyReflectionRepository.submitReflection) — that
 * first submitter's article info wins for the day. See
 * src/services/daily-reflections/daily-reflection-repository.ts for the
 * `SELECT ... FOR UPDATE` locking that makes the max-2-participants rule
 * below race-safe.
 */
export const studyDays = pgTable('study_days', {
  // 'YYYY-MM-DD', enforced by PostgreSQL's native date type.
  studyDate: date('study_date', { mode: 'string' }).primaryKey(),
  articleId: text('article_id').notNull(),
  articleTitle: text('article_title').notNull(),
  articleSourceUrl: text('article_source_url'),
  articleSummary: text('article_summary'),
  // The discussion step is one shared, in-person conversation between both
  // participants (offline, never uploaded) — so its completion is a single
  // flag for the day, not one per participant. First participant to mark
  // it wins, same "first writer wins" idempotency as the article fields
  // above; never overwritten afterward.
  discussionCompletedAt: timestamp('discussion_completed_at', { withTimezone: true }),
  discussionCompletedBy: text('discussion_completed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reflectionStatusEnum = pgEnum('reflection_status', [
  // Only value for this iteration — drafts are never persisted server-side.
  'submitted',
]);

/**
 * One row per participant per study day. Deliberately excludes any
 * hashed/derived form of participant_key in a separate accounting table —
 * unlike credit_usage_records, this table itself IS the record of
 * content, so participant_key and display_name are stored in the clear
 * here (only log lines are restricted — see hashForLogging in
 * src/services/daily-reflections/participant-key.ts).
 */
export const reflections = pgTable(
  'reflections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studyDate: date('study_date', { mode: 'string' })
      .notNull()
      .references(() => studyDays.studyDate),
    // Normalized (trim + NFKC + lowercase) session name — stable identity
    // signal for "the same person" without a real accounts table.
    participantKey: text('participant_key').notNull(),
    displayName: text('display_name').notNull(),
    content: text('content').notNull(),
    status: reflectionStatusEnum('status').notNull().default('submitted'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // At most one reflection per participant per day — the DB-level
    // backstop for the same invariant the FOR UPDATE lock enforces at
    // the application level.
    unique('reflections_study_date_participant_key_unique').on(
      table.studyDate,
      table.participantKey,
    ),
    check('reflections_display_name_non_blank', sql`length(trim(${table.displayName})) > 0`),
    check('reflections_content_non_blank', sql`length(trim(${table.content})) > 0`),
  ],
);

export const comparisonStatusEnum = pgEnum('comparison_status', [
  'processing',
  'completed',
  'failed',
  // Mindlogic transmission/billing status for this attempt is unknown
  // (mirrors credit_status's 'reconciliation_pending' — see
  // src/services/credits/credit-repository.ts). Never auto-retried.
  'reconciliation_pending',
]);

/**
 * One row per calendar day, period — not one row per attempt. A retry
 * after a 'failed' state UPDATEs this same row in place (new
 * `request_id`, status back to 'processing') rather than inserting a
 * second row; per-attempt history is deliberately NOT kept here. It's
 * kept in `credit_usage_records` instead — every `request_id` that ever
 * gets a credit reservation (including failed/retried attempts) already
 * has its own permanent row there via the existing credit-ledger code,
 * cross-referenceable by the shared `request_id` value. See
 * src/services/daily-reflections/comparison-repository.ts for the
 * claim-then-generate locking that makes this table's writes race-safe,
 * and README "Study-day comparison" for the full two-phase design.
 */
export const studyDayComparisons = pgTable(
  'study_day_comparisons',
  {
    studyDate: date('study_date', { mode: 'string' })
      .primaryKey()
      .references(() => studyDays.studyDate),
    // Must be the exact same request_id that ends up in
    // credit_usage_records for that attempt (see
    // ReflectionComparisonDeps.generateRequestId) — lets an operator
    // cross-reference the two tables during manual crash recovery.
    requestId: uuid('request_id').notNull().unique(),
    status: comparisonStatusEnum('status').notNull(),
    model: text('model').notNull(),
    // SHA-256 hex digest of the day's article id + both reflections'
    // (participantKey, content) pairs, sorted by participantKey — see
    // src/services/daily-reflections/comparison-fingerprint.ts. Never
    // reversible back to reflection content.
    inputFingerprint: text('input_fingerprint').notNull(),
    result: jsonb('result'),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // A completed row always has a result; a non-completed row never
    // does — mirrors credit_usage_records_reconciliation_pending_has_error_code's
    // pattern of enforcing "every status has exactly the data it needs".
    check(
      'study_day_comparisons_completed_has_result',
      sql`(${table.status} = 'completed') = (${table.result} IS NOT NULL)`,
    ),
  ],
);
