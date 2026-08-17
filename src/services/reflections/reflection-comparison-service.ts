import { randomUUID } from 'node:crypto';
import type { CreditService } from '../credits/credit-service.js';
import type { UsageSummary } from '../credits/types.js';
import { calculateCredits } from '../credits/credit-calculator.js';
import { getBillingMonth } from '../credits/billing-period.js';
import type { MindlogicClient } from '../mindlogic/client.js';
import {
  MindlogicApiError,
  MAX_RETRY_ATTEMPTS,
  RETRYABLE_ERROR_CODES,
  RETRY_BASE_DELAY_MS,
  UNCERTAIN_BILLING_ERROR_CODES,
} from '../mindlogic/types.js';
import type {
  ChatCompletionResponse,
  ChatMessage,
  MindlogicErrorCode,
} from '../mindlogic/types.js';
import { getFeatureModelConfig } from '../mindlogic/feature-config.js';
import { estimateChatRequestInputTokens } from '../mindlogic/token-estimate.js';
import {
  REFLECTION_COMPARISON_RESPONSE_FORMAT,
  REFLECTION_COMPARISON_SYSTEM_PROMPT,
  buildReflectionComparisonUserMessage,
} from './prompt.js';
import { reflectionComparisonSchema } from './schema.js';
import type { CompareReflectionsRequest, ReflectionComparisonResult } from './schema.js';

const FEATURE = 'reflection_comparison' as const;

/**
 * Everything the log line is allowed to carry (see README "Logging" /
 * task section 8): requestId, feature, model, token counts, reserved and
 * actual credits — never reflection text, article body, names, the API
 * key, an Authorization header, or the model's raw response.
 */
export interface ReflectionComparisonAccounting {
  feature: typeof FEATURE;
  model: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  reservedCredits: number | null;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualCredits: number | null;
}

export type ReflectionComparisonOutcome = {
  requestId: string;
  accounting: ReflectionComparisonAccounting;
} & (
  | { status: 'ok'; result: ReflectionComparisonResult }
  | { status: 'limit_exceeded'; usage: UsageSummary }
  | { status: 'provider_exhausted' }
  | { status: 'upstream_failed'; code: MindlogicErrorCode; upstreamStatus: number }
  | { status: 'upstream_schema_error' }
  | { status: 'reservation_exceeded' }
  /**
   * Mindlogic's response to this request could not be confirmed
   * (timeout / connection reset / mid-response disconnect) — the
   * reservation is held as 'reconciliation_pending', not released, and
   * this requestId must not be retried until an operator reconciles it.
   */
  | { status: 'reconciliation_pending'; code: MindlogicErrorCode; upstreamStatus: number }
);

/** Default retries after the first attempt (2 retries = 3 total attempts), i.e. MAX_RETRY_ATTEMPTS unchanged. */
const DEFAULT_MAX_RETRIES = MAX_RETRY_ATTEMPTS - 1;

export interface ReflectionComparisonDeps {
  creditService: CreditService;
  mindlogicClient: MindlogicClient;
  /** Injectable for tests; defaults to the real clock. */
  now?: () => Date;
  /** Injectable for tests so retry backoff never actually waits. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests that need a deterministic requestId. */
  generateRequestId?: () => string;
  /**
   * Number of retries after the first attempt for 429/5xx responses (0 =
   * never retry, i.e. at most one provider POST no matter what). Defaults
   * to the standard policy (`MAX_RETRY_ATTEMPTS - 1`). Never affects
   * timeout/connection_reset/incomplete_response/unknown, which are
   * never retried regardless of this value — see UNCERTAIN_BILLING_ERROR_CODES.
   */
  maxRetries?: number;
}

async function callWithRetry(
  attempt: () => Promise<ChatCompletionResponse>,
  sleep: (ms: number) => Promise<void>,
  maxAttempts: number,
): Promise<ChatCompletionResponse> {
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      return await attempt();
    } catch (error) {
      const retryable =
        error instanceof MindlogicApiError && RETRYABLE_ERROR_CODES.includes(error.code);
      if (!retryable || attemptNumber === maxAttempts) {
        throw error;
      }
      await sleep(RETRY_BASE_DELAY_MS * attemptNumber);
    }
  }
  /* istanbul ignore next -- loop always returns or throws */
  throw new Error('unreachable: retry loop exited without returning or throwing');
}

function buildAccounting(
  model: string,
  estimatedInputTokens: number,
  maxOutputTokens: number,
): ReflectionComparisonAccounting {
  return {
    feature: FEATURE,
    model,
    estimatedInputTokens,
    maxOutputTokens,
    reservedCredits: null,
    actualInputTokens: null,
    actualOutputTokens: null,
    actualCredits: null,
  };
}

/**
 * Orchestrates one reflection-comparison AI call end to end: reserve →
 * call Mindlogic (with a conservative retry policy) → validate → settle.
 * Returns a discriminated union rather than throwing for any expected
 * business outcome, so the HTTP route can map each case to a stable
 * response without try/catch branching on error subtypes.
 */
