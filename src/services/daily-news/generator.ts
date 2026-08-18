import { randomUUID } from 'node:crypto';
import type { CreditService } from '../credits/credit-service.js';
import { calculateCredits } from '../credits/credit-calculator.js';
import { getBillingMonth } from '../credits/billing-period.js';
import type { UsageSummary } from '../credits/types.js';
import type { MindlogicClient } from '../mindlogic/client.js';
import { getFeatureModelConfig } from '../mindlogic/feature-config.js';
import { estimateChatRequestInputTokens } from '../mindlogic/token-estimate.js';
import {
  EMPTY_ERROR_OBSERVABILITY,
  MindlogicApiError,
  UNCERTAIN_BILLING_ERROR_CODES,
} from '../mindlogic/types.js';
import type {
  MindlogicErrorCode,
  MindlogicErrorObservability,
  ChatMessage,
} from '../mindlogic/types.js';
import { DAILY_NEWS_JSON_SCHEMA, generatedDailyNewsSchema } from './schema.js';
import type { GeneratedDailyNews } from './schema.js';
import { DAILY_NEWS_SYSTEM_PROMPT, buildDailyNewsUserMessage } from './prompt.js';
import { validateSourceUrl } from './source-url.js';

const FEATURE = 'daily_news' as const;

export type DailyNewsGenerationOutcome =
  | { status: 'ok'; requestId: string; article: GeneratedDailyNews; generatedAt: Date }
  | { status: 'limit_exceeded'; requestId: string; usage: UsageSummary }
  | { status: 'provider_exhausted'; requestId: string }
  | { status: 'upstream_schema_error'; requestId: string }
  | { status: 'reservation_exceeded'; requestId: string }
  | {
      status: 'upstream_failed';
      requestId: string;
      code: MindlogicErrorCode;
      upstreamStatus: number;
      observability: MindlogicErrorObservability;
    }
  | {
      status: 'reconciliation_pending';
      requestId: string;
      code: MindlogicErrorCode;
      upstreamStatus: number;
      observability: MindlogicErrorObservability;
    };

export interface DailyNewsGeneratorDeps {
  creditService: CreditService;
  mindlogicClient: MindlogicClient;
  now?: () => Date;
  generateRequestId?: () => string;
}

export async function generateDailyNews(
  studyDate: string,
  deps: DailyNewsGeneratorDeps,
): Promise<DailyNewsGenerationOutcome> {
  const now = deps.now ?? (() => new Date());
  const requestId = (deps.generateRequestId ?? randomUUID)();
  const { model, maxOutputTokens } = getFeatureModelConfig(FEATURE);
  const messages: ChatMessage[] = [
    { role: 'system', content: DAILY_NEWS_SYSTEM_PROMPT },
    { role: 'user', content: buildDailyNewsUserMessage(studyDate) },
  ];
  const estimatedInputTokens = estimateChatRequestInputTokens({
    messages,
    responseFormatSchema: DAILY_NEWS_JSON_SCHEMA,
  });
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
      };
    }
    return { status: 'limit_exceeded', requestId, usage: reservation.usage };
  }
  const reservedCredits = reservation.record.creditsReserved;
  let completion;
  try {
    completion = await deps.mindlogicClient.createChatCompletion({
      model,
      messages,
      max_tokens: maxOutputTokens,
      response_format: DAILY_NEWS_JSON_SCHEMA,
      stream: false,
    });
  } catch (error) {
    if (!(error instanceof MindlogicApiError)) {
      await deps.creditService.releaseCredits(requestId, 'unknown_error');
      throw error;
    }
    if (error.code === 'credits_exhausted') {
      await deps.creditService.releaseCredits(requestId, 'mindlogic_credits_exhausted');
      await deps.creditService.markExhausted(getBillingMonth(now()));
      return { status: 'provider_exhausted', requestId };
    }
    if (UNCERTAIN_BILLING_ERROR_CODES.includes(error.code)) {
      await deps.creditService.markReconciliationPending(requestId, error.code);
      return {
        status: 'reconciliation_pending',
        requestId,
        code: error.code,
        upstreamStatus: error.status,
        observability: error.observability,
      };
    }
    await deps.creditService.releaseCredits(requestId, error.code);
    return {
      status: 'upstream_failed',
      requestId,
      code: error.code,
      upstreamStatus: error.status,
      observability: error.observability,
    };
  }

  if (!completion.usage) {
    await deps.creditService.commitCredits(requestId, reservedCredits);
    return { status: 'upstream_schema_error', requestId };
  }
  const actual = calculateCredits(
    model,
    completion.usage.prompt_tokens,
    completion.usage.completion_tokens,
  );
  const exceeded = actual > reservedCredits;
  await deps.creditService.commitCredits(requestId, exceeded ? reservedCredits : actual);
  if (exceeded) {
    await deps.creditService.markExhausted(getBillingMonth(now()));
    return { status: 'reservation_exceeded', requestId };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content ?? '');
  } catch {
    return { status: 'upstream_schema_error', requestId };
  }
  const checked = generatedDailyNewsSchema.safeParse(parsed);
  if (!checked.success) return { status: 'upstream_schema_error', requestId };
  const source = validateSourceUrl(checked.data.sourceUrl);
  const citations = completion.citations;
  if (
    !source ||
    !Array.isArray(citations) ||
    !citations.some((citation) => validateSourceUrl(citation)?.href === source.href)
  ) {
    return { status: 'upstream_schema_error', requestId };
  }
  const publishedAt = new Date(checked.data.publishedAt);
  const generatedAt = now();
  if (
    !Number.isFinite(publishedAt.getTime()) ||
    publishedAt.getTime() > generatedAt.getTime() + 60 * 60 * 1000
  ) {
    return { status: 'upstream_schema_error', requestId };
  }
  return {
    status: 'ok',
    requestId,
    article: { ...checked.data, sourceUrl: source.href },
    generatedAt,
  };
}
