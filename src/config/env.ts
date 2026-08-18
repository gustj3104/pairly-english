import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { isAllowedModel } from '../services/mindlogic/credit-rates.js';

// `.env.local` is where real, git-ignored secrets live (see README /
// .env.example); `.env` is an optional non-local fallback. dotenv does not
// override a value already set by an earlier file in the list (or by the
// real OS environment), so .env.local takes priority over .env.
loadDotenv({ path: ['.env.local', '.env'], quiet: true });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    HOST: z.string().min(1).default('127.0.0.1'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    FRONTEND_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    MINDLOGIC_API_KEY: z.string().min(1, 'MINDLOGIC_API_KEY is required'),
    MINDLOGIC_BASE_URL: z.string().url().default('https://factchat-cloud.mindlogic.ai/v1/gateway'),
    MINDLOGIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),
    MINDLOGIC_MONTHLY_CREDIT_LIMIT: z.coerce.number().int().positive().default(5000),
    /**
     * Static bearer token for the CLI smoke script only
     * (scripts/mindlogic-smoke-test*.ts) — real browser sessions use
     * POST /api/v1/auth/login instead (see src/plugins/auth-gate.ts).
     * Optional so env parsing itself never requires it; never accepted in
     * production regardless. Never bundled into the frontend.
     */
    AI_DEV_ACCESS_TOKEN: z.string().min(1).optional(),
    /**
     * Overrides the number of retries (after the first attempt) for
     * 429/5xx Mindlogic responses. Unset means "use the standard policy"
     * (see MAX_RETRY_ATTEMPTS in src/services/mindlogic/types.ts). Set to
     * 0 for a controlled one-shot call — e.g. a real smoke test — where a
     * second provider POST must be impossible regardless of the response.
     * Never affects the separate, always-off retry behavior for
     * timeout/connection_reset/incomplete_response/unknown (uncertain
     * billing status is never retried no matter what this is set to).
     */
    MINDLOGIC_MAX_RETRIES: z.coerce.number().int().min(0).optional(),
    /**
     * Shared password both users log in with (no per-user accounts).
     * Required — never defaulted, so the app can't boot with an
     * accidentally-empty password. Never logged (see redactedEnvSummary).
     */
    APP_SHARED_PASSWORD: z.string().min(4, 'APP_SHARED_PASSWORD must be at least 4 characters'),
    /**
     * HMAC signing key for session JWTs (src/services/auth/session.ts).
     * 32+ chars so it's a reasonable HS256 key floor. Required — never
     * defaulted. Never logged.
     */
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    /** Session cookie/JWT lifetime. Defaults to 30 days. */
    SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(2592000),
  })
  .superRefine((value, ctx) => {
    if (value.FRONTEND_ORIGIN === '*') {
      ctx.addIssue({
        code: 'custom',
        path: ['FRONTEND_ORIGIN'],
        message: 'Wildcard CORS origin is not allowed',
      });
    }
    if (!isAllowedModel(value.MINDLOGIC_MODEL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MINDLOGIC_MODEL'],
        message: 'MINDLOGIC_MODEL must be one of the allowed models',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Pure parser used by tests and by the eager `env` singleton below.
 * Never include the offending value in error messages — only the field
 * name and a generic reason, so invalid secrets can't leak into logs.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${messages.join('\n')}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);

/**
 * Safe-to-log summary: never includes DATABASE_URL, MINDLOGIC_API_KEY,
 * APP_SHARED_PASSWORD, or SESSION_SECRET.
 */
export function redactedEnvSummary(value: Env = env) {
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    frontendOrigin: value.FRONTEND_ORIGIN,
    mindlogicBaseUrl: value.MINDLOGIC_BASE_URL,
    mindlogicModel: value.MINDLOGIC_MODEL,
    monthlyCreditLimit: value.MINDLOGIC_MONTHLY_CREDIT_LIMIT,
    mindlogicMaxRetries: value.MINDLOGIC_MAX_RETRIES,
    sessionMaxAgeSeconds: value.SESSION_MAX_AGE_SECONDS,
  };
}
