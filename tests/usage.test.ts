import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CreditService } from '../src/services/credits/credit-service.js';
import { InMemoryCreditRepository } from './helpers/in-memory-credit-repository.js';

describe('GET /api/v1/usage', () => {
  it('returns a ledger-derived usage summary without calling Mindlogic', async () => {
    const creditService = new CreditService(new InMemoryCreditRepository(), 5000);
    const app = buildApp({ creditService, checkDatabaseConnection: async () => true });

    const response = await app.inject({ method: 'GET', url: '/api/v1/usage' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toMatchObject({
      billingMonth: expect.stringMatching(/^\d{4}-\d{2}$/),
      usedCredits: 0,
      reservedCredits: 0,
      limitCredits: 5000,
      usagePercent: 0,
      nextResetDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      warningLevel: 'ok',
      aiFeaturesAvailable: true,
    });

    await app.close();
  });

  it('reflects reservations made against the credit service', async () => {
    const repository = new InMemoryCreditRepository();
    const creditService = new CreditService(repository, 10);
    const app = buildApp({ creditService, checkDatabaseConnection: async () => true });

    await creditService.reserveCredits({
      requestId: crypto.randomUUID(),
      feature: 'grammar_feedback',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 9000,
      outputTokens: 0,
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/usage' });
    const body = response.json();
    expect(body.reservedCredits).toBe(9);
    expect(body.warningLevel).toBe('warning90');

    await app.close();
  });
});
