import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerCors } from '../src/plugins/cors.js';
import Fastify from 'fastify';

const ALLOWED_ORIGIN = 'http://localhost:5173';

describe('CORS', () => {
  it('allows the configured frontend origin', async () => {
    const app = buildApp({ corsOrigin: ALLOWED_ORIGIN, checkDatabaseConnection: async () => true });
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: ALLOWED_ORIGIN },
    });

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    await app.close();
  });

  it('does not allow a different origin', async () => {
    const app = buildApp({ corsOrigin: ALLOWED_ORIGIN, checkDatabaseConnection: async () => true });
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.com' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('rejects wildcard origin configuration outright, in any environment', () => {
    const app = Fastify();
    expect(() => registerCors(app, '*')).toThrow(/[Ww]ildcard/);
  });
});
