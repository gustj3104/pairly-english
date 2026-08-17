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
} from '../mindlogic/types.js';
import type { ChatCompletionResponse, MindlogicErrorCode } from '../mindlogic/types.js';
import { getFeatureModelConfig } from '../mindlogic/feature-config.js';
import { estimateTokens } from '../mindlogic/token-estimate.js';
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
  | { status: 'upstream_failed'; code: MindlogicErrorCode }
  | { status: 'upstream_schema_error' }
  | { status: 'reservation_exceeded' }
);

export interface ReflectionComparisonDeps {
  creditService: CreditService;
  mindlogicClient: MindlogicClient;
  /** Injectable for tests; defaults to the real clock. */
  now?: () => Date;
  /** Injectable for tests so retry backoff never actually waits. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests that need a deterministic requestId. */
  generateRequestId?: () => string;
}

async function callWithRetry(
  attempt: () => Promise<ChatCompletionResponse>,
  sleep: (ms: number) => Promise<void>,
): Promise<ChatCompletionResponse> {
  for (let attemptNumber = 1; attemptNumber <= MAX_RETRY_ATTEMPTS; attemptNumber++) {
    try {
      return await attempt();
    } catch (error) {
      const retryable =
        error instanceof MindlogicApiError && RETRYABLE_ERROR_CODES.includes(error.code);
      if (!retryable || attemptNumber === MAX_RETRY_ATTEMPTS) {
        throw error;
      }
      await sleep(RETRY_BASE_DELAY_MS * attemptNumber);
    }
  }
  /* istanbul ignore next -- loop always returns or throws */
  throw new Error('unreachable: retry loop exited without returning or throwing');
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
  const estimatedInputTokens =
    estimateTokens(REFLECTION_COMPARISON_SYSTEM_PROMPT) + estimateTokens(userMessageContent);

  const accounting: ReflectionComparisonAccounting = {
    feature: FEATURE,
    model,
    estimatedInputTokens,
    maxOutputTokens,
    reservedCredits: null,
    actualInputTokens: null,
    actualOutputTokens: null,
    actualCredits: null,
  };

  const reservation = await deps.creditService.reserveCredits({
    requestId,
    feature: FEATURE,
    model,
    inputTokens: estimatedInputTokens,
    outputTokens: maxOutputTokens,
    now: now(),
  });

  if (!reservation.ok) {
    return { status: 'limit_exceeded', requestId, usage: reservation.usage, accounting };
  }

  const reservedCredits = reservation.record.creditsReserved;
  accounting.reservedCredits = reservedCredits;

  let completion: ChatCompletionResponse;
  try {
    completion = await callWithRetry(
      () =>
        deps.mindlogicClient.createChatCompletion({
          model,
          max_tokens: maxOutputTokens,
          messages: [
            { role: 'system', content: REFLECTION_COMPARISON_SYSTEM_PROMPT },
            { role: 'user', content: userMessageContent },
          ],
          response_format: REFLECTION_COMPARISON_RESPONSE_FORMAT,
        }),
      sleep,
    );
  } catch (error) {
    if (error instanceof MindlogicApiError) {
      if (error.code === 'payment_required') {
        await deps.creditService.releaseCredits(requestId, 'mindlogic_payment_required');
        await deps.creditService.markExhausted(getBillingMonth(now()));
        return { status: 'provider_exhausted', requestId, accounting };
      }
      // No usage occurred before this failure — including for 'timeout',
      // where we genuinely don't know whether Mindlogic processed the
      // request; releasing (not committing) is the conservative choice
      // for the reservation itself, and we never retry a timeout (see
      // RETRYABLE_ERROR_CODES) to avoid risking a second real charge.
      await deps.creditService.releaseCredits(requestId, error.code);
      return { status: 'upstream_failed', requestId, code: error.code, accounting };
    }
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
