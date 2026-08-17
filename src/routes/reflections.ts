import type { FastifyInstance, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { createAuthGate, type AuthGateOptions } from '../plugins/auth-gate.js';
import { compareReflectionsRequestSchema } from '../services/reflections/schema.js';
import { compareReflections } from '../services/reflections/reflection-comparison-service.js';
import type { ReflectionComparisonOutcome } from '../services/reflections/reflection-comparison-service.js';

export interface ReflectionsRoutesOptions {
  authGateOptions?: AuthGateOptions;
}

/**
 * Per-caller cap on the one route that can spend real Mindlogic credits.
 * Independent of (and much tighter than) the 5,000/month credit cap —
 * this exists to blunt a buggy client retry loop or a single caller
 * hammering the route, not to budget spend. Keyed on IP by
 * `@fastify/rate-limit`'s default, registered with `global: false` in
 * `src/app.ts` so it only applies where a route opts in via `config.rateLimit`.
 */
export const REFLECTIONS_COMPARE_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

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

export async function reflectionsRoutes(
  app: FastifyInstance,
  options: ReflectionsRoutesOptions = {},
): Promise<void> {
  const authGate = createAuthGate(
    options.authGateOptions ?? {
      nodeEnv: env.NODE_ENV,
      sessionSecret: env.SESSION_SECRET,
      devAccessToken: env.AI_DEV_ACCESS_TOKEN,
    },
  );

  app.post(
    '/reflections/compare',
    { preHandler: authGate, config: { rateLimit: REFLECTIONS_COMPARE_RATE_LIMIT } },
    async (request, reply) => {
      const parsed = compareReflectionsRequestSchema.safeParse(request.body);
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

      const startedAt = Date.now();
      const outcome: ReflectionComparisonOutcome = await compareReflections(parsed.data, {
        creditService: app.creditService,
        mindlogicClient: app.mindlogicClient,
        maxRetries: env.MINDLOGIC_MAX_RETRIES,
      });
      const durationMs = Date.now() - startedAt;

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
      };

      switch (outcome.status) {
        case 'ok':
          request.log.info(logFields, 'reflection comparison completed');
          reply.code(200);
          return { requestId: outcome.requestId, ...outcome.result };

        case 'limit_exceeded':
          request.log.warn(
            logFields,
            'reflection comparison rejected: monthly credit limit reached',
          );
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
          request.log.error(
            logFields,
            'reflection comparison actual usage exceeded its reservation',
          );
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
    },
  );
}
