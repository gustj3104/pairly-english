export interface MindlogicModel {
  id: string;
  [key: string]: unknown;
}

export interface MindlogicCreditsResponse {
  remaining: number;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: { message: ChatMessage; finishReason: string }[];
  usage: ChatCompletionUsage;
}

/** Standard internal error taxonomy that all Mindlogic HTTP failures map to. */
export type MindlogicErrorCode =
  'unauthorized' | 'payment_required' | 'rate_limited' | 'server_error' | 'unknown';

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
 * 429/5xx retry policy: types and constants only for now. Not yet wired
 * into MindlogicClient — no outbound call retries until the real AI
 * endpoint work begins. 402 (payment/credit exhausted) must never retry.
 */
export const RETRYABLE_ERROR_CODES: readonly MindlogicErrorCode[] = [
  'rate_limited',
  'server_error',
];
export const NON_RETRYABLE_ERROR_CODES: readonly MindlogicErrorCode[] = [
  'unauthorized',
  'payment_required',
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
