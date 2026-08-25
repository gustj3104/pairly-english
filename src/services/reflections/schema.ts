import { z } from 'zod';

export const REFLECTION_MIN_LENGTH = 50;
export const REFLECTION_MAX_LENGTH = 6000;
export const DISPLAY_NAME_MAX_LENGTH = 80;
export const TITLE_MAX_LENGTH = 300;
export const SUMMARY_MAX_LENGTH = 2000;
export const SOURCE_URL_MAX_LENGTH = 2000;

/** Rejects empty and whitespace-only strings without silently trimming stored content. */
function nonBlank(maxLength: number, label: string) {
  return z
    .string()
    .max(maxLength, `${label} must be at most ${maxLength} characters`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);
}

const reflectionSchema = z
  .string()
  .max(REFLECTION_MAX_LENGTH, `reflection must be at most ${REFLECTION_MAX_LENGTH} characters`)
  .refine(
    (value) => value.trim().length >= REFLECTION_MIN_LENGTH,
    `reflection must be at least ${REFLECTION_MIN_LENGTH} non-blank characters`,
  );

const authorSchema = z.object({
  displayName: nonBlank(DISPLAY_NAME_MAX_LENGTH, 'displayName'),
  reflection: reflectionSchema,
});

export const compareReflectionsRequestSchema = z.object({
  article: z.object({
    title: nonBlank(TITLE_MAX_LENGTH, 'article.title'),
    sourceUrl: z.string().url().max(SOURCE_URL_MAX_LENGTH).optional(),
    summary: z.string().max(SUMMARY_MAX_LENGTH).optional(),
  }),
  mine: authorSchema,
  partner: authorSchema,
});

export type CompareReflectionsRequest = z.infer<typeof compareReflectionsRequestSchema>;

// --- Schema Mindlogic's structured output is validated against ---

const STANCE_MAX_LENGTH = 200;
const QUOTE_MAX_LENGTH = 400;
const POINT_MAX_LENGTH = 300;
const TOPIC_LABEL_MAX_LENGTH = 200;
const QUESTION_MAX_LENGTH = 300;
const REASON_MAX_LENGTH = 400;
const GUIDE_QUESTION_MAX_LENGTH = 400;

export const DISCUSSION_DIFFICULTIES = ['Intermediate', 'Advanced'] as const;

const stanceQuoteSchema = z
  .object({
    stance: z.string().min(1).max(STANCE_MAX_LENGTH),
    quote: z.string().min(1).max(QUOTE_MAX_LENGTH),
  })
  .strict();

const commonGroundItemSchema = z
  .object({
    point: z.string().min(1).max(POINT_MAX_LENGTH),
    mine: z.string().min(1).max(QUOTE_MAX_LENGTH),
    partner: z.string().min(1).max(QUOTE_MAX_LENGTH),
  })
  .strict();

const differenceItemSchema = z
  .object({
    topic: z.string().min(1).max(TOPIC_LABEL_MAX_LENGTH),
    mine: stanceQuoteSchema,
    partner: stanceQuoteSchema,
  })
  .strict();

const discussionTopicSchema = z
  .object({
    question: z.string().min(1).max(QUESTION_MAX_LENGTH),
    reason: z.string().min(1).max(REASON_MAX_LENGTH),
    difficulty: z.enum(DISCUSSION_DIFFICULTIES),
    discussionGuide: z
      .object({
        openingQuestion: z.string().min(1).max(GUIDE_QUESTION_MAX_LENGTH),
        followUpQuestions: z.array(z.string().min(1).max(GUIDE_QUESTION_MAX_LENGTH)).length(3),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Re-validated with Zod after parsing the model's JSON, independent of
 * the response_format JSON Schema sent in the request — Mindlogic is an
 * upstream we don't fully trust even with structured output requested.
 */
export const reflectionComparisonSchema = z
  .object({
    commonGround: z.array(commonGroundItemSchema).min(1).max(4),
    differences: z.array(differenceItemSchema).min(1).max(4),
    topics: z.array(discussionTopicSchema).length(3),
    // Server-owned shared UI state. Mindlogic never emits this field; it is
    // added later through the authenticated discussion-topic endpoint.
    selectedTopicIndex: z.number().int().min(0).max(2).optional(),
  })
  .strict();

export type ReflectionComparisonResult = z.infer<typeof reflectionComparisonSchema>;
