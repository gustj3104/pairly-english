import type { FastifyInstance, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { createDevAiGate, type DevAiGateOptions } from '../plugins/dev-ai-gate.js';
import { compareReflectionsRequestSchema } from '../services/reflections/schema.js';
import { compareReflections } from '../services/reflections/reflection-comparison-service.js';
import type { ReflectionComparisonOutcome } from '../services/reflections/reflection-comparison-service.js';

export interface ReflectionsRoutesOptions {
  devAiGateOptions?: DevAiGateOptions;
}

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
  const devAiGate = createDevAiGate(
    options.devAiGateOptions ?? { nodeEnv: env.NODE_ENV, devAccessToken: env.AI_DEV_ACCESS_TOKEN },
  );

  app.post('/reflections/compare', { preHandler: devAiGate }, async (request, reply) => {
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
          { ...logFields, upstreamCode: outcome.code },
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

      default: {
        const exhaustive: never = outcome;
        throw new Error(`Unhandled reflection comparison outcome: ${JSON.stringify(exhaustive)}`);
      }
    }
  });
}
