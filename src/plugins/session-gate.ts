import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE_NAME, verifySession } from '../services/auth/session.js';
import { isAllowedParticipantKey } from '../services/auth/allowed-participants.js';
import { normalizeParticipantKey } from '../services/daily-reflections/participant-key.js';

/**
 * Auth gate for the daily-reflections routes: unlike
 * src/plugins/auth-gate.ts, this needs the caller's actual identity (the
 * session's `name`), not just proof of "some valid session" — the
 * max-2-participants rule has to know WHO is submitting. Deliberately no
 * dev-bearer-token escape hatch: that token carries no name, and this
 * feature fundamentally needs one. On success, sets `request.session` via
 * the `FastifyRequest` decoration registered in src/app.ts; on failure,
 * sends the same 401 envelope shape as auth-gate.ts.
 *
 * verify signature (verifySession) -> normalize -> allow-list check ->
 * `request.session` is always set to the canonical normalized form, never
 * the JWT's raw payload — so every downstream consumer that reads
 * `request.session.name` directly gets the canonical key unconditionally,
 * even for a session signed before this allow-list existed or with
 * non-canonical casing/whitespace.
 */
export function createSessionGate(sessionSecret: string) {
  return async function sessionGate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    const session = token ? verifySession(token, sessionSecret) : null;
    const key = session ? normalizeParticipantKey(session.name) : null;

    if (!session || !key || !isAllowedParticipantKey(key)) {
      reply.code(401).send({
        error: { message: 'Unauthorized', code: 'UNAUTHORIZED', requestId: request.id },
      });
      return;
    }

    request.session = { name: key };
  };
}
