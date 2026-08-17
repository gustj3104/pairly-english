import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  it('reports ok without touching the database or Mindlogic', async () => {
    const app = buildApp({ checkDatabaseConnection: async () => false });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'pairly-english-server' });
    await app.close();
  });
});

describe('GET /ready', () => {
  it('returns 200 and ready when the database check succeeds', async () => {
    const app = buildApp({ checkDatabaseConnection: async () => true });
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', checks: { env: true, database: true } });
    await app.close();
  });

  it('returns 503 and not_ready when the database check fails', async () => {
    const app = buildApp({ checkDatabaseConnection: async () => false });
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'not_ready',
      checks: { env: true, database: false },
    });
    await app.close();
  });
});
