import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { createSessionGate } from '../plugins/session-gate.js';
import { isAllowedParticipantKey } from '../services/auth/allowed-participants.js';
import { validateStudyDate } from '../services/daily-reflections/date.js';
import { normalizeParticipantKey } from '../services/daily-reflections/participant-key.js';
import { putTranscriptRequestSchema } from '../services/discussion-feedback/schema.js';
import { discussionFeedbackResultSchema } from '../services/discussion-feedback/schema.js';
import { generateDiscussionFeedback } from '../services/discussion-feedback/generate-feedback.js';
import type { DiscussionFeedbackGenerationOutcome } from '../services/discussion-feedback/generate-feedback.js';
import type { ClaimFeedbackOutcome } from '../services/discussion-feedback/types.js';
import type { TranscriptView } from '../services/discussion-feedback/discussion-feedback-service.js';

export interface DiscussionFeedbackRoutesOptions {
  sessionSecret: string;
  maxFutureDays: number;
  now?: () => Date;
  maxRetries?: number;
}

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
 * The two allowed participant keys are a fixed, global 2-user allow-list
 * (see ALLOWED_PARTICIPANT_KEYS) — session-gate.ts already guarantees
 * request.session.name passed this check before setting request.session,
 * so this can never actually fail in practice. Asserted anyway per the
 * task's explicit instruction not to skip it, and as defense in depth
 * against a future session-gate change.
 */
function requireAllowedParticipant(
  request: FastifyRequest,
  reply: FastifyReply,
  participantKey: string,
): boolean {
  if (!isAllowedParticipantKey(participantKey)) {
    reply.code(403).send({
      error: { message: 'Forbidden', code: 'FORBIDDEN', requestId: request.id },
    });
    return false;
  }
  return true;
}

function transcriptResponseBody(transcript: TranscriptView) {
  return {
    studyDate: transcript.studyDate,
    topicIndex: transcript.topicIndex,
    segments: transcript.segments,
    updatedAt: transcript.updatedAt,
    updatedBy: transcript.updatedBy,
  };
}

const CLAIM_PRECONDITION_HTTP: Record<
  Extract<
    ClaimFeedbackOutcome['outcome'],
    | 'no_transcript'
    | 'unassigned_segments'
    | 'single_speaker_only'
    | 'topic_not_ready'
    | 'topic_changed'
  >,
  { statusCode: number; code: string; message: string }
> = {
  no_transcript: {
    statusCode: 422,
    code: 'no_transcript',
    message: 'No transcript has been saved for this study day yet',
  },
  unassigned_segments: {
    statusCode: 422,
    code: 'unassigned_segments',
    message: 'Every transcript segment must be assigned to a speaker before generating feedback',
  },
  single_speaker_only: {
    statusCode: 422,
    code: 'single_speaker_only',
    message: 'The transcript must include segments from both participants',
  },
  topic_not_ready: {
    statusCode: 409,
    code: 'topic_not_ready',
    message: 'The discussion comparison for this study day is not completed and up to date yet',
  },
  topic_changed: {
    statusCode: 409,
    code: 'topic_changed',
    message: 'The selected discussion topic no longer matches this transcript',
  },
};

