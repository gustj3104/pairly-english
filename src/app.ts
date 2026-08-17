import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { registerCors } from './plugins/cors.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { usageRoutes } from './routes/usage.js';
import { checkDatabaseConnection as defaultCheckDatabaseConnection } from './db/client.js';
import { db } from './db/client.js';
import { CreditService } from './services/credits/credit-service.js';
import { DrizzleCreditRepository } from './services/credits/credit-repository.js';

declare module 'fastify' {
  interface FastifyInstance {
    creditService: CreditService;
    checkDatabaseConnection: () => Promise<boolean>;
  }
}

export interface BuildAppOptions {
  corsOrigin?: string;
  creditService?: CreditService;
  checkDatabaseConnection?: () => Promise<boolean>;
}

const BODY_LIMIT_BYTES = 1024 * 100; // 100kb

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    genReqId: () => randomUUID(),
    bodyLimit: BODY_LIMIT_BYTES,
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[REDACTED]',
      },
    },
  });

  registerErrorHandler(app);
  registerCors(app, options.corsOrigin ?? env.FRONTEND_ORIGIN);

  app.decorate(
    'creditService',
    options.creditService ??
      new CreditService(new DrizzleCreditRepository(db), env.MINDLOGIC_MONTHLY_CREDIT_LIMIT),
  );
  app.decorate(
    'checkDatabaseConnection',
    options.checkDatabaseConnection ?? defaultCheckDatabaseConnection,
  );

  app.register(healthRoutes);
  app.register(usageRoutes, { prefix: '/api/v1' });

  return app;
}
