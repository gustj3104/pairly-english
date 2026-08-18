import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ReflectionComparisonOutcome } from './reflection-comparison-service.js';

function sendError(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  code: string,
  requestId: string,
) {
  reply.code(statusCode);
  return { error: { message, code, requestId } };
}

/**
 * Maps a ReflectionComparisonOutcome to an HTTP response and logs the
 * allow-listed accounting fields — extracted from the original
 * `POST /api/v1/reflections/compare` route (src/routes/reflections.ts) so
 * `POST /api/v1/study-days/:date/compare` (src/routes/study-days.ts) can
 * reuse the exact same status-code mapping without duplicating the
 * switch. Behavior is unchanged from the original inline version.
 *
 * `extraLogFields` lets a caller merge in additional allow-listed context
 * (e.g. studyDate, participantKeyHash) without altering what the
 * original /reflections/compare route logs — it defaults to `{}`.
 */
export function respondToReflectionComparisonOutcome(
  outcome: ReflectionComparisonOutcome,
  request: FastifyRequest,
  reply: FastifyReply,
  durationMs: number,
  extraLogFields: Record<string, unknown> = {},
): unknown {
  // Allowed log fields only (task section 8): requestId, feature, model,
  // HTTP outcome, token counts, reserved/actual credits, duration, and
  // an internal error code — never reflection text, article body,
  // display names, the API key, an Authorization header, or the raw
  // model response.
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

  switch (outcome.status) {
    case 'ok':
      request.log.info(logFields, 'reflection comparison completed');
      reply.code(200);
      return { requestId: outcome.requestId, ...outcome.result };

    case 'limit_exceeded':
      request.log.warn(logFields, 'reflection comparison rejected: monthly credit limit reached');
      return sendError(
        reply,
        402,
        'Monthly AI credit limit reached',
        'CREDIT_LIMIT_EXCEEDED',
        outcome.requestId,
      );

    case 'provider_exhausted':
      request.log.warn(logFields, 'reflection comparison rejected: provider credit exhausted');
      return sendError(
        reply,
        402,
        'AI provider credit exhausted',
        'PROVIDER_CREDIT_EXHAUSTED',
        outcome.requestId,
      );

    case 'upstream_failed':
      request.log.warn(
        {
          ...logFields,
          upstreamCode: outcome.code,
          upstreamStatus: outcome.upstreamStatus,
          ...outcome.observability,
        },
        'reflection comparison upstream call failed',
      );
      return sendError(
        reply,
        502,
        'AI provider request failed',
        'UPSTREAM_REQUEST_FAILED',
        outcome.requestId,
      );

    case 'upstream_schema_error':
      request.log.warn(logFields, 'reflection comparison upstream response failed validation');
      return sendError(
        reply,
        502,
        'AI provider returned an invalid response',
        'UPSTREAM_SCHEMA_ERROR',
        outcome.requestId,
      );

    case 'reservation_exceeded':
      request.log.error(logFields, 'reflection comparison actual usage exceeded its reservation');
      return sendError(
        reply,
        500,
        'Internal credit accounting error',
        'CREDIT_RESERVATION_EXCEEDED',
        outcome.requestId,
      );

    case 'reconciliation_pending':
      request.log.warn(
        {
          ...logFields,
          upstreamCode: outcome.code,
          upstreamStatus: outcome.upstreamStatus,
          ...outcome.observability,
        },
        'reflection comparison transmission status unknown — held for reconciliation',
      );
      return sendError(
        reply,
        409,
        'This request could not be confirmed and is being verified — do not resubmit it.',
        'RECONCILIATION_PENDING',
        outcome.requestId,
      );

    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unhandled reflection comparison outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
}
