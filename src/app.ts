import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { registerCors } from './plugins/cors.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import type { DevAiGateOptions } from './plugins/dev-ai-gate.js';
import { healthRoutes } from './routes/health.js';
import { usageRoutes } from './routes/usage.js';
import { reflectionsRoutes } from './routes/reflections.js';
import { checkDatabaseConnection as defaultCheckDatabaseConnection } from './db/client.js';
import { db } from './db/client.js';
import { CreditService } from './services/credits/credit-service.js';
import { DrizzleCreditRepository } from './services/credits/credit-repository.js';
import type { MindlogicClient } from './services/mindlogic/client.js';
import { createMindlogicClient } from './services/mindlogic/create-client.js';

declare module 'fastify' {
  interface FastifyInstance {
    creditService: CreditService;
    checkDatabaseConnection: () => Promise<boolean>;
    mindlogicClient: MindlogicClient;
  }
}

export interface BuildAppOptions {
  corsOrigin?: string;
  creditService?: CreditService;
  checkDatabaseConnection?: () => Promise<boolean>;
  mindlogicClient?: MindlogicClient;
  devAiGateOptions?: DevAiGateOptions;
  /** Test-only: redirect Pino output somewhere inspectable instead of silent/stdout. */
  loggerStream?: NodeJS.WritableStream;
}

const BODY_LIMIT_BYTES = 1024 * 100; // 100kb

const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    genReqId: () => randomUUID(),
    bodyLimit: BODY_LIMIT_BYTES,
    logger: {
      level: env.NODE_ENV === 'test' && !options.loggerStream ? 'silent' : 'info',
      redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
      stream: options.loggerStream,
    },
  });

  registerErrorHandler(app);
  registerCors(app, options.corsOrigin ?? env.FRONTEND_ORIGIN);
  // `global: false`: no route is rate-limited unless it explicitly opts in
  // via `config: { rateLimit: ... }` (see REFLECTIONS_COMPARE_RATE_LIMIT).
  app.register(rateLimit, { global: false });

  app.decorate(
    'creditService',
    options.creditService ??
      new CreditService(new DrizzleCreditRepository(db), env.MINDLOGIC_MONTHLY_CREDIT_LIMIT),
  );
  app.decorate(
    'checkDatabaseConnection',
    options.checkDatabaseConnection ?? defaultCheckDatabaseConnection,
  );
  app.decorate('mindlogicClient', options.mindlogicClient ?? createMindlogicClient());

  app.register(healthRoutes);
  app.register(usageRoutes, { prefix: '/api/v1' });
  app.register(reflectionsRoutes, {
    prefix: '/api/v1',
    devAiGateOptions: options.devAiGateOptions,
  });

  return app;
}
