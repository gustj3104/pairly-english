import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { CookieSerializeOptions } from '@fastify/cookie';

export const SESSION_COOKIE_NAME = 'pairly_session';

export interface SessionPayload {
  /** Display name only — never used as an authorization/identity check. */
  name: string;
}

const sessionPayloadSchema = z.object({ name: z.string().min(1) });

/**
 * Stateless session: the JWT itself carries `{ name, exp }`, signed with
 * SESSION_SECRET (HS256, via the `jsonwebtoken` library — no hand-rolled
 * crypto). Nothing is stored server-side, so a restart doesn't invalidate
 * existing sessions.
 */
export function signSession(
  payload: SessionPayload,
  secret: string,
  maxAgeSeconds: number,
): string {
  return jwt.sign(payload, secret, { expiresIn: maxAgeSeconds, algorithm: 'HS256' });
}

/** Returns null for any invalid/expired/tampered/malformed token — never throws. */
export function verifySession(token: string, secret: string): SessionPayload | null {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const parsed = sessionPayloadSchema.safeParse(decoded);
  return parsed.success ? { name: parsed.data.name } : null;
}

export function sessionCookieOptions(
  nodeEnv: string,
  maxAgeSeconds: number,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    // Local dev runs over plain http://localhost — a Secure cookie would
    // never be sent back by the browser there. Only require it once the
    // app is actually served over https (production).
    secure: nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
