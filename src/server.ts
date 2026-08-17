import { buildApp } from './app.js';
import { env, redactedEnvSummary } from './config/env.js';

async function start(): Promise<void> {
  const app = buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(redactedEnvSummary(), 'pairly-english-server started');
  } catch (error) {
    app.log.error(error, 'failed to start server');
    process.exit(1);
  }
}

void start();
