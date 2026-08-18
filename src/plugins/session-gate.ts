import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE_NAME, verifySession } from '../services/auth/session.js';

/**
 * Auth gate for the daily-reflections routes: unlike
 * src/plugins/auth-gate.ts, this needs the caller's actual identity (the
 * session's `name`), not just proof of "some valid session" — the
 * max-2-participants rule has to know WHO is submitting. Deliberately no
 * dev-bearer-token escape hatch: that token carries no name, and this
 * feature fundamentally needs one. On success, sets `request.session` via
 * the `FastifyRequest` decoration registered in src/app.ts; on failure,
 * sends the same 401 envelope shape as auth-gate.ts.
 */
export function createSessionGate(sessionSecret: string) {
  return async function sessionGate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    const session = token ? verifySession(token, sessionSecret) : null;

    if (!session) {
      reply.code(401).send({
        error: { message: 'Unauthorized', code: 'UNAUTHORIZED', requestId: request.id },
      });
      return;
    }

    request.session = session;
  };
}
