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

/** Standard internal error taxonomy that all Mindlogic HTTP failures map to. */
export type MindlogicErrorCode =
  'unauthorized' | 'payment_required' | 'rate_limited' | 'server_error' | 'timeout' | 'unknown';

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
 * `timeout` (our own AbortController firing) and `unknown` (a network
 * failure with no response) are deliberately excluded: Mindlogic has no
 * Idempotency-Key support, so if we can't be sure the original POST never
 * reached/was processed by the server, retrying risks double-billing a
 * real generative call. 402 (payment/credit exhausted) must never retry.
 */
export const RETRYABLE_ERROR_CODES: readonly MindlogicErrorCode[] = [
  'rate_limited',
  'server_error',
];
export const NON_RETRYABLE_ERROR_CODES: readonly MindlogicErrorCode[] = [
  'unauthorized',
  'payment_required',
  'timeout',
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
