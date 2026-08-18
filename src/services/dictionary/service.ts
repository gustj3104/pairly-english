import { DICTIONARY_SOURCE, DictionaryError, type DictionaryLookupResponse } from './types.js';
import type { DictionaryFetch } from './provider.js';
import { fetchDictionaryEntry } from './provider.js';
import type {
  DictionaryRepository,
  DictionaryTranslationRepository,
  SavedVocabularyRow,
} from './repository.js';
import type { DictionaryTranslator } from './translation.js';
import { contextSentenceSchema, dictionaryLookupResponseSchema } from './validation.js';

export class VocabularyError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(code);
  }
}

export interface SavedVocabularyItem {
  id: string;
  word: string;
  normalizedWord: string;
  pronunciation: string | null;
  audioUrl: string | null;
  partOfSpeech: string;
  definition: string;
  example: string | null;
  koreanTranslations: string[];
  articleId: string | null;
  articleTitle: string | null;
  contextSentence: string | null;
  source: typeof DICTIONARY_SOURCE & { url: string };
  savedAt: string;
}

function mapSaved(row: SavedVocabularyRow): SavedVocabularyItem {
  return {
    id: row.item.id,
    word: row.item.word,
    normalizedWord: row.item.normalizedWord,
    pronunciation: row.item.pronunciation,
    audioUrl: row.item.audioUrl,
    partOfSpeech: row.item.partOfSpeech,
    definition: row.item.definition,
    example: row.item.example,
    koreanTranslations: row.item.koreanTranslations,
    articleId: row.item.articleId,
    articleTitle: row.articleTitle,
    contextSentence: row.item.contextSentence,
    source: { ...DICTIONARY_SOURCE, url: row.item.sourceUrl },
    savedAt: row.item.savedAt.toISOString(),
  };
}

function normalizedSpaces(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function containsWord(sentence: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`, 'i').test(sentence);
}

/** Minimal, Pino-shaped logging surface — never required, never given anything but safe fields. */
export interface DictionaryServiceLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export class DictionaryService {
  constructor(
    private readonly repository: DictionaryRepository,
    private readonly fetchImpl: DictionaryFetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly translationRepository?: DictionaryTranslationRepository,
    private readonly translator?: DictionaryTranslator,
    private readonly logger?: DictionaryServiceLogger,
  ) {}

  async lookup(word: string): Promise<DictionaryLookupResponse> {
    const result = await this.repository.getOrRefresh(word, this.now(), () =>
      fetchDictionaryEntry(word, this.fetchImpl, this.now),
    );
    let koreanTranslations = result.entry.koreanTranslations;
    if (this.translationRepository && this.translator) {
      try {
        koreanTranslations = await this.translationRepository.getOrCreateTranslation(
          result.entry.normalizedWord,
          (entry) => this.translator!.translate(entry),
        );
      } catch (error) {
        // Never lets a Mindlogic/translation-storage failure fail the whole lookup — the
        // English result (already committed by getOrRefresh, in its own transaction) is
        // always returned. Nothing here is promoted to cache version 3, so the next
        // explicit lookup retries translation instead of permanently caching a miss.
        this.logger?.warn(
          {
            feature: 'dictionary_translation',
            failureStage: 'korean_translation',
            internalErrorCode: error instanceof Error ? error.name : 'unknown',
            cacheHit: result.cached,
          },
          'Korean translation failed; serving English dictionary result only',
        );
        koreanTranslations = [];
      }
    }
    return dictionaryLookupResponseSchema.parse({
      query: result.entry.query,
      normalizedWord: result.entry.normalizedWord,
      koreanTranslations,
      koreanTranslationStatus: koreanTranslations.length > 0 ? 'available' : 'unavailable',
      pronunciation: result.entry.pronunciation,
      audioUrl: result.entry.audioUrl,
      meanings: result.entry.meanings,
      source: { ...DICTIONARY_SOURCE, url: result.entry.sourceUrl },
      cached: result.cached,
      stale: result.stale,
    });
  }

  async save(
    participantKey: string,
    word: string,
    input: { senseId: string; articleId?: string; contextSentence?: string },
  ): Promise<SavedVocabularyItem> {
    const entry = await this.repository.findEntry(word);
    if (!entry) throw new VocabularyError('DICTIONARY_ENTRY_NOT_CACHED', 409);
    const sense = entry.meanings.find((meaning) => meaning.senseId === input.senseId);
    if (!sense) throw new VocabularyError('INVALID_SENSE_ID', 400);
    let articleId: string | null = null;
    let contextSentence: string | null = null;
    if (input.articleId || input.contextSentence) {
      if (!input.articleId || !input.contextSentence) {
        throw new VocabularyError('INVALID_ARTICLE_CONTEXT', 400);
      }
      const parsedContext = contextSentenceSchema.safeParse(input.contextSentence);
      if (!parsedContext.success) throw new VocabularyError('INVALID_ARTICLE_CONTEXT', 400);
      const article = await this.repository.findArticle(input.articleId);
      if (!article) throw new VocabularyError('ARTICLE_NOT_FOUND', 404);
      contextSentence = normalizedSpaces(parsedContext.data);
      const content = normalizedSpaces(article.content);
      if (!content.includes(contextSentence)) {
        throw new VocabularyError('CONTEXT_NOT_IN_ARTICLE', 400);
      }
      if (!containsWord(contextSentence, word)) {
        throw new VocabularyError('WORD_NOT_IN_CONTEXT', 400);
      }
      articleId = article.id;
    }
    const existing = await this.repository.findSaved(participantKey, word);
    if (
      existing &&
      existing.item.senseId === sense.senseId &&
      existing.item.articleId === articleId &&
      existing.item.contextSentence === contextSentence
    ) {
      return mapSaved(existing);
    }
    const saved = await this.repository.saveVocabulary({
      participantKey,
      word: entry.query,
      normalizedWord: entry.normalizedWord,
      senseId: sense.senseId,
      pronunciation: entry.pronunciation,
      audioUrl: entry.audioUrl,
      partOfSpeech: sense.partOfSpeech,
      definition: sense.definition,
      example: sense.example,
      koreanTranslations: entry.koreanTranslations,
      sourceUrl: entry.sourceUrl,
      articleId,
      contextSentence,
      savedAt: this.now(),
    });
    return mapSaved(saved);
  }

  async list(participantKey: string): Promise<SavedVocabularyItem[]> {
    return (await this.repository.listVocabulary(participantKey)).map(mapSaved);
  }

  delete(participantKey: string, word: string): Promise<boolean> {
    return this.repository.deleteVocabulary(participantKey, word);
  }
}

export { DictionaryError };
