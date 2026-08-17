/**
 * Every state the reflection-comparison UI needs to distinguish, mapped
 * 1:1 from the server's HTTP contract (see pairly-english-server's
 * `src/routes/reflections.ts`). `validation` and `unknown` are collapsed
 * into a generic error by callers — they should never happen against a
 * request this client built itself, so there's no dedicated user-facing
 * copy for them.
 */
export type ApiErrorKind =
  | 'validation'
  | 'credit_limit_exceeded'
  | 'reconciliation_pending'
  | 'rate_limited'
  | 'backend_unavailable'
  | 'invalid_response'
  | 'unknown'

/**
 * Carries only a message already safe to show a user — never the raw
 * provider/server error body. Server-side detail (upstream status,
 * requestId) is kept for support/debugging, not for display.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  readonly requestId?: string

  constructor(kind: ApiErrorKind, message: string, options: { status?: number; requestId?: string } = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = options.status
    this.requestId = options.requestId
  }
}
