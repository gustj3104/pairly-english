import { and, desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../db/schema.js';
import type { DictionaryAttributionJson, DictionaryMeaningJson } from '../../db/schema.js';
import { dailyNewsArticles, dictionaryEntries, savedVocabulary } from '../../db/schema.js';
import {
  AI_DICTIONARY_CACHE_SCHEMA_VERSION,
  DictionaryError,
  type DictionaryEntry,
} from './types.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * Fixed internal sentinel values written to the legacy `source_url`/`attribution` NOT NULL
 * columns for every AI-generated row. Never a real external URL or license — an AI result has
 * no such thing — and never returned by the public API or shown in the UI (see the
 * dictionaryEntries table comment in src/db/schema.ts for why the columns still exist).
 */
export const AI_GENERATED_SOURCE_URL = 'internal:mindlogic-ai-generated';
export const AI_GENERATED_ATTRIBUTION: DictionaryAttributionJson = {
  provider: 'Mindlogic AI Gateway',
  name: 'AI-generated',
  license: 'N/A',
  licenseUrl: 'internal:mindlogic-ai-generated',
};

/**
 * Cache-schema version for a row that only records a failed-lookup cooldown timestamp — no
 * successful AI result exists yet. Reuses the oldest legacy version number (rather than
 * inventing 0, which the table's `cache_schema_version_positive` CHECK constraint forbids
 * anyway): both mean the same thing to every reader, "always stale, always regenerate."
 */
const PENDING_LOOKUP_CACHE_SCHEMA_VERSION = 1;
const PENDING_SENTINEL_MEANINGS: DictionaryMeaningJson[] = [
  { senseId: '0'.repeat(64), partOfSpeech: 'pending', definition: 'pending', example: 'pending' },
];

function mapEntry(row: typeof dictionaryEntries.$inferSelect): DictionaryEntry {
  return {
    query: row.queryWord,
    normalizedWord: row.normalizedWord,
    pronunciation: row.pronunciation,
    koreanTranslations: row.koreanTranslations,
    meanings: row.meanings.map((meaning) => ({
      senseId: meaning.senseId,
      partOfSpeech: meaning.partOfSpeech,
      definition: meaning.definition,
      example: meaning.example,
    })),
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
    cacheSchemaVersion: row.cacheSchemaVersion,
  };
}

export interface CachedLookup {
  entry: DictionaryEntry;
  cached: boolean;
  stale: boolean;
}

export interface SavedVocabularyItemRow {
  id: string;
  word: string;
  normalizedWord: string;
  senseId: string;
  pronunciation: string | null;
  partOfSpeech: string;
  definition: string;
  // Nullable because a row saved before this AI-only redesign can have a null example (the old
  // FreeDictionaryAPI-backed flow allowed it) — every new save always writes a real, non-empty
  // string (see SaveVocabularyInput.example below), but existing rows must keep reading back
  // correctly rather than being hidden by a stricter contract.
  example: string | null;
  koreanTranslations: string[];
  articleId: string | null;
  contextSentence: string | null;
  savedAt: Date;
}

export interface SavedVocabularyRow {
  item: SavedVocabularyItemRow;
  articleTitle: string | null;
}

export interface SaveVocabularyInput {
  participantKey: string;
  word: string;
  normalizedWord: string;
  senseId: string;
  pronunciation: string | null;
  partOfSpeech: string;
  definition: string;
  example: string;
  koreanTranslations: string[];
  articleId: string | null;
  contextSentence: string | null;
  savedAt: Date;
}

export interface GetOrRefreshOptions {
  /** User-initiated retry — bypasses the automatic-retry cooldown below. Never bypasses the
   * fresh-cache short-circuit: an already-successful, unexpired entry is never re-requested. */
  force?: boolean;
}

export interface DictionaryRepository {
  getOrRefresh(
    word: string,
    now: Date,
    create: () => Promise<DictionaryEntry>,
    options?: GetOrRefreshOptions,
  ): Promise<CachedLookup>;
  findEntry(word: string): Promise<DictionaryEntry | null>;
  findArticle(id: string): Promise<{ id: string; title: string; content: string } | null>;
  findSaved(participantKey: string, normalizedWord: string): Promise<SavedVocabularyRow | null>;
  saveVocabulary(input: SaveVocabularyInput): Promise<SavedVocabularyRow>;
  listVocabulary(participantKey: string): Promise<SavedVocabularyRow[]>;
  deleteVocabulary(participantKey: string, normalizedWord: string): Promise<boolean>;
}

/**
 * A word whose AI lookup keeps failing (a systematic Mindlogic/schema/credit-limit issue, not a
 * transient one) must never turn into an unbounded automatic retry: every plain page view or
 * word click that reaches DictionaryService.lookup() would otherwise re-spend a Mindlogic
 * reservation for the same word, forever, with no user action requesting it. This cooldown
 * throttles *automatic* re-attempts only; an explicit user retry (`force: true`, from the
 * dictionary panel's "다시 시도" action) always bypasses it, still bounded by the existing
 * monthly credit cap in CreditService.
 */
export const AUTOMATIC_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Pure decision of whether getOrRefresh should skip calling the AI lookup and just report "not
 * ready yet" (or serve stale content, if any exists) instead — i.e. this attempt is an automatic
 * retry arriving before the cooldown following the last attempt has elapsed. Extracted so it's
 * unit-testable without a real Postgres transaction.
 */
export function shouldSkipAutomaticRetry(
  lastAttemptedAt: Date | null,
  now: Date,
  force: boolean | undefined,
): boolean {
  if (force) return false;
  if (!lastAttemptedAt) return false;
  return now.getTime() - lastAttemptedAt.getTime() < AUTOMATIC_RETRY_COOLDOWN_MS;
}

export class DrizzleDictionaryRepository implements DictionaryRepository {
  constructor(private readonly db: Db) {}

  async findEntry(word: string): Promise<DictionaryEntry | null> {
    const row = await this.db.query.dictionaryEntries.findFirst({
      where: eq(dictionaryEntries.normalizedWord, word),
    });
    return row && row.cacheSchemaVersion >= AI_DICTIONARY_CACHE_SCHEMA_VERSION
      ? mapEntry(row)
      : null;
  }

  async getOrRefresh(
    word: string,
    now: Date,
    create: () => Promise<DictionaryEntry>,
    options: GetOrRefreshOptions = {},
  ): Promise<CachedLookup> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dictionary:${word}`}))`);
      const existing = await tx.query.dictionaryEntries.findFirst({
        where: eq(dictionaryEntries.normalizedWord, word),
      });

      if (existing && existing.cacheSchemaVersion >= AI_DICTIONARY_CACHE_SCHEMA_VERSION) {
        if (existing.expiresAt > now) {
          return { entry: mapEntry(existing), cached: true, stale: false };
        }
        // A previously-successful AI entry whose (near-permanent) TTL finally lapsed. If a
        // refresh was already attempted recently, don't hit Mindlogic again on every view —
        // just keep serving the still-good last-known result.
        if (shouldSkipAutomaticRetry(existing.koreanTranslationAttemptedAt, now, options.force)) {
          return { entry: mapEntry(existing), cached: true, stale: true };
        }
      } else if (
        existing &&
        shouldSkipAutomaticRetry(existing.koreanTranslationAttemptedAt, now, options.force)
      ) {
        // No usable entry yet (never succeeded, or pre-AI legacy data) and a lookup was already
        // attempted recently — report unavailable instead of spending another Mindlogic call.
        throw new DictionaryError('DICTIONARY_AI_UNAVAILABLE', 503);
      }

      try {
        const fresh = await create();
        const values = {
          queryWord: fresh.query,
          normalizedWord: fresh.normalizedWord,
          meanings: fresh.meanings,
          koreanTranslations: fresh.koreanTranslations,
          pronunciation: fresh.pronunciation,
          audioUrl: null,
          sourceUrl: AI_GENERATED_SOURCE_URL,
          attribution: AI_GENERATED_ATTRIBUTION,
          cacheSchemaVersion: fresh.cacheSchemaVersion,
          koreanTranslationAttemptedAt: now,
          fetchedAt: fresh.fetchedAt,
          expiresAt: fresh.expiresAt,
          updatedAt: fresh.fetchedAt,
        };
        const [row] = await tx
          .insert(dictionaryEntries)
          .values(values)
          .onConflictDoUpdate({ target: dictionaryEntries.normalizedWord, set: values })
          .returning();
        if (!row) throw new Error('dictionary upsert failed');
        return { entry: mapEntry(row), cached: false, stale: false };
      } catch (error) {
        if (error instanceof DictionaryError) {
          if (existing) {
            await tx
              .update(dictionaryEntries)
              .set({ koreanTranslationAttemptedAt: now })
              .where(eq(dictionaryEntries.normalizedWord, word));
          } else {
            await tx
              .insert(dictionaryEntries)
              .values({
                queryWord: word,
                normalizedWord: word,
                meanings: PENDING_SENTINEL_MEANINGS,
                koreanTranslations: [],
                pronunciation: null,
                audioUrl: null,
                sourceUrl: AI_GENERATED_SOURCE_URL,
                attribution: AI_GENERATED_ATTRIBUTION,
                cacheSchemaVersion: PENDING_LOOKUP_CACHE_SCHEMA_VERSION,
                koreanTranslationAttemptedAt: now,
                fetchedAt: now,
                expiresAt: new Date(now.getTime() + AUTOMATIC_RETRY_COOLDOWN_MS),
                updatedAt: now,
              })
              // The advisory lock already serializes every writer for this word within this
              // transaction; a conflict here would only mean a row appeared through some other
              // path (e.g. a since-fixed bug) — never clobber real data with the pending sentinel.
              .onConflictDoNothing({ target: dictionaryEntries.normalizedWord });
          }
        }
        throw error;
      }
    });
  }

  async findArticle(id: string) {
    const row = await this.db.query.dailyNewsArticles.findFirst({
      where: eq(dailyNewsArticles.id, id),
      columns: { id: true, title: true, content: true },
    });
    return row ?? null;
  }

  async saveVocabulary(input: SaveVocabularyInput): Promise<SavedVocabularyRow> {
    const { participantKey, ...rest } = input;
    const [item] = await this.db
      .insert(savedVocabulary)
      .values({
        participantKey,
        word: rest.word,
        normalizedWord: rest.normalizedWord,
        senseId: rest.senseId,
        pronunciation: rest.pronunciation,
        audioUrl: null,
        partOfSpeech: rest.partOfSpeech,
        definition: rest.definition,
        example: rest.example,
        koreanTranslations: rest.koreanTranslations,
        sourceUrl: AI_GENERATED_SOURCE_URL,
        attribution: AI_GENERATED_ATTRIBUTION,
        articleId: rest.articleId,
        contextSentence: rest.contextSentence,
        savedAt: rest.savedAt,
      })
      .onConflictDoUpdate({
        target: [savedVocabulary.participantKey, savedVocabulary.normalizedWord],
        set: {
          word: rest.word,
          senseId: rest.senseId,
          pronunciation: rest.pronunciation,
          audioUrl: null,
          partOfSpeech: rest.partOfSpeech,
          definition: rest.definition,
          example: rest.example,
          koreanTranslations: rest.koreanTranslations,
          sourceUrl: AI_GENERATED_SOURCE_URL,
          attribution: AI_GENERATED_ATTRIBUTION,
          articleId: rest.articleId,
          contextSentence: rest.contextSentence,
          savedAt: rest.savedAt,
        },
      })
      .returning();
    if (!item) throw new Error('vocabulary upsert failed');
    const article = item.articleId ? await this.findArticle(item.articleId) : null;
    return { item: mapSavedItem(item), articleTitle: article?.title ?? null };
  }

  async findSaved(
    participantKey: string,
    normalizedWord: string,
  ): Promise<SavedVocabularyRow | null> {
    const [row] = await this.db
      .select({ item: savedVocabulary, articleTitle: dailyNewsArticles.title })
      .from(savedVocabulary)
      .leftJoin(dailyNewsArticles, eq(savedVocabulary.articleId, dailyNewsArticles.id))
      .where(
        and(
          eq(savedVocabulary.participantKey, participantKey),
          eq(savedVocabulary.normalizedWord, normalizedWord),
        ),
      )
      .limit(1);
    return row ? { item: mapSavedItem(row.item), articleTitle: row.articleTitle } : null;
  }

  async listVocabulary(participantKey: string): Promise<SavedVocabularyRow[]> {
    const rows = await this.db
      .select({ item: savedVocabulary, articleTitle: dailyNewsArticles.title })
      .from(savedVocabulary)
      .leftJoin(dailyNewsArticles, eq(savedVocabulary.articleId, dailyNewsArticles.id))
      .where(eq(savedVocabulary.participantKey, participantKey))
      .orderBy(desc(savedVocabulary.savedAt), desc(savedVocabulary.id));
    return rows.map((row) => ({ item: mapSavedItem(row.item), articleTitle: row.articleTitle }));
  }

  async deleteVocabulary(participantKey: string, normalizedWord: string): Promise<boolean> {
    const rows = await this.db
      .delete(savedVocabulary)
      .where(
        and(
          eq(savedVocabulary.participantKey, participantKey),
          eq(savedVocabulary.normalizedWord, normalizedWord),
        ),
      )
      .returning({ id: savedVocabulary.id });
    return rows.length > 0;
  }
}

function mapSavedItem(row: typeof savedVocabulary.$inferSelect): SavedVocabularyItemRow {
  return {
    id: row.id,
    word: row.word,
    normalizedWord: row.normalizedWord,
    senseId: row.senseId,
    pronunciation: row.pronunciation,
    partOfSpeech: row.partOfSpeech,
    definition: row.definition,
    example: row.example,
    koreanTranslations: row.koreanTranslations,
    articleId: row.articleId,
    contextSentence: row.contextSentence,
    savedAt: row.savedAt,
  };
}
