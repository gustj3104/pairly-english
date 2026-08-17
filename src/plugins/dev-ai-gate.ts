import type { FastifyReply, FastifyRequest } from 'fastify';

export interface DevAiGateOptions {
  nodeEnv: string;
  /** Server-only temporary access token. Never bundled into the frontend build. */
  devAccessToken?: string;
  /**
   * The single browser origin allowed to skip the token check, in
   * development only. Not an authentication mechanism — the `Origin`
   * header is client-supplied and trivially spoofable by any non-browser
   * caller (curl, a script). It exists purely to stop a *browser*
   * pointed at the wrong environment (e.g. a stray tab with prod's
   * `VITE_API_BASE_URL`) from silently reaching this route without a
   * token. Real gatekeeping for non-browser callers still comes from the
   * token check below, and CORS (`src/plugins/cors.ts`) independently
   * enforces the same single origin for actual cross-origin browser
   * requests.
   */
  frontendOrigin?: string;
}

/**
 * Temporary pre-auth gate for AI routes until real authentication exists.
 * Fails closed in every direction:
 *  - production: always 404, regardless of any token or origin — there is
 *    no real auth yet, so this route must never be reachable in production.
 *  - development, request Origin exactly equals `frontendOrigin`: allowed
 *    through with no token required. This is what lets the browser
 *    frontend call this route without ever holding a secret — see the
 *    `frontendOrigin` doc above for why this is a misfire guard, not auth.
 *  - everything else (development with no/mismatched Origin, or any other
 *    NODE_ENV): requires `Authorization: Bearer <devAccessToken>` to match
 *    a server-only env var; if that var isn't set at all, the route
 *    refuses (503) rather than defaulting to open access. This is the path
 *    the CLI smoke script (`AI_DEV_ACCESS_TOKEN`) uses.
 */
export function createDevAiGate(options: DevAiGateOptions) {
  return async function devAiGate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (options.nodeEnv === 'production') {
      reply.code(404).send({
        error: { message: 'Not Found', code: 'NOT_FOUND', requestId: request.id },
      });
      return;
    }

    const isBrowserDevOrigin =
      options.nodeEnv === 'development' &&
      !!options.frontendOrigin &&
      request.headers.origin === options.frontendOrigin;

    if (isBrowserDevOrigin) {
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
