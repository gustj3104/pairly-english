import { randomUUID } from 'node:crypto';
import type { CreditService } from '../credits/credit-service.js';
import type { UsageSummary } from '../credits/types.js';
import { calculateCredits } from '../credits/credit-calculator.js';
import { getBillingMonth } from '../credits/billing-period.js';
import type { MindlogicClient } from '../mindlogic/client.js';
import {
  EMPTY_ERROR_OBSERVABILITY,
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
  MindlogicErrorObservability,
} from '../mindlogic/types.js';
import { getFeatureModelConfig } from '../mindlogic/feature-config.js';
import { estimateChatRequestInputTokens } from '../mindlogic/token-estimate.js';
import {
  DISCUSSION_FEEDBACK_RESPONSE_FORMAT,
  DISCUSSION_FEEDBACK_SYSTEM_PROMPT,
  buildDiscussionFeedbackUserMessage,
} from './prompt.js';
import { discussionFeedbackResultSchema } from './schema.js';
import type { FeedbackPromptInputs } from './types.js';
import type { DiscussionFeedbackResultJson } from '../../db/schema.js';

const FEATURE = 'grammar_feedback' as const;

export interface DiscussionFeedbackLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface DiscussionFeedbackAccounting {
  feature: typeof FEATURE;
  model: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  reservedCredits: number | null;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualCredits: number | null;
}

export type DiscussionFeedbackGenerationOutcome = {
  requestId: string;
  accounting: DiscussionFeedbackAccounting;
} & (
  | { status: 'ok'; result: DiscussionFeedbackResultJson; droppedImprovements: number }
  | { status: 'limit_exceeded'; usage: UsageSummary }
  | { status: 'provider_exhausted' }
  | {
      status: 'upstream_failed';
      code: MindlogicErrorCode;
      upstreamStatus: number;
      observability: MindlogicErrorObservability;
    }
  | {
      status: 'upstream_schema_error';
      reason: 'invalid_json' | 'schema_invalid' | 'participant_mismatch';
    }
  | { status: 'reservation_exceeded' }
  | {
      status: 'reconciliation_pending';
      code: MindlogicErrorCode;
      upstreamStatus: number;
      observability: MindlogicErrorObservability;
    }
);

const DEFAULT_MAX_RETRIES = MAX_RETRY_ATTEMPTS - 1;

