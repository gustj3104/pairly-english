import { describe, expect, it, vi } from 'vitest';
import { CreditService } from '../credits/credit-service.js';
import { InMemoryCreditRepository } from '../../../tests/helpers/in-memory-credit-repository.js';
import { MindlogicClient } from '../mindlogic/client.js';
import { compareReflections } from './reflection-comparison-service.js';
import { compareReflectionsRequestSchema } from './schema.js';

const VALID_REFLECTION =
  'I found this article compelling because it connects Korean cultural investment to genuine artistic ambition, and I appreciated how it grounded the claim in specific examples from film and television.';

const INPUT = compareReflectionsRequestSchema.parse({
  article: { title: 'The Quiet Revolution', summary: 'A summary of the article.' },
  mine: { displayName: 'Alex', reflection: VALID_REFLECTION },
  partner: {
    displayName: 'Sam',
    reflection: `${VALID_REFLECTION} A slightly different take on it.`,
  },
});

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
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildMindlogicClient(fetchImpl: typeof fetch) {
  return new MindlogicClient({
    apiKey: 'test-fake-key',
    baseUrl: 'https://example.com/v1/gateway',
    fetchImpl,
  });
}

function buildCreditService(monthlyLimit = 5000) {
  return new CreditService(new InMemoryCreditRepository(), monthlyLimit);
}

const noopSleep = async () => {};

describe('compareReflections — happy path', () => {
  it('reserves, calls Mindlogic once, and commits actual usage on a valid structured response', async () => {
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
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (outcome.status === 'ok') {
      expect(outcome.result.topics).toHaveLength(3);
    }

    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
    expect(usage.usedCredits).toBeGreaterThan(0);
  });

  it('reserves before calling Mindlogic, and commits only after a successful call (correct order)', async () => {
    const callOrder: string[] = [];
    const creditService = buildCreditService();
    const originalReserve = creditService.reserveCredits.bind(creditService);
    const originalCommit = creditService.commitCredits.bind(creditService);
    vi.spyOn(creditService, 'reserveCredits').mockImplementation(async (input) => {
      callOrder.push('reserve');
      return originalReserve(input);
    });
    vi.spyOn(creditService, 'commitCredits').mockImplementation(async (requestId, credits) => {
      callOrder.push('commit');
      return originalCommit(requestId, credits);
    });

    const fetchImpl = vi.fn().mockImplementation(async () => {
      callOrder.push('mindlogic-call');
      return jsonResponse(200, {
        id: 'chatcmpl-1',
        model: 'claude-haiku-4-5-20251001',
        choices: [
          { message: { role: 'assistant', content: JSON.stringify(validComparisonBody()) } },
        ],
        usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
      });
    });
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('ok');
    expect(callOrder).toEqual(['reserve', 'mindlogic-call', 'commit']);
  });
});

describe('compareReflections — monthly limit', () => {
  it('never calls Mindlogic when the reservation itself is rejected for exceeding the monthly limit', async () => {
    const fetchImpl = vi.fn();
    const creditService = buildCreditService(1); // 1 credit total — any real reservation exceeds it
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('limit_exceeded');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('compareReflections — upstream failure releases the reservation', () => {
  it('releases credits and does not commit anything on a non-retryable upstream failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { message: 'unauthorized' }));
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('upstream_failed');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // unauthorized is never retried

    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
    expect(usage.usedCredits).toBe(0);
  });
});

describe('compareReflections — 402 is never retried and marks the month exhausted', () => {
  it('releases the reservation, marks exhausted, and calls Mindlogic exactly once', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(402, { message: 'insufficient credit' }));
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('provider_exhausted');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
    expect(usage.warningLevel).toBe('exhausted');
    expect(usage.aiFeaturesAvailable).toBe(false);
  });
});

describe('compareReflections — 429/5xx retry policy', () => {
  it('retries a 500 and succeeds on a later attempt, reusing the same reservation (no new reserve call)', async () => {
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      call++;
      if (call < 3) return jsonResponse(500, { message: 'server error' });
      return jsonResponse(200, {
        id: 'chatcmpl-1',
        model: 'claude-haiku-4-5-20251001',
        choices: [
          { message: { role: 'assistant', content: JSON.stringify(validComparisonBody()) } },
        ],
        usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
      });
    });
    const creditService = buildCreditService();
    const reserveSpy = vi.spyOn(creditService, 'reserveCredits');
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 2 failures + 1 success, within MAX_RETRY_ATTEMPTS
    expect(reserveSpy).toHaveBeenCalledTimes(1); // never re-reserved across retries
  });

  it('gives up after the maximum retry attempts and releases the reservation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { message: 'unavailable' }));
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('upstream_failed');
    expect(fetchImpl).toHaveBeenCalledTimes(3); // MAX_RETRY_ATTEMPTS, no more

    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
  });
});

