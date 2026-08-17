import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'pairly-english-server',
  }));

  app.get('/ready', async (_request, reply) => {
    const databaseOk = await app.checkDatabaseConnection();
    const checks = {
      env: true,
      database: databaseOk,
    };
    const ready = Object.values(checks).every(Boolean);

    reply.code(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not_ready',
      checks,
    };
  });
}
