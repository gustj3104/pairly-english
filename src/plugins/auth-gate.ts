import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE_NAME, verifySession } from '../services/auth/session.js';

export interface AuthGateOptions {
  nodeEnv: string;
  sessionSecret: string;
  /**
   * Server-only token for the CLI smoke script
   * (`scripts/mindlogic-smoke-test*.ts`) — never bundled into the
   * frontend, never accepted in production, never how a browser request
   * is expected to authenticate.
   */
  devAccessToken?: string;
}

/**
 * Real auth gate for AI routes: a valid session cookie (set by
 * `POST /api/v1/auth/login`) is required in every environment, including
 * production — there is no more blanket "always 404 in production"
 * escape hatch now that a real (if minimal) login exists. The session's
 * `name` is display-only, never used as an authorization check; holding
 * a valid, unexpired, correctly-signed session is the only thing that
 * matters here.
 *
 * The one exception is the CLI smoke script's static bearer token, kept
 * for non-browser callers and refused outright in production — a leaked
 * static token should never be able to reach a public deployment, even
 * though a real session now can.
 */
export function createAuthGate(options: AuthGateOptions) {
  return async function authGate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (token && verifySession(token, options.sessionSecret)) {
      return;
    }

    if (options.nodeEnv !== 'production' && options.devAccessToken) {
      const header = request.headers.authorization;
      const bearerToken = header?.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : undefined;
      if (bearerToken === options.devAccessToken) {
        return;
      }
    }

    reply.code(401).send({
      error: { message: 'Unauthorized', code: 'UNAUTHORIZED', requestId: request.id },
    });
  };
}