describe('compareReflections — timeout policy', () => {
  it('never retries a timeout and releases the reservation instead of committing an unknown cost', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });
    const creditService = buildCreditService();
    const mindlogicClient = new MindlogicClient({
      apiKey: 'test-fake-key',
      baseUrl: 'https://example.com/v1/gateway',
      fetchImpl,
      timeoutMs: 10,
    });

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('upstream_failed');
    if (outcome.status === 'upstream_failed') {
      expect(outcome.code).toBe('timeout');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry on a timeout — see RETRYABLE_ERROR_CODES

    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
    expect(usage.usedCredits).toBe(0);
  });
});

describe('compareReflections — upstream schema violations', () => {
  it('rejects a response with fewer than 3 discussion topics without committing the full reservation', async () => {
    const body = validComparisonBody();
    body.topics = body.topics.slice(0, 2);
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'chatcmpl-1',
        model: 'claude-haiku-4-5-20251001',
        choices: [{ message: { role: 'assistant', content: JSON.stringify(body) } }],
        usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
      }),
    );
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('upstream_schema_error');
    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
    expect(usage.usedCredits).toBeGreaterThan(0); // actual usage still settled, not silently freed
  });

  it('rejects a response that does not match the schema at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'chatcmpl-1',
        model: 'claude-haiku-4-5-20251001',
        choices: [
          { message: { role: 'assistant', content: JSON.stringify({ unexpected: 'shape' }) } },
        ],
        usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
      }),
    );
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('upstream_schema_error');
  });

  it('rejects content wrapped in Markdown code fences instead of silently stripping them', async () => {
    const fenced = ['```json', JSON.stringify(validComparisonBody()), '```'].join('\n');
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'chatcmpl-1',
        model: 'claude-haiku-4-5-20251001',
        choices: [{ message: { role: 'assistant', content: fenced } }],
        usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
      }),
    );
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('upstream_schema_error');
  });

  it('treats a response with no usage figures as an upstream error and commits the full reservation as the conservative fallback', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'chatcmpl-1',
        model: 'claude-haiku-4-5-20251001',
        choices: [
          { message: { role: 'assistant', content: JSON.stringify(validComparisonBody()) } },
        ],
        // usage intentionally omitted
      }),
    );
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('upstream_schema_error');
    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
    expect(usage.usedCredits).toBeGreaterThan(0);
  });
});

describe('compareReflections — actual usage exceeding the reservation (fail-closed)', () => {
  it('caps the commit at the reserved amount, marks the month exhausted, and never returns the AI result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'chatcmpl-1',
        model: 'claude-haiku-4-5-20251001',
        choices: [
          { message: { role: 'assistant', content: JSON.stringify(validComparisonBody()) } },
        ],
        // Wildly implausible usage, guaranteed to exceed any conservative
        // estimate-based reservation for this small input.
        usage: { prompt_tokens: 100, completion_tokens: 5_000_000, total_tokens: 5_000_100 },
      }),
    );
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('reservation_exceeded');

    const usage = await creditService.getUsageSummary();
    expect(usage.usedCredits).toBe(outcome.accounting.reservedCredits);
    expect(usage.warningLevel).toBe('exhausted');
    expect(usage.aiFeaturesAvailable).toBe(false);
  });
});

describe('compareReflections — reusing a requestId never silently double-charges', () => {
  it('throws rather than silently re-settling credits when a completed requestId is reused', async () => {
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
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);
    const generateRequestId = () => 'fixed-request-id-reused';

    const first = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
      generateRequestId,
    });
    expect(first.status).toBe('ok');

    await expect(
      compareReflections(INPUT, {
        creditService,
        mindlogicClient,
        sleep: noopSleep,
        generateRequestId,
      }),
    ).rejects.toThrow();
  });
});

describe('compareReflections — accounting never carries reflection/article content', () => {
  it('only exposes requestId/feature/model/token/credit fields in accounting', async () => {
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
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    const serialized = JSON.stringify(outcome.accounting);
    expect(serialized).not.toContain('Korean cultural investment');
    expect(serialized).not.toContain('Alex');
    expect(serialized).not.toContain('Sam');
    expect(Object.keys(outcome.accounting).sort()).toEqual(
      [
        'actualCredits',
        'actualInputTokens',
        'actualOutputTokens',
        'estimatedInputTokens',
        'feature',
        'maxOutputTokens',
        'model',
        'reservedCredits',
      ].sort(),
    );
  });
});
