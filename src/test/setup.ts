// Runs before every test file. Populates process.env with safe, fake
// values so that `src/config/env.ts` (which parses eagerly on import)
// never throws during the test suite and never touches real secrets.
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '3001';
process.env.HOST ??= '127.0.0.1';
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/pairly_english_test';
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173';
process.env.MINDLOGIC_API_KEY ??= 'test-fake-api-key';
process.env.MINDLOGIC_BASE_URL ??= 'https://factchat-cloud.mindlogic.ai/v1/gateway';
process.env.MINDLOGIC_MODEL ??= 'claude-haiku-4-5-20251001';
process.env.MINDLOGIC_MONTHLY_CREDIT_LIMIT ??= '5000';
process.env.AI_DEV_ACCESS_TOKEN ??= 'test-fake-dev-access-token';
process.env.APP_SHARED_PASSWORD ??= 'test-fake-shared-password';
process.env.SESSION_SECRET ??= 'test-fake-session-secret-at-least-32-characters-long';
process.env.SESSION_MAX_AGE_SECONDS ??= '2592000';