function mapFeedbackGenerationFailureToHttp(
  status: Exclude<DiscussionFeedbackGenerationOutcome['status'], 'ok'>,
): { statusCode: number; code: string } {
  switch (status) {
    case 'limit_exceeded':
      return { statusCode: 402, code: 'CREDIT_LIMIT_EXCEEDED' };
    case 'provider_exhausted':
      return { statusCode: 402, code: 'PROVIDER_CREDIT_EXHAUSTED' };
    case 'upstream_failed':
      return { statusCode: 502, code: 'UPSTREAM_REQUEST_FAILED' };
    case 'upstream_schema_error':
      return { statusCode: 502, code: 'UPSTREAM_SCHEMA_ERROR' };
    case 'reservation_exceeded':
      return { statusCode: 500, code: 'CREDIT_RESERVATION_EXCEEDED' };
    case 'reconciliation_pending':
      return { statusCode: 409, code: 'RECONCILIATION_PENDING' };
    default: {
      const exhaustive: never = status;
      throw new Error(
        `Unhandled discussion feedback failure status: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

async function finalizeFeedbackOutcome(
  app: FastifyInstance,
  outcome: DiscussionFeedbackGenerationOutcome,
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
    await app.discussionFeedbackService.completeFeedback(studyDate, requestId, outcome.result);
    request.log.info(
      { ...logFields, droppedImprovements: outcome.droppedImprovements },
      'discussion feedback completed',
    );
    reply.code(200);
    return { status: 'completed', result: outcome.result, stale: false };
  }

  const mapping = mapFeedbackGenerationFailureToHttp(outcome.status);

  if (outcome.status === 'reconciliation_pending') {
    await app.discussionFeedbackService.markFeedbackReconciliationPending(
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
      'discussion feedback transmission status unknown — held for reconciliation',
    );
    reply.code(mapping.statusCode);
    return { status: 'reconciliation_pending' };
  }

  const errorCode = outcome.status === 'upstream_failed' ? outcome.code : outcome.status;
  await app.discussionFeedbackService.failFeedback(studyDate, requestId, errorCode);
  request.log.warn(
    outcome.status === 'upstream_failed'
      ? {
          ...logFields,
          upstreamCode: outcome.code,
          upstreamStatus: outcome.upstreamStatus,
          ...outcome.observability,
        }
      : logFields,
    'discussion feedback generation failed',
  );
  reply.code(mapping.statusCode);
  return { status: 'failed', errorCode };
}

export async function discussionFeedbackRoutes(
  app: FastifyInstance,
  options: DiscussionFeedbackRoutesOptions,
): Promise<void> {
  const sessionGate = createSessionGate(options.sessionSecret);
  const now = options.now ?? (() => new Date());

  app.get(
    '/study-days/:date/discussion/transcript',
    { preHandler: sessionGate },
    async (request, reply) => {
      const date = validateDateParam(request, reply, options.maxFutureDays, now);
      if (date === undefined || requireSession(request, reply) === undefined) return;
      const transcript = await app.discussionFeedbackService.getTranscript(date);
      reply.code(200);
      return transcriptResponseBody(transcript);
    },
  );

  app.put(
    '/study-days/:date/discussion/transcript',
    { preHandler: sessionGate },
    async (request, reply) => {
      const date = validateDateParam(request, reply, options.maxFutureDays, now);
      const session = requireSession(request, reply);
      if (date === undefined || session === undefined) return;

      const participantKey = normalizeParticipantKey(session.name);
      if (!requireAllowedParticipant(request, reply, participantKey)) return;

      const parsed = putTranscriptRequestSchema.safeParse(request.body);
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

      const outcome = await app.discussionFeedbackService.saveTranscript({
        studyDate: date,
        segments: parsed.data.segments,
        topicIndex: parsed.data.topicIndex,
        updatedBy: participantKey,
        now: now(),
      });

      if (!outcome.ok) {
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
      return transcriptResponseBody(outcome.transcript);
    },
  );

  app.get(
    '/study-days/:date/discussion/feedback',
    { preHandler: sessionGate },
    async (request, reply) => {
      const date = validateDateParam(request, reply, options.maxFutureDays, now);
      if (date === undefined || requireSession(request, reply) === undefined) return;

      const result = await app.discussionFeedbackService.getFeedback(date);

      switch (result.status) {
        case 'not_started':
          reply.code(200);
          return { status: 'not_started' };
        case 'processing':
          reply.code(200);
          return { status: 'processing' };
        case 'completed':
          reply.code(200);
          return { status: 'completed', result: result.result, stale: result.stale };
        case 'failed':
          reply.code(200);
          return { status: 'failed', errorCode: result.errorCode };
        case 'reconciliation_pending':
          reply.code(200);
          return { status: 'reconciliation_pending' };
        case 'corrupted':
          request.log.error(
            { requestId: request.id, studyDate: date },
            'stored discussion feedback result failed schema validation',
          );
          reply.code(500);
          return { status: 'failed', errorCode: 'CORRUPTED_RESULT' };
      }
    },
  );

  app.post(
    '/study-days/:date/discussion/feedback',
    { preHandler: sessionGate },
    async (request, reply) => {
      const date = validateDateParam(request, reply, options.maxFutureDays, now);
      const session = requireSession(request, reply);
      if (date === undefined || session === undefined) return;

      const participantKey = normalizeParticipantKey(session.name);
      if (!requireAllowedParticipant(request, reply, participantKey)) return;

      const logFields = { requestId: request.id, studyDate: date };

      const claim = await app.discussionFeedbackService.claimFeedbackGeneration(date);

      switch (claim.outcome) {
        case 'no_transcript':
        case 'unassigned_segments':
        case 'single_speaker_only':
        case 'topic_not_ready':
        case 'topic_changed': {
          const mapping = CLAIM_PRECONDITION_HTTP[claim.outcome];
          request.log.info(
            { ...logFields, outcome: claim.outcome },
            'discussion feedback rejected',
          );
          reply.code(mapping.statusCode);
          return {
            error: { message: mapping.message, code: mapping.code, requestId: request.id },
          };
        }

        case 'in_progress':
          request.log.info(logFields, 'discussion feedback already in progress');
          reply.code(202);
          return { status: 'processing' };

        case 'reconciliation_pending':
          request.log.warn(logFields, 'discussion feedback read: reconciliation pending');
          reply.code(409);
          return { status: 'reconciliation_pending' };

        case 'cached': {
          const parsed = discussionFeedbackResultSchema.safeParse(claim.result);
          if (!parsed.success) {
            request.log.error(
              logFields,
              'cached discussion feedback result failed schema validation',
            );
            reply.code(500);
            return { status: 'failed', errorCode: 'CORRUPTED_RESULT' };
          }
          request.log.info(logFields, 'discussion feedback served from cache');
          reply.code(200);
          return { status: 'completed', result: parsed.data, stale: false };
        }

        case 'claimed': {
          const startedAt = Date.now();
          const outcome = await generateDiscussionFeedback(claim.promptInputs, {
            creditService: app.creditService,
            mindlogicClient: app.mindlogicClient,
            maxRetries: options.maxRetries ?? env.MINDLOGIC_MAX_RETRIES,
            now,
            generateRequestId: () => claim.requestId,
            logger: app.log,
          });
          const durationMs = Date.now() - startedAt;

          return finalizeFeedbackOutcome(
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
