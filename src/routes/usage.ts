import type { FastifyInstance } from 'fastify';

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/usage', async () => app.creditService.getUsageSummary());
}
