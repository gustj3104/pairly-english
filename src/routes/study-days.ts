import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { createSessionGate } from '../plugins/session-gate.js';
import { getPartnerParticipantKey } from '../services/auth/allowed-participants.js';
import { validateStudyDate } from '../services/daily-reflections/date.js';
import {
  hashForLogging,
  normalizeParticipantKey,
} from '../services/daily-reflections/participant-key.js';
import { submitReflectionRequestSchema } from '../services/daily-reflections/schema.js';
import { compareReflections } from '../services/reflections/reflection-comparison-service.js';
import type { ReflectionComparisonOutcome } from '../services/reflections/reflection-comparison-service.js';
import { mapReflectionComparisonFailureToHttp } from '../services/reflections/http-mapping.js';
import { DailyNewsGenerationError } from '../services/daily-news/service.js';

export interface StudyDaysRoutesOptions {
  sessionSecret: string;
  /** How many days ahead of "today" in Asia/Seoul a study date may be. */
  maxFutureDays: number;
  /** Injectable for tests that need fixed-time date-range behavior. */
  now?: () => Date;
  /** Injectable for tests; defaults to env.MINDLOGIC_MAX_RETRIES. */
  maxRetries?: number;
}

/** Validates the `:date` path param, sending a 400 itself on failure. Returns undefined on failure. */
function validateDateParam(
  request: FastifyRequest,
  reply: FastifyReply,
  maxFutureDays: number,
  now: () => Date,
): string | undefined {
  const { date } = request.params as { date: string };
  const validation = validateStudyDate(date, maxFutureDays, now());
  if (!validation.ok) {
    const message =
      validation.reason === 'invalid_format'
        ? 'date must be a valid YYYY-MM-DD calendar date'
        : `date must not be more than ${maxFutureDays} day(s) in the future`;
    reply.code(400).send({
      error: { message, code: 'VALIDATION_ERROR', requestId: request.id },
    });
    return undefined;
  }
  return date;
}

/** Reads the caller's session — guaranteed present by sessionGate, but guarded rather than asserted. */
function requireSession(request: FastifyRequest, reply: FastifyReply) {
  const session = request.session;
  if (!session) {
    reply.code(401).send({
      error: { message: 'Unauthorized', code: 'UNAUTHORIZED', requestId: request.id },
    });
    return undefined;
  }
  return session;
}

/**
 * Derives the `error_code` persisted on a 'failed' study_day_comparisons
 * row from a non-'ok' ReflectionComparisonOutcome — the outcome's own
 * upstream code where one exists (upstream_failed's MindlogicErrorCode),
 * otherwise the outcome's status name itself (limit_exceeded,
 * provider_exhausted, upstream_schema_error, reservation_exceeded).
 */
function deriveComparisonFailureErrorCode(
  outcome: Exclude<ReflectionComparisonOutcome, { status: 'ok' | 'reconciliation_pending' }>,
): string {
  return outcome.status === 'upstream_failed' ? outcome.code : outcome.status;
}

/**
 * Phase 2, shared by POST /compare's 'claimed' branch and
 * POST /comparison/retry's 'claimed' branch: settles the
 * study_day_comparisons row for `requestId` based on `outcome`, logs the
 * same allow-listed accounting fields as the deprecated
 * /reflections/compare route, and returns the `{ status, ... }`-shaped
 * body (GET .../comparison's vocabulary) rather than the old flat error
 * envelope — see README "Study-day comparison" for the exact contract.
 */
