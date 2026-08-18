export interface MindlogicModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  profile_image_url?: string;
  type?: string;
  [key: string]: unknown;
}

/** The gateway wraps the model list in an envelope, not a bare array. */
export interface MindlogicModelsResponse {
  object: string;
  data: MindlogicModel[];
}

export interface MindlogicCreditsPeriodSummary {
  quota: number;
  used: number;
  remaining: number;
}

export interface MindlogicCreditsResponse {
  object: string;
  monthly_allocated: MindlogicCreditsPeriodSummary & { renewal_date: string };
  purchased: MindlogicCreditsPeriodSummary;
  total: MindlogicCreditsPeriodSummary;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * JSON Schema structured-output request, OpenAI-compatible shape. Not yet
 * verified against a real Mindlogic response (no chat completion call has
 * been made) — inferred from the snake_case convention confirmed on the
 * /models/ and /credits/ endpoints plus the near-universal OpenAI-compatible
 * gateway convention. Flagged for a smoke test before first real use.
 */
export interface JsonSchemaResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature?: number;
  response_format?: JsonSchemaResponseFormat;
  /** Explicitly false for non-streaming callers that want it stated rather than merely defaulted. */
  stream?: boolean;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionChoice {
  index?: number;
  message: ChatMessage;
  finish_reason?: string;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
  /** Perplexity extension. Daily news requires this field and fails closed if absent. */
  citations?: string[] | null;
  /** Perplexity extension; informative metadata only, never fetched by this server. */
  search_results?: Array<{
    title?: string;
    url?: string;
    date?: string;
    last_updated?: string;
    [key: string]: unknown;
  }> | null;
  [key: string]: unknown;
}

/**
 * Standard internal error taxonomy that all Mindlogic HTTP/network
 * failures map to. Every code falls into exactly one of three buckets:
 *
 *  1. RECEIVED_RESPONSE_ERROR_CODES — an actual HTTP response came back
 *     with a status code. Mindlogic definitely got the request and
 *     definitely responded with a clear rejection; certain, safe to
 *     release credits (402 additionally marks the month exhausted and
 *     is never retried). This covers every explicitly-named 4xx/5xx
 *     below, plus a `client_error` catch-all for any OTHER 4xx we don't
 *     have a specific name for — an unrecognized 4xx must never be
 *     treated as uncertain just because we lack a name for it.
 *  2. CERTAIN_NOT_SENT_ERROR_CODES (`connection_refused`) — the TCP/DNS
 *     connection itself never came up (ECONNREFUSED/ENOTFOUND/
 *     EAI_AGAIN). Certain the request bytes were never sent. Safe to
 *     release.
 *  3. UNCERTAIN_BILLING_ERROR_CODES (`timeout`, `connection_reset`,
 *     `incomplete_response`, `unknown`) — transmission/billing status is
 *     genuinely unknown; the request may have reached Mindlogic and even
 *     completed generation before the failure. Never released — held as
 *     'reconciliation_pending' instead.
 *
 * `request_timeout_response` (HTTP 408) is deliberately in bucket 1, not
 * bucket 3: it is a real response Mindlogic's own server sent, distinct
 * from our own client-side `timeout` (an AbortController firing with no
 * response at all).
 */
export type MindlogicErrorCode =
  | 'invalid_request' // 400
  | 'unauthorized' // 401
  | 'credits_exhausted' // 402
  | 'forbidden' // 403
  | 'not_found' // 404
  | 'request_timeout_response' // 408 — a real response, not our own timeout
  | 'conflict' // 409
  | 'validation_error' // 422
  | 'rate_limited' // 429
  | 'provider_error' // 500-599
  | 'client_error' // any other 4xx not named above — still a real, received response
  | 'timeout' // our own AbortController fired; no response received
  | 'connection_refused' // ECONNREFUSED / ENOTFOUND / EAI_AGAIN
  | 'connection_reset' // ECONNRESET
  | 'incomplete_response' // status/headers arrived but the body was truncated or malformed
  | 'unknown'; // unrecognized network failure — the conservative default, not a guess

/**
 * A single FastAPI/Pydantic-style validation error entry, reduced to only
 * its structural `type` and `loc` (field path) — never `msg` (free text,
 * may echo request content), never `input` (the actual rejected value),
 * never `ctx` (may embed arbitrary context data).
 */
export interface MindlogicValidationErrorDetail {
  type: string | null;
  loc: (string | number)[] | null;
}

/**
 * Safe-to-log diagnostic detail about an upstream error. Deliberately
 * narrow: never the raw response body, never the full error message,
 * never anything that could echo user input. `providerErrorCode` is
 * extracted only if it matches SAFE_SHORT_CODE_PATTERN (see client.ts) —
 * a full message string is never stored.
 */
export interface MindlogicErrorObservability {
  /** Allow-listed short code from the response body (e.g. body.error.code), if present and safe. */
  providerErrorCode: string | null;
  /** Provider-assigned request id from a recognized response header, if present. */
  providerRequestId: string | null;
  /** The response's Content-Type header, if a response was received. */
  contentType: string | null;
  /** Top-level key names of the parsed response body (never values), if parseable. */
  responseTopLevelKeys: string[] | null;
  /** Whether a FastAPI/Pydantic-style `detail` field was an array (typically validation errors) or a plain string, if present. */
  detailKind: 'array' | 'string' | null;
  /** Number of entries in `detail`, only when it was an array. */
  validationErrorCount: number | null;
  /** Up to 10 validation error entries' `type` + `loc` only — see MindlogicValidationErrorDetail. */
  validationErrors: MindlogicValidationErrorDetail[] | null;
}

export const EMPTY_ERROR_OBSERVABILITY: MindlogicErrorObservability = {
  providerErrorCode: null,
  providerRequestId: null,
  contentType: null,
  responseTopLevelKeys: null,
  detailKind: null,
  validationErrorCount: null,
  validationErrors: null,
};

export class MindlogicApiError extends Error {
  readonly code: MindlogicErrorCode;
  readonly status: number;
  readonly observability: MindlogicErrorObservability;

