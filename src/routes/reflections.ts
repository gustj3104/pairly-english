import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { createAuthGate, type AuthGateOptions } from '../plugins/auth-gate.js';
import { compareReflectionsRequestSchema } from '../services/reflections/schema.js';
import { compareReflections } from '../services/reflections/reflection-comparison-service.js';
import type { ReflectionComparisonOutcome } from '../services/reflections/reflection-comparison-service.js';
import { respondToReflectionComparisonOutcome } from '../services/reflections/http-mapping.js';

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

  /**
   * Superseded by `POST /api/v1/study-days/:date/compare`
   * (src/routes/study-days.ts), which sources both sides' reflections
   * from the database instead of trusting the caller to submit both —
   * kept only for the CLI smoke-test scripts
   * (scripts/mindlogic-smoke-test*.ts) and backward compatibility. Do
   * not remove or restrict this route.
   */
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

      request.log.warn(
        { requestId: request.id },
        'deprecated route called: POST /reflections/compare — use POST /study-days/:date/compare instead',
      );

      const startedAt = Date.now();
      const outcome: ReflectionComparisonOutcome = await compareReflections(parsed.data, {
        creditService: app.creditService,
        mindlogicClient: app.mindlogicClient,
        maxRetries: env.MINDLOGIC_MAX_RETRIES,
      });
      const durationMs = Date.now() - startedAt;

      return respondToReflectionComparisonOutcome(outcome, request, reply, durationMs);
    },
  );
}