export interface DiscussionFeedbackDeps {
  creditService: CreditService;
  mindlogicClient: MindlogicClient;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  generateRequestId?: () => string;
  maxRetries?: number;
  logger?: DiscussionFeedbackLogger;
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
): DiscussionFeedbackAccounting {
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

/** Case-insensitive, whitespace-collapsed normalization used for the substring guard below. */
function normalizeForMatch(value: string): string {
  return value.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * Computes each participant's speaking share (rounded percentage of total
 * transcript duration) directly from segment timestamps — never trusts
 * the model's own figure, since it has no real audio-duration signal.
 * Falls back to omitting the field entirely if total duration is
 * somehow zero (defense in depth; validation elsewhere already requires
 * endMs > startMs on every segment, so this should be unreachable).
 */
function computeSpeakingShares(
  segments: FeedbackPromptInputs['segments'],
): Map<string, number | undefined> {
  const totalsByKey = new Map<string, number>();
  let totalDurationMs = 0;
  for (const segment of segments) {
    const durationMs = segment.endMs - segment.startMs;
    totalDurationMs += durationMs;
    if (segment.speakerKey !== null) {
      totalsByKey.set(segment.speakerKey, (totalsByKey.get(segment.speakerKey) ?? 0) + durationMs);
    }
  }
  const shares = new Map<string, number | undefined>();
  for (const [key, durationMs] of totalsByKey) {
    shares.set(
      key,
      totalDurationMs > 0 ? Math.round((durationMs / totalDurationMs) * 100) : undefined,
    );
  }
  return shares;
}

/**
 * Orchestrates one discussion-feedback AI call end to end: reserve credits
 * -> call Mindlogic (with the same conservative retry policy as
 * reflection-comparison-service.ts) -> validate -> apply defense-in-depth
 * guards against AI fabrication -> settle. Returns a discriminated union
 * rather than throwing for any expected business outcome. Never touches
 * the study_day_discussions repository itself — that's the caller's job
 * (see discussion-feedback-service.ts), mirroring reflection-comparison-
 * service.ts's split from comparison-service.ts.
 */
export async function generateDiscussionFeedback(
  promptInputs: FeedbackPromptInputs,
  deps: DiscussionFeedbackDeps,
): Promise<DiscussionFeedbackGenerationOutcome> {
  const now = deps.now ?? (() => new Date());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const generateRequestId = deps.generateRequestId ?? (() => randomUUID());

  const requestId = generateRequestId();
  const { model, maxOutputTokens } = getFeatureModelConfig(FEATURE);

  const messages: ChatMessage[] = [
    { role: 'system', content: DISCUSSION_FEEDBACK_SYSTEM_PROMPT },
    { role: 'user', content: buildDiscussionFeedbackUserMessage(promptInputs) },
  ];

  const estimatedInputTokens = estimateChatRequestInputTokens({
    messages,
    responseFormatSchema: DISCUSSION_FEEDBACK_RESPONSE_FORMAT,
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
      return {
        status: 'reconciliation_pending',
        requestId,
        code: (reservation.record.errorCode as MindlogicErrorCode | null) ?? 'unknown',
        upstreamStatus: 0,
        observability: EMPTY_ERROR_OBSERVABILITY,
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
          response_format: DISCUSSION_FEEDBACK_RESPONSE_FORMAT,
          stream: false,
        }),
      sleep,
      maxAttempts,
    );
  } catch (error) {
    if (error instanceof MindlogicApiError) {
      if (error.code === 'credits_exhausted') {
        await deps.creditService.releaseCredits(requestId, 'mindlogic_credits_exhausted');
        await deps.creditService.markExhausted(getBillingMonth(now()));
        return { status: 'provider_exhausted', requestId, accounting };
      }

      if (UNCERTAIN_BILLING_ERROR_CODES.includes(error.code)) {
        await deps.creditService.markReconciliationPending(requestId, error.code);
        return {
          status: 'reconciliation_pending',
          requestId,
          code: error.code,
          upstreamStatus: error.status,
          observability: error.observability,
          accounting,
        };
      }

      await deps.creditService.releaseCredits(requestId, error.code);
      return {
        status: 'upstream_failed',
        requestId,
        code: error.code,
        upstreamStatus: error.status,
        observability: error.observability,
        accounting,
      };
    }
    await deps.creditService.releaseCredits(requestId, 'unknown_error');
    throw error;
  }

  if (!completion.usage) {
    await deps.creditService.commitCredits(requestId, reservedCredits);
    accounting.actualCredits = reservedCredits;
    return { status: 'upstream_schema_error', requestId, reason: 'invalid_json', accounting };
  }

  accounting.actualInputTokens = completion.usage.prompt_tokens;
  accounting.actualOutputTokens = completion.usage.completion_tokens;

  const actualCredits = calculateCredits(
    model,
    completion.usage.prompt_tokens,
    completion.usage.completion_tokens,
  );

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

  const schemaResult =
    parsedJson === undefined ? undefined : discussionFeedbackResultSchema.safeParse(parsedJson);

  if (!schemaResult || !schemaResult.success) {
    deps.logger?.warn(
      { feature: FEATURE, outcome: 'schema_invalid', model },
      'discussion feedback generation failed schema validation',
    );
    return { status: 'upstream_schema_error', requestId, reason: 'schema_invalid', accounting };
  }

  // Defense-in-depth guard 1: the response's participantKey set must be
  // EXACTLY the set of speakers actually present in this transcript — no
  // invented key, no duplicate, no missing one. Reject the whole response
  // rather than try to repair an identity mismatch.
  const expectedKeys = new Set(promptInputs.participants.map((p) => p.participantKey));
  const actualKeys = schemaResult.data.participants.map((p) => p.participantKey);
  const actualKeySet = new Set(actualKeys);
  const keysMatch =
    actualKeys.length === new Set(actualKeys).size &&
    actualKeySet.size === expectedKeys.size &&
    [...expectedKeys].every((key) => actualKeySet.has(key));

  if (!keysMatch) {
    deps.logger?.warn(
      { feature: FEATURE, outcome: 'participant_mismatch', model },
      'discussion feedback generation returned an invalid participantKey set',
    );
    return {
      status: 'upstream_schema_error',
      requestId,
      reason: 'participant_mismatch',
      accounting,
    };
  }

  // Defense-in-depth guard 2: filter out any `improvements[].original` that
  // is not a real (normalized) substring of that participant's own
  // transcript text — dropped rather than failing the whole generation.
  const normalizedTextByKey = new Map<string, string>();
  for (const key of expectedKeys) {
    const text = promptInputs.segments
      .filter((segment) => segment.speakerKey === key)
      .map((segment) => segment.text)
      .join(' ');
    normalizedTextByKey.set(key, normalizeForMatch(text));
  }

  const speakingShareByKey = computeSpeakingShares(promptInputs.segments);

  let droppedImprovements = 0;
  const participants = schemaResult.data.participants.map((participant) => {
    const normalizedText = normalizedTextByKey.get(participant.participantKey) ?? '';
    const improvements = participant.improvements.filter((improvement) => {
      const ok = normalizedText.includes(normalizeForMatch(improvement.original));
      if (!ok) droppedImprovements += 1;
      return ok;
    });
    // Guard 3: speakingShare is always server-computed, never the model's
    // own figure.
    const speakingShare = speakingShareByKey.get(participant.participantKey);
    return {
      ...participant,
      improvements,
      ...(speakingShare === undefined ? {} : { speakingShare }),
    };
  }) as DiscussionFeedbackResultJson['participants'];

  if (droppedImprovements > 0) {
    deps.logger?.warn(
      { feature: FEATURE, outcome: 'improvements_dropped', model, droppedImprovements },
      'discussion feedback generation dropped fabricated improvements[].original entries',
    );
  }

  const result: DiscussionFeedbackResultJson = {
    ...schemaResult.data,
    participants,
  };

  return { status: 'ok', requestId, result, droppedImprovements, accounting };
}
