import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

/**
 * Only a single, explicit origin is ever allowed — never a wildcard,
 * in any environment. `origin` normally comes from env.FRONTEND_ORIGIN;
 * tests may pass a different value to exercise allow/deny behavior.
 */
export function registerCors(app: FastifyInstance, origin: string): void {
  if (origin === '*') {
    throw new Error('Wildcard CORS origin is not allowed');
  }

  app.register(cors, {
    origin: [origin],
    credentials: true,
  });
}
