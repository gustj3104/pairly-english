import { z } from 'zod';

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

export const generatedDailyNewsSchema = z
  .object({
    title: safeText(240),
    sourceName: safeText(120),
    sourceUrl: z.string().max(2048),
    publishedAt: z.string().datetime({ offset: true }),
    summary: safeText(1200),
    content: safeText(8000),
    vocabulary: z.array(vocabularyItemSchema).length(8),
  })
  .strict()
  .superRefine((article, context) => {
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
  });

export type GeneratedDailyNews = z.infer<typeof generatedDailyNewsSchema>;

export interface DailyNewsArticle extends GeneratedDailyNews {
  id: string;
  studyDate: string;
  generatedAt: string;
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
      ],
      properties: {
        title: { type: 'string' },
        sourceName: { type: 'string' },
        sourceUrl: { type: 'string' },
        publishedAt: { type: 'string' },
        summary: { type: 'string' },
        content: { type: 'string' },
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
