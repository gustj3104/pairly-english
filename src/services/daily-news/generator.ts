import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
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
import { DAILY_NEWS_JSON_SCHEMA, dailyNewsModelResponseSchema } from './schema.js';
import type { GeneratedDailyNews } from './schema.js';
import { DAILY_NEWS_SYSTEM_PROMPT, buildDailyNewsUserMessage } from './prompt.js';
import { validateSourceUrl } from './source-url.js';
import { topicForStudyDate } from './weekday-topics.js';

const FEATURE = 'daily_news' as const;

/**
 * Which local check rejected an otherwise-successful completion. Never
 * carries model content — just enough to tell, from logs alone, whether
 * the model is missing usage, returning malformed JSON, failing the
 * article schema, drifting off-topic, or failing the source-allowlist
 * check (see source-url.ts).
 *
 * The source check is split into three distinct reasons — previously all
 * three collapsed into one `source_not_allowlisted` value, which made it
 * impossible to tell from production logs alone which of three very
 * different problems actually occurred:
 *  - `source_not_allowlisted` — the model's own structured `sourceUrl`
 *    field fails the allowlist (wrong host, not https, etc).
 *  - `source_citation_missing` — `sourceUrl` itself is allowlisted, but
 *    the completion carried no usable `citations` array at all (e.g. the
 *    gateway didn't pass the Perplexity extension through).
 *  - `source_citation_mismatch` — `sourceUrl` is allowlisted and
 *    `citations` is present, but no citation normalizes to the exact same
 *    URL as `sourceUrl`.
 */
export type DailyNewsSchemaErrorReason =
  | 'missing_usage'
  | 'invalid_json'
  | 'schema_invalid'
  | 'topic_mismatch'
  | 'source_not_allowlisted'
  | 'source_citation_missing'
  | 'source_citation_mismatch'
  | 'invalid_published_at';

/**
 * One failed Zod check, reduced to only its field path and issue code
 * (e.g. 'too_big', 'invalid_value', 'unrecognized_keys') — never `message`
 * or any received value, since either can echo the model's actual
 * generated content or an enum's raw (attacker/model-controlled) input.
 */
export interface DailyNewsSchemaIssue {
  path: string;
  code: string;
}

const MAX_SCHEMA_ISSUES_CAPTURED = 10;

function summarizeSchemaIssues(error: z.ZodError): DailyNewsSchemaIssue[] {
  return error.issues.slice(0, MAX_SCHEMA_ISSUES_CAPTURED).map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
  }));
}

/**
 * Safe diagnostic detail for a `source_not_allowlisted` /
 * `source_citation_missing` / `source_citation_mismatch` outcome —
 * hostnames and counts only, never a full URL (which could carry a query
 * string or path segment echoing article content). Lets an operator tell
 * from sanitized logs alone which of the three source-check branches
 * actually fired, without ever needing the raw model response.
 */
export interface DailyNewsSourceDiagnostics {
  /** Hostname of the model's declared `sourceUrl`, or null if it wasn't even a parseable URL. */
  sourceHostname: string | null;
  /** Whether `sourceUrl` itself passed the allowlist (validateSourceUrl). */
  sourceAllowlisted: boolean;
  /** Whether the completion carried a `citations` array at all. */
  citationsPresent: boolean;
  /** Number of entries in `citations`, if present. */
  citationCount: number;
  /** Deduplicated, capped hostnames parsed from `citations` — domain names only. */
  citationHostnames: string[];
  /** How many `citations` entries independently pass the allowlist. */
  citationAllowlistedCount: number;
}

const MAX_CITATION_HOSTNAMES_CAPTURED = 10;

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

