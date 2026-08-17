import { z } from 'zod'

/**
 * Mirrors pairly-english-server's request/response contract for
 * `POST /api/v1/reflections/compare` (see that repo's
 * `src/services/reflections/schema.ts`). Kept as the single source of
 * truth for these shapes on the frontend — nothing else redefines them.
 */

const authorSchema = z.object({
  displayName: z.string().min(1),
  reflection: z.string().min(1),
})

export const compareReflectionsRequestSchema = z.object({
  article: z.object({
    title: z.string().min(1),
    sourceUrl: z.string().url().optional(),
    summary: z.string().optional(),
  }),
  mine: authorSchema,
  partner: authorSchema,
})

export type CompareReflectionsRequest = z.infer<typeof compareReflectionsRequestSchema>

const stanceQuoteSchema = z.object({
  stance: z.string(),
  quote: z.string(),
})

export const discussionTopicSchema = z.object({
  question: z.string(),
  reason: z.string(),
  difficulty: z.enum(['Intermediate', 'Advanced']),
})

export type DiscussionTopic = z.infer<typeof discussionTopicSchema>

export const reflectionComparisonResponseSchema = z.object({
  requestId: z.string(),
  commonGround: z.array(
    z.object({ point: z.string(), mine: z.string(), partner: z.string() }),
  ).min(1),
  differences: z.array(
    z.object({ topic: z.string(), mine: stanceQuoteSchema, partner: stanceQuoteSchema }),
  ).min(1),
  topics: z.array(discussionTopicSchema).length(3),
})

export type ComparisonResult = z.infer<typeof reflectionComparisonResponseSchema>

/**
 * Mirrors pairly-english-server's `/api/v1/auth/*` contract (see that
 * repo's `src/routes/auth.ts`).
 */

export const loginResponseSchema = z.object({
  name: z.string().min(1),
})

export type LoginResponse = z.infer<typeof loginResponseSchema>

export const sessionResponseSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(true), name: z.string().min(1) }),
  z.object({ authenticated: z.literal(false) }),
])

export type SessionResponse = z.infer<typeof sessionResponseSchema>
