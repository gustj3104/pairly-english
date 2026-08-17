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
     * Temporary pre-auth gate for AI routes until real authentication
     * exists. Optional so env parsing itself never requires it — the
     * routes fail closed on their own when it's unset (see
     * src/plugins/dev-ai-gate.ts). Never bundled into the frontend.
     */
    AI_DEV_ACCESS_TOKEN: z.string().min(1).optional(),
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

/** Safe-to-log summary: never includes DATABASE_URL or MINDLOGIC_API_KEY. */
export function redactedEnvSummary(value: Env = env) {
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    frontendOrigin: value.FRONTEND_ORIGIN,
    mindlogicBaseUrl: value.MINDLOGIC_BASE_URL,
    mindlogicModel: value.MINDLOGIC_MODEL,
    monthlyCreditLimit: value.MINDLOGIC_MONTHLY_CREDIT_LIMIT,
  };
}
