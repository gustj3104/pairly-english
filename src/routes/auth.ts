import type { FastifyInstance } from 'fastify';
import { loginRequestSchema } from '../services/auth/schema.js';
import { timingSafeEqualPassword } from '../services/auth/password.js';
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  signSession,
  verifySession,
} from '../services/auth/session.js';
import { isAllowedParticipantKey } from '../services/auth/allowed-participants.js';
import { normalizeParticipantKey } from '../services/daily-reflections/participant-key.js';

/** Deliberately generous — this only protects against brute-forcing the one shared password. */
export const LOGIN_RATE_LIMIT = { max: 5, timeWindow: '1 minute' };

export interface AuthRoutesOptions {
  nodeEnv: string;
  sharedPassword: string;
  sessionSecret: string;
  sessionMaxAgeSeconds: number;
}

export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { nodeEnv, sharedPassword, sessionSecret, sessionMaxAgeSeconds } = options;

  app.post('/auth/login', { config: { rateLimit: LOGIN_RATE_LIMIT } }, async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: { message: 'Invalid request body', code: 'VALIDATION_ERROR', requestId: request.id },
      };
    }

    const { name, password } = parsed.data;

    // Same response shape/status whether the password is simply wrong, the
    // name failed some other check, or the name isn't on the allow-list —
    // there is no per-user record to distinguish these against, so there is
    // nothing more specific to leak (in particular, never which names are
    // allowed).
    const invalidCredentials = () => {
      reply.code(401);
      return {
        error: {
          message: 'Invalid name or password',
          code: 'INVALID_CREDENTIALS',
          requestId: request.id,
        },
      };
    };

    if (!timingSafeEqualPassword(password, sharedPassword)) {
      return invalidCredentials();
    }

    // verify (password, above) -> normalize -> allow-list check -> only the
    // canonical key is ever signed/returned from here on, never the raw
    // display name.
    const key = normalizeParticipantKey(name);
    if (!isAllowedParticipantKey(key)) {
      return invalidCredentials();
    }

    const token = signSession({ name: key }, sessionSecret, sessionMaxAgeSeconds);
    reply.setCookie(
      SESSION_COOKIE_NAME,
      token,
      sessionCookieOptions(nodeEnv, sessionMaxAgeSeconds),
    );
    return { name: key };
  });

  app.get('/auth/session', async (request) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) return { authenticated: false as const };

    const payload = verifySession(token, sessionSecret);
    if (!payload) return { authenticated: false as const };

    // Fail-closed for any session — including one issued before this
    // allow-list existed, or signed with non-canonical casing/whitespace —
    // whose normalized name isn't one of the two allowed participants.
    const key = normalizeParticipantKey(payload.name);
    if (!isAllowedParticipantKey(key)) return { authenticated: false as const };

    return { authenticated: true as const, name: key };
  });

  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    reply.code(204);
    return reply.send();
  });
}