async function finalizeComparisonOutcome(
  app: FastifyInstance,
  outcome: ReflectionComparisonOutcome,
  studyDate: string,
  requestId: string,
  request: FastifyRequest,
  reply: FastifyReply,
  durationMs: number,
  extraLogFields: Record<string, unknown>,
): Promise<unknown> {
  const logFields = {
    requestId: outcome.requestId,
    feature: outcome.accounting.feature,
    model: outcome.accounting.model,
    outcome: outcome.status,
    estimatedInputTokens: outcome.accounting.estimatedInputTokens,
    maxOutputTokens: outcome.accounting.maxOutputTokens,
    reservedCredits: outcome.accounting.reservedCredits,
    actualInputTokens: outcome.accounting.actualInputTokens,
    actualOutputTokens: outcome.accounting.actualOutputTokens,
    actualCredits: outcome.accounting.actualCredits,
    durationMs,
    ...extraLogFields,
  };

  if (outcome.status === 'ok') {
    await app.comparisonService.completeWithResult(studyDate, requestId, outcome.result);
    request.log.info(logFields, 'study-day comparison completed');
    reply.code(200);
    return { status: 'completed', cached: false, result: outcome.result };
  }

  const mapping = mapReflectionComparisonFailureToHttp(outcome.status);

  if (outcome.status === 'reconciliation_pending') {
    await app.comparisonService.completeWithReconciliationPending(
      studyDate,
      requestId,
      outcome.code,
    );
    request.log.warn(
      {
        ...logFields,
        upstreamCode: outcome.code,
        upstreamStatus: outcome.upstreamStatus,
        ...outcome.observability,
      },
      'study-day comparison transmission status unknown — held for reconciliation',
    );
    reply.code(mapping.statusCode);
    return { status: 'reconciliation_pending' };
  }

  const errorCode = deriveComparisonFailureErrorCode(outcome);
  await app.comparisonService.completeWithFailure(studyDate, requestId, errorCode);
  request.log.warn(logFields, 'study-day comparison failed');
  reply.code(mapping.statusCode);
  return { status: 'failed', code: errorCode };
}