function summarizeSourceDiagnostics(
  sourceUrl: string,
  citations: unknown,
): DailyNewsSourceDiagnostics {
  const citationList = Array.isArray(citations) ? citations : [];
  const citationHostnames = new Set<string>();
  let citationAllowlistedCount = 0;
  for (const citation of citationList) {
    if (typeof citation !== 'string') continue;
    const hostname = hostnameOf(citation);
    if (hostname && citationHostnames.size < MAX_CITATION_HOSTNAMES_CAPTURED) {
      citationHostnames.add(hostname);
    }
    if (validateSourceUrl(citation)) citationAllowlistedCount += 1;
  }
  return {
    sourceHostname: hostnameOf(sourceUrl),
    sourceAllowlisted: validateSourceUrl(sourceUrl) !== null,
    citationsPresent: Array.isArray(citations),
    citationCount: citationList.length,
    citationHostnames: [...citationHostnames],
    citationAllowlistedCount,
  };
}

export type DailyNewsGenerationOutcome =
  | { status: 'ok'; requestId: string; article: GeneratedDailyNews; generatedAt: Date }
  | { status: 'limit_exceeded'; requestId: string; usage: UsageSummary }
  | { status: 'provider_exhausted'; requestId: string }
  | {
      status: 'upstream_schema_error';
      requestId: string;
      reason: DailyNewsSchemaErrorReason;
      schemaIssues?: DailyNewsSchemaIssue[];
      sourceDiagnostics?: DailyNewsSourceDiagnostics;
    }
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
  const topic = topicForStudyDate(studyDate);
  const messages: ChatMessage[] = [
    { role: 'system', content: DAILY_NEWS_SYSTEM_PROMPT },
    { role: 'user', content: buildDailyNewsUserMessage(studyDate, topic) },
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
    return { status: 'upstream_schema_error', requestId, reason: 'missing_usage' };
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
    return { status: 'upstream_schema_error', requestId, reason: 'invalid_json' };
  }
  const checked = dailyNewsModelResponseSchema.safeParse(parsed);
  if (!checked.success) {
    return {
      status: 'upstream_schema_error',
      requestId,
      reason: 'schema_invalid',
      schemaIssues: summarizeSchemaIssues(checked.error),
    };
  }
  // Fails closed on any mismatch: this only proves the model's declared
  // `topic` string equals the required one, not that the article content
  // is actually about that topic — the prompt is the real control there.
  if (checked.data.topic !== topic) {
    return { status: 'upstream_schema_error', requestId, reason: 'topic_mismatch' };
  }
  const source = validateSourceUrl(checked.data.sourceUrl);
  const citations = completion.citations;
  if (!source) {
    return {
      status: 'upstream_schema_error',
      requestId,
      reason: 'source_not_allowlisted',
      sourceDiagnostics: summarizeSourceDiagnostics(checked.data.sourceUrl, citations),
    };
  }
  if (!Array.isArray(citations)) {
    return {
      status: 'upstream_schema_error',
      requestId,
      reason: 'source_citation_missing',
      sourceDiagnostics: summarizeSourceDiagnostics(checked.data.sourceUrl, citations),
    };
  }
  if (!citations.some((citation) => validateSourceUrl(citation)?.href === source.href)) {
    return {
      status: 'upstream_schema_error',
      requestId,
      reason: 'source_citation_mismatch',
      sourceDiagnostics: summarizeSourceDiagnostics(checked.data.sourceUrl, citations),
    };
  }
  const publishedAt = new Date(checked.data.publishedAt);
  const generatedAt = now();
  if (
    !Number.isFinite(publishedAt.getTime()) ||
    publishedAt.getTime() > generatedAt.getTime() + 60 * 60 * 1000
  ) {
    return { status: 'upstream_schema_error', requestId, reason: 'invalid_published_at' };
  }
  // Built field-by-field (not spread) so `topic` — needed only for the
  // check above — can never leak into the public/persisted article.
  const article: GeneratedDailyNews = {
    title: checked.data.title,
    sourceName: checked.data.sourceName,
    sourceUrl: source.href,
    publishedAt: checked.data.publishedAt,
    summary: checked.data.summary,
    content: checked.data.content,
    vocabulary: checked.data.vocabulary,
  };
  return {
    status: 'ok',
    requestId,
    article,
    generatedAt,
  };
}