  constructor(
    code: MindlogicErrorCode,
    status: number,
    message: string,
    observability: MindlogicErrorObservability = EMPTY_ERROR_OBSERVABILITY,
  ) {
    super(message);
    this.name = 'MindlogicApiError';
    this.code = code;
    this.status = status;
    this.observability = observability;
  }
}

/**
 * 429/5xx retry policy, used by src/services/reflections/reflection-comparison-service.ts.
 * Only errors backed by an actual received HTTP response are retryable —
 * and even then, only `rate_limited`/`provider_error`. Every network-level
 * code (timeout, connection_refused, connection_reset, incomplete_response,
 * unknown) is deliberately excluded: Mindlogic has no Idempotency-Key
 * support, so retrying anything where we cannot be completely certain the
 * original POST never reached/was processed by the server risks
 * double-billing a real generative call — even connection_refused, though
 * certain-not-sent, is left out here simply because retry behavior for it
 * was not part of this change; it is still always safe to release (see
 * CERTAIN_NOT_SENT_ERROR_CODES). The other received-response codes (400,
 * 403, 404, 408, 409, 422, client_error) are client/config errors —
 * retrying an unchanged request won't fix them. 402 (credits exhausted)
 * must never retry.
 */
export const RETRYABLE_ERROR_CODES: readonly MindlogicErrorCode[] = [
  'rate_limited',
  'provider_error',
];

/** Every response actually received from Mindlogic with a non-2xx status — always safe to release. */
export const RECEIVED_RESPONSE_ERROR_CODES: readonly MindlogicErrorCode[] = [
  'invalid_request',
  'unauthorized',
  'credits_exhausted',
  'forbidden',
  'not_found',
  'request_timeout_response',
  'conflict',
  'validation_error',
  'rate_limited',
  'provider_error',
  'client_error',
];

export const NON_RETRYABLE_ERROR_CODES: readonly MindlogicErrorCode[] = [
  'invalid_request',
  'unauthorized',
  'credits_exhausted',
  'forbidden',
  'not_found',
  'request_timeout_response',
  'conflict',
  'validation_error',
  'client_error',
  'timeout',
  'connection_refused',
  'connection_reset',
  'incomplete_response',
  'unknown',
];

/**
 * Codes where we are CERTAIN the request never reached Mindlogic (the
 * connection itself never came up) — safe to release the reservation.
 */
export const CERTAIN_NOT_SENT_ERROR_CODES: readonly MindlogicErrorCode[] = ['connection_refused'];

/**
 * Codes where transmission/billing status is unknown — the request may
 * have reached Mindlogic and produced billable output. These must never
 * trigger releaseCredits(); the reservation is held as
 * 'reconciliation_pending' instead until an operator reconciles it
 * against Mindlogic's own /credits/ usage report.
 */
export const UNCERTAIN_BILLING_ERROR_CODES: readonly MindlogicErrorCode[] = [
  'timeout',
  'connection_reset',
  'incomplete_response',
  'unknown',
];
export const MAX_RETRY_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 500;

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  retryableCodes: readonly MindlogicErrorCode[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: MAX_RETRY_ATTEMPTS,
  baseDelayMs: RETRY_BASE_DELAY_MS,
  retryableCodes: RETRYABLE_ERROR_CODES,
};
