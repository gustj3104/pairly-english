import { DictionaryError, type DictionaryLookupResponse } from './types.js';
import type { DictionaryAiLookup } from './ai-lookup.js';
import type { DictionaryRepository, SavedVocabularyRow } from './repository.js';
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
  audioUrl: null;
  partOfSpeech: string;
  definition: string;
  // Nullable: a row saved before the AI-only redesign can have a null example. See
  // SavedVocabularyItemRow's comment in repository.ts.
  example: string | null;
  koreanTranslations: string[];
  senseId: string;
  articleId: string | null;
  articleTitle: string | null;
  contextSentence: string | null;
  savedAt: string;
}

function mapSaved(row: SavedVocabularyRow): SavedVocabularyItem {
  return {
    id: row.item.id,
    word: row.item.word,
    normalizedWord: row.item.normalizedWord,
    pronunciation: row.item.pronunciation,
    audioUrl: null,
    partOfSpeech: row.item.partOfSpeech,
    definition: row.item.definition,
    example: row.item.example,
    koreanTranslations: row.item.koreanTranslations,
    senseId: row.item.senseId,
    articleId: row.item.articleId,
    articleTitle: row.articleTitle,
    contextSentence: row.item.contextSentence,
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

export { DictionaryError };

export class DictionaryService {
  constructor(
    private readonly repository: DictionaryRepository,
    private readonly aiLookup: DictionaryAiLookup,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async lookup(
    word: string,
    options: { forceRetry?: boolean } = {},
  ): Promise<DictionaryLookupResponse> {
    const now = this.now();
    const result = await this.repository.getOrRefresh(
      word,
      now,
      () => this.aiLookup.fetchEntry(word, now),
      { force: options.forceRetry },
    );
    return dictionaryLookupResponseSchema.parse({
      query: result.entry.query,
      normalizedWord: result.entry.normalizedWord,
      pronunciation: result.entry.pronunciation,
      audioUrl: null,
      koreanTranslations: result.entry.koreanTranslations,
      koreanTranslationStatus: 'available',
      meanings: result.entry.meanings,
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
    if (input.contextSentence && !input.articleId) {
      throw new VocabularyError('INVALID_ARTICLE_CONTEXT', 400);
    }
    if (input.articleId) {
      const article = await this.repository.findArticle(input.articleId);
      if (!article) throw new VocabularyError('ARTICLE_NOT_FOUND', 404);
      if (input.contextSentence) {
        const parsedContext = contextSentenceSchema.safeParse(input.contextSentence);
        if (!parsedContext.success) throw new VocabularyError('INVALID_ARTICLE_CONTEXT', 400);
        contextSentence = normalizedSpaces(parsedContext.data);
        const content = normalizedSpaces(article.content);
        if (!content.includes(contextSentence)) {
          throw new VocabularyError('CONTEXT_NOT_IN_ARTICLE', 400);
        }
        if (!containsWord(contextSentence, word)) {
          throw new VocabularyError('WORD_NOT_IN_CONTEXT', 400);
        }
      }
      articleId = article.id;
    }
    const existing = await this.repository.findSaved(participantKey, word, sense.senseId);
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
      partOfSpeech: sense.partOfSpeech,
      definition: sense.definition,
      example: sense.example,
      koreanTranslations: sense.koreanTranslations,
      articleId,
      contextSentence,
      savedAt: this.now(),
    });
    return mapSaved(saved);
  }

  async list(participantKey: string): Promise<SavedVocabularyItem[]> {
    return (await this.repository.listVocabulary(participantKey)).map(mapSaved);
  }

  delete(participantKey: string, word: string, senseId?: string): Promise<boolean> {
    return this.repository.deleteVocabulary(participantKey, word, senseId);
  }
}
