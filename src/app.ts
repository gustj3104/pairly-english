import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { env } from './config/env.js';
import { registerCors } from './plugins/cors.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import type { AuthGateOptions } from './plugins/auth-gate.js';
import { healthRoutes } from './routes/health.js';
import { usageRoutes } from './routes/usage.js';
import { authRoutes, type AuthRoutesOptions } from './routes/auth.js';
import { reflectionsRoutes } from './routes/reflections.js';
import { studyDaysRoutes, type StudyDaysRoutesOptions } from './routes/study-days.js';
import { checkDatabaseConnection as defaultCheckDatabaseConnection } from './db/client.js';
import { db } from './db/client.js';
import { CreditService } from './services/credits/credit-service.js';
import { DrizzleCreditRepository } from './services/credits/credit-repository.js';
import type { MindlogicClient } from './services/mindlogic/client.js';
import { createMindlogicClient } from './services/mindlogic/create-client.js';
import { DailyReflectionService } from './services/daily-reflections/daily-reflection-service.js';
import { DrizzleDailyReflectionRepository } from './services/daily-reflections/daily-reflection-repository.js';
import { ComparisonService } from './services/daily-reflections/comparison-service.js';
import { DrizzleComparisonRepository } from './services/daily-reflections/comparison-repository.js';
import type { SessionPayload } from './services/auth/session.js';
import { DailyNewsService } from './services/daily-news/service.js';
import { DrizzleDailyNewsRepository } from './services/daily-news/repository.js';
import { dictionaryRoutes } from './routes/dictionary.js';
import { DictionaryService } from './services/dictionary/service.js';
import { DrizzleDictionaryRepository } from './services/dictionary/repository.js';

declare module 'fastify' {
  interface FastifyInstance {
    creditService: CreditService;
    checkDatabaseConnection: () => Promise<boolean>;
    mindlogicClient: MindlogicClient;
    dailyReflectionService: DailyReflectionService;
    comparisonService: ComparisonService;
    dailyNewsService: DailyNewsService;
    dictionaryService: DictionaryService;
  }
  interface FastifyRequest {
    /**
     * Parsed session payload — set only by session-gate.ts's preHandler
     * (src/plugins/session-gate.ts), used by the daily-reflections routes
     * that need the caller's actual identity. auth-gate.ts (the older,
     * still-used gate for /reflections/compare) does NOT set this.
     */
    session: SessionPayload | null;
  }
}

export interface BuildAppOptions {
  corsOrigin?: string;
  creditService?: CreditService;
  checkDatabaseConnection?: () => Promise<boolean>;
  mindlogicClient?: MindlogicClient;
  authGateOptions?: AuthGateOptions;
  authRoutesOptions?: AuthRoutesOptions;
  dailyReflectionService?: DailyReflectionService;
  comparisonService?: ComparisonService;
  dailyNewsService?: DailyNewsService;
  dictionaryService?: DictionaryService;
  studyDaysRoutesOptions?: StudyDaysRoutesOptions;
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
  // via `config: { rateLimit: ... }` (see REFLECTIONS_COMPARE_RATE_LIMIT,
  // LOGIN_RATE_LIMIT).
  app.register(rateLimit, { global: false });
  app.register(cookie);
  app.decorateRequest('session', null);

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
  app.decorate(
    'dailyReflectionService',
    options.dailyReflectionService ??
      new DailyReflectionService(new DrizzleDailyReflectionRepository(db)),
  );
  app.decorate(
    'comparisonService',
    options.comparisonService ?? new ComparisonService(new DrizzleComparisonRepository(db)),
  );
  app.decorate(
    'dailyNewsService',
    options.dailyNewsService ??
      new DailyNewsService(
        new DrizzleDailyNewsRepository(db),
        app.creditService,
        app.mindlogicClient,
      ),
  );
  app.decorate(
    'dictionaryService',
    options.dictionaryService ?? new DictionaryService(new DrizzleDictionaryRepository(db)),
  );

  app.register(healthRoutes);
  app.register(usageRoutes, { prefix: '/api/v1' });
  app.register(authRoutes, {
    prefix: '/api/v1',
    ...(options.authRoutesOptions ?? {
      nodeEnv: env.NODE_ENV,
      sharedPassword: env.APP_SHARED_PASSWORD,
      sessionSecret: env.SESSION_SECRET,
      sessionMaxAgeSeconds: env.SESSION_MAX_AGE_SECONDS,
    }),
  });
  app.register(reflectionsRoutes, {
    prefix: '/api/v1',
    authGateOptions: options.authGateOptions,
  });
  app.register(studyDaysRoutes, {
    prefix: '/api/v1',
    ...(options.studyDaysRoutesOptions ?? {
      sessionSecret: env.SESSION_SECRET,
      maxFutureDays: env.STUDY_DAY_MAX_FUTURE_DAYS,
    }),
  });
  app.register(dictionaryRoutes, {
    prefix: '/api/v1',
    sessionSecret: options.studyDaysRoutesOptions?.sessionSecret ?? env.SESSION_SECRET,
  });

  return app;
}
