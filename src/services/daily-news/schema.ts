import { z } from 'zod';
import { DAILY_NEWS_TOPICS } from './weekday-topics.js';

const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/<\/?(?:script|style|iframe|object|embed|html)\b/i.test(value), {
      message: 'HTML is not allowed',
    });

export const vocabularyItemSchema = z
  .object({
    word: safeText(60),
    definition: safeText(300),
    example: safeText(500),
  })
  .strict();

/** Enum of the fixed weekday topics — see weekday-topics.ts for the single source of truth. */
export const dailyNewsTopicSchema = z.enum(DAILY_NEWS_TOPICS);

const dailyNewsArticleFields = {
  title: safeText(240),
  sourceName: safeText(120),
  sourceUrl: z.string().max(2048),
  publishedAt: z.string().datetime({ offset: true }),
  summary: safeText(1200),
  content: safeText(8000),
  vocabulary: z.array(vocabularyItemSchema).length(8),
};

/** Shared by both the public/persisted schema and the model-response schema below. */
function checkVocabularyAppearsInContent(
  article: { vocabulary: { word: string }[]; content: string },
  context: z.RefinementCtx,
): void {
  const normalized = article.vocabulary.map((item) => item.word.normalize('NFKC').toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: 'custom', path: ['vocabulary'], message: 'duplicate words' });
  }
  for (const [index, item] of article.vocabulary.entries()) {
    const escaped = item.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      !new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(
        article.content,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['vocabulary', index, 'word'],
        message: 'word must appear in content',
      });
    }
  }
}

/** Public/persisted article contract — deliberately has no `topic` field (see DailyNewsArticle). */
export const generatedDailyNewsSchema = z
  .object(dailyNewsArticleFields)
  .strict()
  .superRefine(checkVocabularyAppearsInContent);

export type GeneratedDailyNews = z.infer<typeof generatedDailyNewsSchema>;

/**
 * Raw sonar-pro response contract: the public article fields plus the
 * `topic` the model claims it searched for, which generator.ts checks
 * against the required weekday topic before ever constructing the public
 * `GeneratedDailyNews` (topic never reaches storage or the API response).
 */
export const dailyNewsModelResponseSchema = z
  .object({ ...dailyNewsArticleFields, topic: dailyNewsTopicSchema })
  .strict()
  .superRefine(checkVocabularyAppearsInContent);

export type DailyNewsModelResponse = z.infer<typeof dailyNewsModelResponseSchema>;

/**
 * The public/served contract: unlike `GeneratedDailyNews` (the
 * generation-time contract, which still requires a real validated https
 * source URL from the model — see generator.ts), `sourceUrl` here is
 * `string | null`. A stored row's URL is re-validated on every read
 * (`repository.ts`'s `mapRow`) so a legacy/invalid value never fails the
 * rest of the article response — it serves as `null` instead of a guessed
 * or unvalidated fallback.
 */
export interface DailyNewsArticle extends Omit<GeneratedDailyNews, 'sourceUrl'> {
  id: string;
  studyDate: string;
  generatedAt: string;
  sourceUrl: string | null;
}

export const DAILY_NEWS_JSON_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'daily_news_article',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'title',
        'sourceName',
        'sourceUrl',
        'publishedAt',
        'summary',
        'content',
        'vocabulary',
        'topic',
      ],
      properties: {
        title: { type: 'string' },
        sourceName: { type: 'string' },
        sourceUrl: { type: 'string' },
        publishedAt: { type: 'string' },
        summary: { type: 'string' },
        content: { type: 'string' },
        topic: { type: 'string', enum: DAILY_NEWS_TOPICS },
        vocabulary: {
          type: 'array',
          minItems: 8,
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['word', 'definition', 'example'],
            properties: {
              word: { type: 'string' },
              definition: { type: 'string' },
              example: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const;
