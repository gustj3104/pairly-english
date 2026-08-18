import { z } from 'zod';
import {
  REFLECTION_MAX_LENGTH,
  REFLECTION_MIN_LENGTH,
  SOURCE_URL_MAX_LENGTH,
  SUMMARY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '../reflections/schema.js';

export const ARTICLE_ID_MAX_LENGTH = 200;

/** Rejects empty and whitespace-only strings without silently trimming stored content. */
function nonBlank(maxLength: number, label: string) {
  return z
    .string()
    .max(maxLength, `${label} must be at most ${maxLength} characters`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);
}

const reflectionContentSchema = z
  .string()
  .max(REFLECTION_MAX_LENGTH, `reflection must be at most ${REFLECTION_MAX_LENGTH} characters`)
  .refine(
    (value) => value.trim().length >= REFLECTION_MIN_LENGTH,
    `reflection must be at least ${REFLECTION_MIN_LENGTH} non-blank characters`,
  );

/**
 * `.strict()` on both this object and the nested `article` object so the
 * schema itself rejects an unexpected client-supplied identity field
 * (e.g. `displayName`, `participantKey`) rather than silently ignoring
 * it — the submitter's identity always comes from the verified session,
 * never the request body (see src/routes/study-days.ts).
 */
export const submitReflectionRequestSchema = z
  .object({
    article: z
      .object({
        id: nonBlank(ARTICLE_ID_MAX_LENGTH, 'article.id'),
        title: nonBlank(TITLE_MAX_LENGTH, 'article.title'),
        sourceUrl: z.string().url().max(SOURCE_URL_MAX_LENGTH).nullable().optional(),
        summary: z.string().max(SUMMARY_MAX_LENGTH).nullable().optional(),
      })
      .strict(),
    reflection: reflectionContentSchema,
  })
  .strict();

export type SubmitReflectionRequest = z.infer<typeof submitReflectionRequestSchema>;
