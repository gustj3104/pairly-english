import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { createSessionGate } from '../plugins/session-gate.js';
import { validateStudyDate } from '../services/daily-reflections/date.js';
import {
  hashForLogging,
  normalizeParticipantKey,
} from '../services/daily-reflections/participant-key.js';
import { submitReflectionRequestSchema } from '../services/daily-reflections/schema.js';
import { compareReflections } from '../services/reflections/reflection-comparison-service.js';
import { respondToReflectionComparisonOutcome } from '../services/reflections/http-mapping.js';

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

export async function studyDaysRoutes(
  app: FastifyInstance,
  options: StudyDaysRoutesOptions,
): Promise<void> {
  const sessionGate = createSessionGate(options.sessionSecret);
  const now = options.now ?? (() => new Date());

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

  app.post('/study-days/:date/compare', { preHandler: sessionGate }, async (request, reply) => {
    const date = validateDateParam(request, reply, options.maxFutureDays, now);
    if (date === undefined) return;

    const session = requireSession(request, reply);
    if (session === undefined) return;

    const participantKey = normalizeParticipantKey(session.name);
    const inputs = await app.dailyReflectionService.getComparisonInputs(date, participantKey);

    if (!inputs.ok) {
      reply.code(409);
      return {
        error: {
          message: 'Your partner has not submitted a reflection for this study day yet',
          code: 'PARTNER_NOT_READY',
          requestId: request.id,
        },
      };
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
        partner: { displayName: inputs.partner.displayName, reflection: inputs.partner.content },
      },
      {
        creditService: app.creditService,
        mindlogicClient: app.mindlogicClient,
        maxRetries: options.maxRetries ?? env.MINDLOGIC_MAX_RETRIES,
        now,
      },
    );
    const durationMs = Date.now() - startedAt;

    return respondToReflectionComparisonOutcome(outcome, request, reply, durationMs, {
      studyDate: date,
      participantKeyHash: hashForLogging(participantKey),
    });
  });
}
