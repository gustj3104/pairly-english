import type { FastifyReply, FastifyRequest } from 'fastify';

export interface DevAiGateOptions {
  nodeEnv: string;
  /** Server-only temporary access token. Never bundled into the frontend build. */
  devAccessToken?: string;
}

/**
 * Temporary pre-auth gate for AI routes until real authentication exists.
 * Fails closed in both directions:
 *  - production: always 404, regardless of any token — there is no real
 *    auth yet, so this route must never be reachable in production.
 *  - development/test: requires `Authorization: Bearer <devAccessToken>`
 *    to match a server-only env var; if that var isn't set at all, the
 *    route refuses (503) rather than defaulting to open access.
 */
export function createDevAiGate(options: DevAiGateOptions) {
  return async function devAiGate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (options.nodeEnv === 'production') {
      reply.code(404).send({
        error: { message: 'Not Found', code: 'NOT_FOUND', requestId: request.id },
      });
      return;
    }

    if (!options.devAccessToken) {
      reply.code(503).send({
        error: {
          message: 'This AI route is not configured for this environment',
          code: 'AI_ROUTE_NOT_CONFIGURED',
          requestId: request.id,
        },
      });
      return;
    }

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (token !== options.devAccessToken) {
      reply.code(401).send({
        error: { message: 'Unauthorized', code: 'UNAUTHORIZED', requestId: request.id },
      });
      return;
    }
  };
}
