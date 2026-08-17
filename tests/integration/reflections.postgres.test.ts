import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startTestDatabase,
  stopTestDatabase,
  truncateCreditTables,
  type TestDatabase,
} from './helpers/postgres-container.js';
import { buildApp } from '../../src/app.js';
import { CreditService } from '../../src/services/credits/credit-service.js';
import { DrizzleCreditRepository } from '../../src/services/credits/credit-repository.js';
import { MindlogicClient } from '../../src/services/mindlogic/client.js';

/**
 * Combines a real, throwaway PostgreSQL instance (Testcontainers) with a
 * mocked Mindlogic HTTP layer to exercise the full reflection-comparison
 * route — real reserve/commit/release transactions, fake AI responses.
 * Never connects to a developer's local/remote database and never calls
 * the real Mindlogic API.
 */

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, 180_000);

afterAll(async () => {
  if (testDb) await stopTestDatabase(testDb);
}, 60_000);

beforeEach(async () => {
  await truncateCreditTables(testDb.pool);
});

const DEV_TOKEN = 'integration-dev-token';
const VALID_REFLECTION =
  'I found this article compelling because it connects Korean cultural investment to genuine artistic ambition, and I appreciated how it grounded the claim in specific examples from film and television.';

const VALID_BODY = {
  article: { title: 'The Quiet Revolution', summary: 'A summary of the article.' },
  mine: { displayName: 'Alex', reflection: VALID_REFLECTION },
  partner: { displayName: 'Sam', reflection: `${VALID_REFLECTION} A slightly different take.` },
};

function validComparisonBody() {
  return {
    commonGround: [{ point: 'p', mine: 'm', partner: 'pt' }],
    differences: [
      { topic: 't', mine: { stance: 's1', quote: 'q1' }, partner: { stance: 's2', quote: 'q2' } },
    ],
    topics: [
      { question: 'q1?', reason: 'r1', difficulty: 'Intermediate' },
      { question: 'q2?', reason: 'r2', difficulty: 'Advanced' },
      { question: 'q3?', reason: 'r3', difficulty: 'Intermediate' },
    ],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildRealCreditService(monthlyLimit = 5000) {
  return new CreditService(new DrizzleCreditRepository(testDb.db), monthlyLimit);
}

describe('POST /api/v1/reflections/compare — real PostgreSQL + mocked Mindlogic HTTP', () => {
  it('reserves and commits real credit rows in PostgreSQL on a successful comparison', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'chatcmpl-1',
        model: 'claude-haiku-4-5-20251001',
        choices: [
          { message: { role: 'assistant', content: JSON.stringify(validComparisonBody()) } },
        ],
        usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
      }),
    );
    const mindlogicClient = new MindlogicClient({
      apiKey: 'test-fake-key',
      baseUrl: 'https://example.com/v1/gateway',
      fetchImpl,
    });
    const creditService = buildRealCreditService();
    const app = buildApp({
      checkDatabaseConnection: async () => true,
      creditService,
      mindlogicClient,
      devAiGateOptions: { nodeEnv: 'development', devAccessToken: DEV_TOKEN },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.topics).toHaveLength(3);

    // Verify against the real PostgreSQL-backed ledger, not a fake.
    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
    expect(usage.usedCredits).toBeGreaterThan(0);

    await app.close();
  });

  it('releases the real reservation in PostgreSQL when Mindlogic returns a non-retryable error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { message: 'unauthorized' }));
    const mindlogicClient = new MindlogicClient({
      apiKey: 'test-fake-key',
      baseUrl: 'https://example.com/v1/gateway',
      fetchImpl,
    });
    const creditService = buildRealCreditService();
    const app = buildApp({
      checkDatabaseConnection: async () => true,
      creditService,
      mindlogicClient,
      devAiGateOptions: { nodeEnv: 'development', devAccessToken: DEV_TOKEN },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(502);

    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
    expect(usage.usedCredits).toBe(0);

    await app.close();
  });

  it('never calls Mindlogic once the real PostgreSQL ledger reports the month exhausted', async () => {
    let mindlogicCalled = false;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      mindlogicCalled = true;
      return jsonResponse(200, { id: 'x', model: 'x', choices: [] });
    });
    const mindlogicClient = new MindlogicClient({
      apiKey: 'test-fake-key',
      baseUrl: 'https://example.com/v1/gateway',
      fetchImpl,
    });
    const creditService = buildRealCreditService(1); // effectively no budget for a real reservation
    const app = buildApp({
      checkDatabaseConnection: async () => true,
      creditService,
      mindlogicClient,
      devAiGateOptions: { nodeEnv: 'development', devAccessToken: DEV_TOKEN },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reflections/compare',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(402);
    expect(mindlogicCalled).toBe(false);

    await app.close();
  });
});