export async function compareReflections(
  input: CompareReflectionsRequest,
  deps: ReflectionComparisonDeps,
): Promise<ReflectionComparisonOutcome> {
  const now = deps.now ?? (() => new Date());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const generateRequestId = deps.generateRequestId ?? (() => randomUUID());

  const requestId = generateRequestId();
  const { model, maxOutputTokens } = getFeatureModelConfig(FEATURE);

  const userMessageContent = buildReflectionComparisonUserMessage(input);
  const messages: ChatMessage[] = [
    { role: 'system', content: REFLECTION_COMPARISON_SYSTEM_PROMPT },
    { role: 'user', content: userMessageContent },
  ];

  // Estimated from the exact payload that will be sent — same `messages`
  // array and response_format object reused below, so the estimate can
  // never drift from what actually goes over the wire.
  const estimatedInputTokens = estimateChatRequestInputTokens({
    messages,
    responseFormatSchema: REFLECTION_COMPARISON_RESPONSE_FORMAT,
  });

  const accounting = buildAccounting(model, estimatedInputTokens, maxOutputTokens);

  const reservation = await deps.creditService.reserveCredits({
    requestId,
    feature: FEATURE,
    model,
    inputTokens: estimatedInputTokens,
    outputTokens: maxOutputTokens,
    now: now(),
  });

  if (!reservation.ok) {
    if (reservation.reason === 'reconciliation_pending') {
      // A prior attempt with this exact requestId is still unresolved —
      // must not call Mindlogic again for it.
      return {
        status: 'reconciliation_pending',
        requestId,
        code: (reservation.record.errorCode as MindlogicErrorCode | null) ?? 'unknown',
        // Only the error code is persisted on the DB record, not the raw
        // HTTP status from the original attempt — 0 here just means
        // "not available from this replay path", not "no response".
        upstreamStatus: 0,
        accounting,
      };
    }
    return { status: 'limit_exceeded', requestId, usage: reservation.usage, accounting };
  }

  const reservedCredits = reservation.record.creditsReserved;
  accounting.reservedCredits = reservedCredits;

  const maxAttempts = (deps.maxRetries ?? DEFAULT_MAX_RETRIES) + 1;

  let completion: ChatCompletionResponse;
  try {
    completion = await callWithRetry(
      () =>
        deps.mindlogicClient.createChatCompletion({
          model,
          max_tokens: maxOutputTokens,
          messages,
          response_format: REFLECTION_COMPARISON_RESPONSE_FORMAT,
        }),
      sleep,
      maxAttempts,
    );
  } catch (error) {
    if (error instanceof MindlogicApiError) {
      if (error.code === 'payment_required') {
        await deps.creditService.releaseCredits(requestId, 'mindlogic_payment_required');
        await deps.creditService.markExhausted(getBillingMonth(now()));
        return { status: 'provider_exhausted', requestId, accounting };
      }

      if (UNCERTAIN_BILLING_ERROR_CODES.includes(error.code)) {
        // We cannot tell whether Mindlogic received/billed this request.
        // Releasing here could let real usage silently exceed the 5,000
        // cap once an actual charge lands after we'd already freed the
        // budget. Hold the reservation instead — reserved_credits keeps
        // counting against the monthly budget until an operator
        // reconciles this specific requestId against Mindlogic's own
        // /credits/ report (see src/services/credits/reconciliation.ts).
        await deps.creditService.markReconciliationPending(requestId, error.code);
        return {
          status: 'reconciliation_pending',
          requestId,
          code: error.code,
          upstreamStatus: error.status,
          accounting,
        };
      }

      // Every other code here is backed by either an actual HTTP
      // response (401/429/5xx) or a certain "never reached the server"
      // signal (connection_refused) — safe to release.
      await deps.creditService.releaseCredits(requestId, error.code);
      return {
        status: 'upstream_failed',
        requestId,
        code: error.code,
        upstreamStatus: error.status,
        accounting,
      };
    }
    // Not a MindlogicApiError at all — this happened before any network
    // call could even be attempted (e.g. a bug in payload construction).
    // Nothing was sent, so releasing is safe.
    await deps.creditService.releaseCredits(requestId, 'unknown_error');
    throw error;
  }

  if (!completion.usage) {
    // A response arrived with no usage figures — content may have been
    // produced, so we cannot assume zero cost. Commit the full
    // reservation as the conservative worst case.
    await deps.creditService.commitCredits(requestId, reservedCredits);
    accounting.actualCredits = reservedCredits;
    return { status: 'upstream_schema_error', requestId, accounting };
  }

  accounting.actualInputTokens = completion.usage.prompt_tokens;
  accounting.actualOutputTokens = completion.usage.completion_tokens;

  const actualCredits = calculateCredits(
    model,
    completion.usage.prompt_tokens,
    completion.usage.completion_tokens,
  );

  // Never let a commit push committed credits past what this request
  // reserved. Real usage exceeding a conservatively over-estimated
  // reservation means the estimator's invariant was violated — fail
  // closed: commit only the reserved amount and mark the month exhausted
  // rather than trust an accounting state we can no longer verify
  // against the 5,000 cap.
  const exceeded = actualCredits > reservedCredits;
  const creditsToCommit = exceeded ? reservedCredits : actualCredits;
  await deps.creditService.commitCredits(requestId, creditsToCommit);
  accounting.actualCredits = creditsToCommit;

  if (exceeded) {
    await deps.creditService.markExhausted(getBillingMonth(now()));
    return { status: 'reservation_exceeded', requestId, accounting };
  }

  const rawContent = completion.choices[0]?.message?.content;
  let parsedJson: unknown;
  try {
    parsedJson = rawContent === undefined ? undefined : JSON.parse(rawContent);
  } catch {
    parsedJson = undefined;
  }

  // Deliberately no fallback parsing (stripping ```json fences, trimming
  // stray prose, etc.) — a malformed response is treated as a genuine
  // upstream contract violation, not something to silently paper over.
  const schemaResult =
    parsedJson === undefined ? undefined : reflectionComparisonSchema.safeParse(parsedJson);

  if (!schemaResult || !schemaResult.success) {
    return { status: 'upstream_schema_error', requestId, accounting };
  }

  return { status: 'ok', requestId, result: schemaResult.data, accounting };
}