export async function studyDaysRoutes(
  app: FastifyInstance,
  options: StudyDaysRoutesOptions,
): Promise<void> {
  const sessionGate = createSessionGate(options.sessionSecret);
  const now = options.now ?? (() => new Date());

  app.get('/study-days/:date/article', { preHandler: sessionGate }, async (request, reply) => {
    const date = validateDateParam(request, reply, options.maxFutureDays, now);
    if (date === undefined || requireSession(request, reply) === undefined) return;
    try {
      const result = await app.dailyNewsService.getOrGenerate(date, now);
      request.log.info(
        {
          requestId: request.id,
          studyDate: date,
          cached: result.cached,
          feature: 'daily_news',
          model: 'sonar-pro',
        },
        'daily news article served',
      );
      reply.code(200);
      return { ...result.article, cached: result.cached };
    } catch (error) {
      if (!(error instanceof DailyNewsGenerationError)) throw error;
      const outcome = error.outcome;
      const safeLog = {
        requestId: request.id,
        studyDate: date,
        feature: 'daily_news',
        model: 'sonar-pro',
        outcome: outcome.status,
      };
      if (outcome.status === 'limit_exceeded') {
        request.log.warn(safeLog, 'daily news rejected: monthly credit limit reached');
        reply.code(402);
        return {
          error: {
            message: 'Monthly AI credit limit reached',
            code: 'CREDIT_LIMIT_EXCEEDED',
            requestId: request.id,
          },
        };
      }
      if (outcome.status === 'provider_exhausted') {
        request.log.warn(safeLog, 'daily news rejected: provider credit exhausted');
        reply.code(402);
        return {
          error: {
            message: 'AI provider credit exhausted',
            code: 'PROVIDER_CREDIT_EXHAUSTED',
            requestId: request.id,
          },
        };
      }
      if (outcome.status === 'reconciliation_pending') {
        request.log.warn(
          {
            ...safeLog,
            upstreamCode: outcome.code,
            upstreamStatus: outcome.upstreamStatus,
            ...outcome.observability,
          },
          'daily news transmission status unknown',
        );
        reply.code(409);
        return {
          error: {
            message:
              'This request could not be confirmed and is being verified — do not resubmit it.',
            code: 'RECONCILIATION_PENDING',
            requestId: request.id,
          },
        };
      }
      request.log.warn(
        outcome.status === 'upstream_failed'
          ? {
              ...safeLog,
              upstreamCode: outcome.code,
              upstreamStatus: outcome.upstreamStatus,
              ...outcome.observability,
            }
          : safeLog,
        'daily news generation failed',
      );
      reply.code(outcome.status === 'reservation_exceeded' ? 500 : 502);
      return {
        error: {
          message:
            outcome.status === 'reservation_exceeded'
              ? 'Internal credit accounting error'
              : 'AI provider returned an invalid response',
          code:
            outcome.status === 'reservation_exceeded'
              ? 'CREDIT_RESERVATION_EXCEEDED'
              : 'UPSTREAM_NEWS_FAILED',
          requestId: request.id,
        },
      };
    }
  });

  app.put('/study-days/:date/reflection', { preHandler: sessionGate }, async (request, reply) => {
    const date = validateDateParam(request, reply, options.maxFutureDays, now);
    if (date === undefined) return;

    const session = requireSession(request, reply);
    if (session === undefined) return;

    const parsed = submitReflectionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: {
          message: 'Invalid request body',
          code: 'VALIDATION_ERROR',
          requestId: request.id,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      };
    }

    // Submitter identity always comes from the verified session, never
    // from the request body.
    const displayName = session.name.trim();
    const participantKey = normalizeParticipantKey(session.name);
    const submittedAt = now();

    const startedAt = Date.now();
    const result = await app.dailyReflectionService.submitReflection({
      studyDate: date,
      article: {
        id: parsed.data.article.id,
        title: parsed.data.article.title,
        sourceUrl: parsed.data.article.sourceUrl ?? null,
        summary: parsed.data.article.summary ?? null,
      },
      participantKey,
      displayName,
      content: parsed.data.reflection,
      submittedAt,
    });
    const durationMs = Date.now() - startedAt;

    // Allowed log fields only (README "Logging discipline"): requestId,
    // studyDate, the participantKey's irreversible truncated hash, submit
    // success/failure, durationMs — never displayName or content.
    const logFields = {
      requestId: request.id,
      studyDate: date,
      participantKeyHash: hashForLogging(participantKey),
      durationMs,
    };

    if (!result.ok) {
      if (result.reason === 'article_mismatch') {
        request.log.warn(
          { ...logFields, success: false },
          'daily reflection submission rejected: article mismatch',
        );
        reply.code(409);
        return {
          error: {
            message: 'This study day is already registered with a different article',
            code: 'ARTICLE_MISMATCH',
            requestId: request.id,
          },
        };
      }
      request.log.warn(
        { ...logFields, success: false },
        'daily reflection submission rejected: participant limit reached',
      );
      reply.code(409);
      return {
        error: {
          message: 'This study day already has two participants',
          code: 'PARTICIPANT_LIMIT_REACHED',
          requestId: request.id,
        },
      };
    }

    request.log.info({ ...logFields, success: true }, 'daily reflection submitted');
    reply.code(200);
    return { studyDate: date, submitted: true, submittedAt: result.submittedAt.toISOString() };
  });

  app.get('/study-days/:date/status', { preHandler: sessionGate }, async (request, reply) => {
    const date = validateDateParam(request, reply, options.maxFutureDays, now);
    if (date === undefined) return;

    const session = requireSession(request, reply);
    if (session === undefined) return;

    const participantKey = normalizeParticipantKey(session.name);
    const status = await app.dailyReflectionService.getStatus(date, participantKey);

    request.log.info(
      {
        requestId: request.id,
        studyDate: date,
        participantKeyHash: hashForLogging(participantKey),
      },
      'daily reflection status checked',
    );

    reply.code(200);
    return status;
  });

  // Combined "mine vs partner" progress used by the Dashboard's My/Friend's
  // Progress panels — identity for both sides comes only from the verified
  // session plus the fixed two-participant pairing (never a client-supplied
  // username), so a caller can never fetch a third party's data.
  app.get('/study-days/:date/progress', { preHandler: sessionGate }, async (request, reply) => {
    const date = validateDateParam(request, reply, options.maxFutureDays, now);
    if (date === undefined) return;

    const session = requireSession(request, reply);
    if (session === undefined) return;

    const participantKey = normalizeParticipantKey(session.name);
    const partnerKey = getPartnerParticipantKey(participantKey);

    const [progress, mineVocabulary, partnerVocabulary] = await Promise.all([
      app.dailyReflectionService.getProgress(date, participantKey),
      app.dictionaryService.list(participantKey),
      app.dictionaryService.list(partnerKey),
    ]);

    request.log.info(
      {
        requestId: request.id,
        studyDate: date,
        participantKeyHash: hashForLogging(participantKey),
      },
      'study-day progress checked',
    );

    reply.code(200);
    return {
      studyDate: progress.studyDate,
      mine: {
        displayName: progress.mine.displayName,
        reflection: { submitted: progress.mine.submitted, content: progress.mine.content },
        vocabulary: mineVocabulary,
      },
      partner: {
        displayName: progress.partner.displayName,
        reflection: { submitted: progress.partner.submitted, content: progress.partner.content },
        vocabulary: partnerVocabulary,
      },
      readyToCompare: progress.readyToCompare,
      discussion: progress.discussion,
    };
  });

  // Marks the day's single shared discussion step complete — first
  // participant to call this wins (idempotent), since it's one in-person
  // conversation both participants have together, not a per-participant
  // action. Requires a study_days row to already exist (created by the
  // first reflection submission), which is always true in practice by the
  // time either participant reaches the discussion step.
  app.put('/study-days/:date/discussion', { preHandler: sessionGate }, async (request, reply) => {
    const date = validateDateParam(request, reply, options.maxFutureDays, now);
    if (date === undefined) return;

    const session = requireSession(request, reply);
    if (session === undefined) return;

    const displayName = session.name.trim();
    const participantKey = normalizeParticipantKey(session.name);
    const result = await app.dailyReflectionService.markDiscussionCompleted(
      date,
      displayName,
      now(),
    );

    request.log.info(
      {
        requestId: request.id,
        studyDate: date,
        participantKeyHash: hashForLogging(participantKey),
        success: result.ok,
      },
      'discussion completion marked',
    );

    if (!result.ok) {
      reply.code(409);
      return {
        error: {
          message: 'This study day has no article yet — submit a reflection first',
          code: 'STUDY_DAY_NOT_FOUND',
          requestId: request.id,
        },
      };
    }

    reply.code(200);
    return {
      studyDate: date,
      discussionCompleted: true,
      completedAt: result.completion.completedAt.toISOString(),
    };
  });

  app.post('/study-days/:date/compare', { preHandler: sessionGate }, async (request, reply) => {
    const date = validateDateParam(request, reply, options.maxFutureDays, now);
    if (date === undefined) return;

    const session = requireSession(request, reply);
    if (session === undefined) return;

    const participantKey = normalizeParticipantKey(session.name);
    const logFields = {
      requestId: request.id,
      studyDate: date,
      participantKeyHash: hashForLogging(participantKey),
    };

    // Phase 1: claim generation rights (one short transaction, never held
    // across the Mindlogic call below) — see
    // src/services/daily-reflections/comparison-repository.ts.
    const claim = await app.comparisonService.claimGeneration(date);

    switch (claim.outcome) {
      case 'partner_not_ready':
        reply.code(409);
        return {
          error: {
            message: 'Your partner has not submitted a reflection for this study day yet',
            code: 'PARTNER_NOT_READY',
            requestId: request.id,
          },
        };

      case 'in_progress':
        request.log.info(logFields, 'study-day comparison already in progress');
        reply.code(202);
        return { status: 'processing' };

      case 'reconciliation_pending':
        request.log.warn(logFields, 'study-day comparison read: reconciliation pending');
        reply.code(409);
        return { status: 'reconciliation_pending' };

      case 'failed':
        // Never auto-retried by a plain POST — only the explicit retry
        // endpoint below may transition a failed row.
        request.log.info(
          { ...logFields, errorCode: claim.errorCode },
          'study-day comparison previously failed; not retried automatically',
        );
        reply.code(200);
        return { status: 'failed', code: claim.errorCode };

      case 'cached_corrupted':
        request.log.error(logFields, 'study-day comparison stored result failed schema validation');
        reply.code(500);
        return { status: 'failed', code: 'CORRUPTED_RESULT' };

      case 'cached':
        request.log.info(logFields, 'study-day comparison served from cache');
        reply.code(200);
        return { status: 'completed', cached: true, result: claim.result };

      case 'claimed': {
        const inputs = await app.dailyReflectionService.getComparisonInputs(date, participantKey);
        if (!inputs.ok) {
          // Unreachable in practice: claimGeneration just confirmed exactly
          // 2 reflections exist for this date under a DB lock, and
          // reflections are never deleted or edited. Fail the claimed row
          // rather than leave it stuck at 'processing' forever.
          request.log.error(
            logFields,
            'study-day comparison claimed but reflections became unavailable',
          );
          await app.comparisonService.completeWithFailure(
            date,
            claim.requestId,
            'partner_data_unavailable',
          );
          reply.code(500);
          return { status: 'failed', code: 'partner_data_unavailable' };
        }

        const startedAt = Date.now();
        const outcome = await compareReflections(
          {
            article: {
              title: inputs.article.title,
              sourceUrl: inputs.article.sourceUrl ?? undefined,
              summary: inputs.article.summary ?? undefined,
            },
            mine: { displayName: inputs.mine.displayName, reflection: inputs.mine.content },
            partner: {
              displayName: inputs.partner.displayName,
              reflection: inputs.partner.content,
            },
          },
          {
            creditService: app.creditService,
            mindlogicClient: app.mindlogicClient,
            maxRetries: options.maxRetries ?? env.MINDLOGIC_MAX_RETRIES,
            now,
            // Same request_id the caller claimed in study_day_comparisons
            // lands in credit_usage_records too — the shared join key for
            // manual crash recovery (README "Study-day comparison").
            generateRequestId: () => claim.requestId,
          },
        );
        const durationMs = Date.now() - startedAt;

        return finalizeComparisonOutcome(
          app,
          outcome,
          date,
          claim.requestId,
          request,
          reply,
          durationMs,
          logFields,
        );
      }
    }
  });

  app.get('/study-days/:date/comparison', { preHandler: sessionGate }, async (request, reply) => {
    const date = validateDateParam(request, reply, options.maxFutureDays, now);
    if (date === undefined) return;

    const session = requireSession(request, reply);
    if (session === undefined) return;

    const result = await app.comparisonService.getComparison(date);

    request.log.info(
      { requestId: request.id, studyDate: date, status: result.status },
      'study-day comparison status checked',
    );

    switch (result.status) {
      case 'not_started':
        reply.code(200);
        return { status: 'not_started' };
      case 'processing':
        reply.code(200);
        return { status: 'processing' };
      case 'completed':
        reply.code(200);
        return { status: 'completed', result: result.result };
      case 'failed':
        reply.code(200);
        return { status: 'failed', code: result.errorCode };
      case 'reconciliation_pending':
        reply.code(200);
        return { status: 'reconciliation_pending' };
      case 'corrupted':
        request.log.error(
          { requestId: request.id, studyDate: date },
          'stored study-day comparison result failed schema validation',
        );
        reply.code(500);
        return { status: 'failed', code: 'CORRUPTED_RESULT' };
    }
  });

  app.post(
    '/study-days/:date/comparison/retry',
    { preHandler: sessionGate },
    async (request, reply) => {
      const date = validateDateParam(request, reply, options.maxFutureDays, now);
      if (date === undefined) return;

      const session = requireSession(request, reply);
      if (session === undefined) return;

      const participantKey = normalizeParticipantKey(session.name);
      const logFields = {
        requestId: request.id,
        studyDate: date,
        participantKeyHash: hashForLogging(participantKey),
      };

      const claim = await app.comparisonService.claimRetry(date);

      switch (claim.outcome) {
        case 'not_started':
          reply.code(409);
          return {
            error: {
              message: 'There is no comparison to retry for this study day',
              code: 'NOTHING_TO_RETRY',
              requestId: request.id,
            },
          };

        case 'processing':
          // Not an error — someone else's retry (or the original attempt)
          // is still in flight. Same 202 as POST /compare's 'in_progress'.
          request.log.info(logFields, 'study-day comparison retry: already in progress');
          reply.code(202);
          return { status: 'processing' };

        case 'completed':
          reply.code(409);
          return {
            error: {
              message: 'This study day already has a completed comparison',
              code: 'ALREADY_COMPLETED',
              requestId: request.id,
            },
          };

        case 'reconciliation_pending':
          reply.code(409);
          return {
            error: {
              message:
                'This comparison is pending reconciliation and cannot be retried until an operator resolves it',
              code: 'RECONCILIATION_PENDING',
              requestId: request.id,
            },
          };

        case 'claimed': {
          const inputs = await app.dailyReflectionService.getComparisonInputs(date, participantKey);
          if (!inputs.ok) {
            request.log.error(
              logFields,
              'study-day comparison retry claimed but reflections became unavailable',
            );
            await app.comparisonService.completeWithFailure(
              date,
              claim.requestId,
              'partner_data_unavailable',
            );
            reply.code(500);
            return { status: 'failed', code: 'partner_data_unavailable' };
          }

          const startedAt = Date.now();
          const outcome = await compareReflections(
            {
              article: {
                title: inputs.article.title,
                sourceUrl: inputs.article.sourceUrl ?? undefined,
                summary: inputs.article.summary ?? undefined,
              },
              mine: { displayName: inputs.mine.displayName, reflection: inputs.mine.content },
              partner: {
                displayName: inputs.partner.displayName,
                reflection: inputs.partner.content,
              },
            },
            {
              creditService: app.creditService,
              mindlogicClient: app.mindlogicClient,
              maxRetries: options.maxRetries ?? env.MINDLOGIC_MAX_RETRIES,
              now,
              // A brand-new request_id — never the old failed attempt's.
              // That old one's credit_usage_records row is left exactly
              // as-is, permanently, as the failure history.
              generateRequestId: () => claim.requestId,
            },
          );
          const durationMs = Date.now() - startedAt;

          return finalizeComparisonOutcome(
            app,
            outcome,
            date,
            claim.requestId,
            request,
            reply,
            durationMs,
            logFields,
          );
        }
      }
    },
  );
}
