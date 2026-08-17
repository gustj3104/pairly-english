import { postJson } from './client'
import { ApiError } from './errors'
import {
  compareReflectionsRequestSchema,
  reflectionComparisonResponseSchema,
  type CompareReflectionsRequest,
  type ComparisonResult,
} from './schemas'

/**
 * Real backend-backed implementation of `AIService.compareReflections`.
 * Never falls back to mock data on failure — a failed call surfaces as a
 * thrown `ApiError` for the caller (`AIComparisonPage`) to render.
 */
export async function compareReflections(input: CompareReflectionsRequest): Promise<ComparisonResult> {
  // Validates our own outgoing request — a failure here is a frontend bug,
  // not a user-facing error, so it's allowed to throw the raw ZodError.
  const requestBody = compareReflectionsRequestSchema.parse(input)

  const raw = await postJson<unknown>('/api/v1/reflections/compare', requestBody)

  const parsed = reflectionComparisonResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ApiError('invalid_response', '서버 응답 형식이 올바르지 않습니다.')
  }
  return parsed.data
}
