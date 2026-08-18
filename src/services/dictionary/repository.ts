import { and, desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../db/schema.js';
import { dailyNewsArticles, dictionaryEntries, savedVocabulary } from '../../db/schema.js';
import { DictionaryError, type DictionaryEntry } from './types.js';
import { CURRENT_DICTIONARY_CACHE_SCHEMA_VERSION } from './provider.js';
import { TRANSLATED_DICTIONARY_CACHE_SCHEMA_VERSION } from './provider.js';

type Db = NodePgDatabase<typeof schema>;

function mapEntry(row: typeof dictionaryEntries.$inferSelect): DictionaryEntry {
  return {
    query: row.queryWord,
    normalizedWord: row.normalizedWord,
    pronunciation: row.pronunciation,
    audioUrl: row.audioUrl,
    meanings: row.meanings,
    koreanTranslations: row.koreanTranslations,
    sourceUrl: row.sourceUrl,
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

export interface SavedVocabularyRow {
  item: typeof savedVocabulary.$inferSelect;
  articleTitle: string | null;
}

export interface DictionaryRepository {
  getOrRefresh(
    word: string,
    now: Date,
    create: () => Promise<DictionaryEntry>,
  ): Promise<CachedLookup>;
  findEntry(word: string): Promise<DictionaryEntry | null>;
  findArticle(id: string): Promise<{ id: string; title: string; content: string } | null>;
  findSaved(participantKey: string, normalizedWord: string): Promise<SavedVocabularyRow | null>;
  saveVocabulary(input: typeof savedVocabulary.$inferInsert): Promise<SavedVocabularyRow>;
  listVocabulary(participantKey: string): Promise<SavedVocabularyRow[]>;
  deleteVocabulary(participantKey: string, normalizedWord: string): Promise<boolean>;
}

export interface DictionaryTranslationRepository {
  getOrCreateTranslation(
    word: string,
    create: (entry: DictionaryEntry) => Promise<string[]>,
  ): Promise<string[]>;
}

export class DrizzleDictionaryRepository
  implements DictionaryRepository, DictionaryTranslationRepository
{
  constructor(private readonly db: Db) {}

  async findEntry(word: string): Promise<DictionaryEntry | null> {
    const row = await this.db.query.dictionaryEntries.findFirst({
      where: eq(dictionaryEntries.normalizedWord, word),
    });
    return row && row.cacheSchemaVersion >= CURRENT_DICTIONARY_CACHE_SCHEMA_VERSION
      ? mapEntry(row)
      : null;
  }

  async getOrRefresh(
    word: string,
    now: Date,
    create: () => Promise<DictionaryEntry>,
  ): Promise<CachedLookup> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dictionary:${word}`}))`);
      const existing = await tx.query.dictionaryEntries.findFirst({
        where: eq(dictionaryEntries.normalizedWord, word),
      });
      if (
        existing &&
        existing.cacheSchemaVersion >= CURRENT_DICTIONARY_CACHE_SCHEMA_VERSION &&
        existing.expiresAt > now
      ) {
        return { entry: mapEntry(existing), cached: true, stale: false };
      }
      try {
        const fresh = await create();
        const [row] = await tx
          .insert(dictionaryEntries)
          .values({
            queryWord: fresh.query,
            normalizedWord: fresh.normalizedWord,
            meanings: fresh.meanings,
            koreanTranslations: fresh.koreanTranslations,
            pronunciation: fresh.pronunciation,
            audioUrl: fresh.audioUrl,
            sourceUrl: fresh.sourceUrl,
            cacheSchemaVersion: fresh.cacheSchemaVersion,
            fetchedAt: fresh.fetchedAt,
            expiresAt: fresh.expiresAt,
            updatedAt: fresh.fetchedAt,
          })
          .onConflictDoUpdate({
            target: dictionaryEntries.normalizedWord,
            set: {
              queryWord: fresh.query,
              meanings: fresh.meanings,
              pronunciation: fresh.pronunciation,
              audioUrl: fresh.audioUrl,
              sourceUrl: fresh.sourceUrl,
              // English refresh must preserve a completed word-level translation.
              koreanTranslations: existing?.koreanTranslations ?? fresh.koreanTranslations,
              cacheSchemaVersion:
                existing?.cacheSchemaVersion === TRANSLATED_DICTIONARY_CACHE_SCHEMA_VERSION
                  ? TRANSLATED_DICTIONARY_CACHE_SCHEMA_VERSION
                  : fresh.cacheSchemaVersion,
              fetchedAt: fresh.fetchedAt,
              expiresAt: fresh.expiresAt,
              updatedAt: fresh.fetchedAt,
            },
          })
          .returning();
        if (!row) throw new Error('dictionary upsert failed');
        return { entry: mapEntry(row), cached: false, stale: false };
      } catch (error) {
        if (
          existing &&
          existing.cacheSchemaVersion >= CURRENT_DICTIONARY_CACHE_SCHEMA_VERSION &&
          error instanceof DictionaryError &&
          ['DICTIONARY_RATE_LIMITED', 'DICTIONARY_TIMEOUT', 'DICTIONARY_UPSTREAM_ERROR'].includes(
            error.code,
          )
        ) {
          return { entry: mapEntry(existing), cached: true, stale: true };
        }
        throw error;
      }
    });
  }

  async getOrCreateTranslation(
    word: string,
    create: (entry: DictionaryEntry) => Promise<string[]>,
  ): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`dictionary-translation:${word}`}))`,
      );
      const row = await tx.query.dictionaryEntries.findFirst({
        where: eq(dictionaryEntries.normalizedWord, word),
      });
      if (!row) return [];
      if (row.cacheSchemaVersion >= TRANSLATED_DICTIONARY_CACHE_SCHEMA_VERSION) {
        return row.koreanTranslations;
      }
      const translations = await create(mapEntry(row));
      if (translations.length === 0) return [];
      await tx
        .update(dictionaryEntries)
        .set({
          koreanTranslations: translations,
          cacheSchemaVersion: TRANSLATED_DICTIONARY_CACHE_SCHEMA_VERSION,
          updatedAt: new Date(),
        })
        .where(eq(dictionaryEntries.normalizedWord, word));
      return translations;
    });
  }

  async findArticle(id: string) {
    const row = await this.db.query.dailyNewsArticles.findFirst({
      where: eq(dailyNewsArticles.id, id),
      columns: { id: true, title: true, content: true },
    });
    return row ?? null;
  }

  async saveVocabulary(input: typeof savedVocabulary.$inferInsert): Promise<SavedVocabularyRow> {
    const [item] = await this.db
      .insert(savedVocabulary)
      .values(input)
      .onConflictDoUpdate({
        target: [savedVocabulary.participantKey, savedVocabulary.normalizedWord],
        set: {
          word: input.word,
          senseId: input.senseId,
          pronunciation: input.pronunciation,
          audioUrl: input.audioUrl,
          partOfSpeech: input.partOfSpeech,
          definition: input.definition,
          example: input.example,
          koreanTranslations: input.koreanTranslations,
          sourceUrl: input.sourceUrl,
          articleId: input.articleId,
          contextSentence: input.contextSentence,
          savedAt: input.savedAt,
        },
      })
      .returning();
    if (!item) throw new Error('vocabulary upsert failed');
    const article = item.articleId ? await this.findArticle(item.articleId) : null;
    return { item, articleTitle: article?.title ?? null };
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
    return row ?? null;
  }

  async listVocabulary(participantKey: string): Promise<SavedVocabularyRow[]> {
    const rows = await this.db
      .select({ item: savedVocabulary, articleTitle: dailyNewsArticles.title })
      .from(savedVocabulary)
      .leftJoin(dailyNewsArticles, eq(savedVocabulary.articleId, dailyNewsArticles.id))
      .where(eq(savedVocabulary.participantKey, participantKey))
      .orderBy(desc(savedVocabulary.savedAt), desc(savedVocabulary.id));
    return rows;
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
