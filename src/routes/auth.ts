import type { FastifyInstance } from 'fastify';
import { loginRequestSchema } from '../services/auth/schema.js';
import { timingSafeEqualPassword } from '../services/auth/password.js';
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  signSession,
  verifySession,
} from '../services/auth/session.js';

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

    // Same response shape/status whether the password is simply wrong or
    // the name happened to fail some other check — there is no per-user
    // record to distinguish "wrong name" from "wrong password" against,
    // so there is nothing more specific to leak in the first place.
    if (!timingSafeEqualPassword(password, sharedPassword)) {
      reply.code(401);
      return {
        error: {
          message: 'Invalid name or password',
          code: 'INVALID_CREDENTIALS',
          requestId: request.id,
        },
      };
    }

    const token = signSession({ name }, sessionSecret, sessionMaxAgeSeconds);
    reply.setCookie(
      SESSION_COOKIE_NAME,
      token,
      sessionCookieOptions(nodeEnv, sessionMaxAgeSeconds),
    );
    return { name };
  });

  app.get('/auth/session', async (request) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) return { authenticated: false as const };

    const payload = verifySession(token, sessionSecret);
    if (!payload) return { authenticated: false as const };

    return { authenticated: true as const, name: payload.name };
  });

  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    reply.code(204);
    return reply.send();
  });
}
