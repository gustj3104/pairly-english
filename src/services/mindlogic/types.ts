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
  [key: string]: unknown;
}

/**
 * Standard internal error taxonomy that all Mindlogic HTTP/network
 * failures map to.
 *
 *  - unauthorized / payment_required / rate_limited / server_error: a
 *    real HTTP response was received — Mindlogic definitely got the
 *    request and definitely responded. Certain, safe to release credits.
 *  - connection_refused: the TCP/DNS connection itself never came up
 *    (ECONNREFUSED/ENOTFOUND/EAI_AGAIN) — certain the request bytes were
 *    never sent. Safe to release.
 *  - timeout / connection_reset / incomplete_response / unknown:
 *    transmission and billing status is UNKNOWN — the request may have
 *    reached Mindlogic and even completed generation before the failure.
 *    Never release credits for these; see UNCERTAIN_BILLING_ERROR_CODES.
 */
export type MindlogicErrorCode =
  | 'unauthorized'
  | 'payment_required'
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'connection_refused'
  | 'connection_reset'
  | 'incomplete_response'
  | 'unknown';

export class MindlogicApiError extends Error {
  readonly code: MindlogicErrorCode;
  readonly status: number;

  constructor(code: MindlogicErrorCode, status: number, message: string) {
    super(message);
    this.name = 'MindlogicApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 429/5xx retry policy, used by src/services/reflections/reflection-comparison-service.ts.
 * Only errors backed by an actual received HTTP response are retryable.
 * Every network-level code (timeout, connection_refused, connection_reset,
 * incomplete_response, unknown) is deliberately excluded: Mindlogic has no
 * Idempotency-Key support, so retrying anything where we cannot be
 * completely certain the original POST never reached/was processed by
 * the server risks double-billing a real generative call — even
 * connection_refused, though certain-not-sent, is left out here simply
 * because retry behavior for it was not part of this change; it is
 * still always safe to release (see CERTAIN_NOT_SENT_ERROR_CODES). 402
 * (payment/credit exhausted) must never retry.
 */
export const RETRYABLE_ERROR_CODES: readonly MindlogicErrorCode[] = [
  'rate_limited',
  'server_error',
];
export const NON_RETRYABLE_ERROR_CODES: readonly MindlogicErrorCode[] = [
  'unauthorized',
  'payment_required',
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
