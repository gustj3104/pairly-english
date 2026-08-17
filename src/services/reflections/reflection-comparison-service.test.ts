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

describe('compareReflections — uncertain billing status is held, not released', () => {
  function rejectingFetch(code: string, message: string) {
    return vi.fn().mockImplementation(() => {
      const cause = Object.assign(new Error(message), { code });
      return Promise.reject(new Error('fetch failed', { cause }));
    });
  }

  it('never retries a timeout and holds the reservation as reconciliation_pending (does not release it)', async () => {
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

    expect(outcome.status).toBe('reconciliation_pending');
    if (outcome.status === 'reconciliation_pending') {
      expect(outcome.code).toBe('timeout');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry on a timeout — see RETRYABLE_ERROR_CODES

    // The reservation must NOT be released — it keeps counting against
    // the monthly budget until an operator reconciles it.
    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBeGreaterThan(0);
    expect(usage.reservedCredits).toBe(outcome.accounting.reservedCredits);
    expect(usage.usedCredits).toBe(0);
  });

  it('holds the reservation as reconciliation_pending on a connection reset', async () => {
    const fetchImpl = rejectingFetch('ECONNRESET', 'socket hang up');
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('reconciliation_pending');
    if (outcome.status === 'reconciliation_pending') {
      expect(outcome.code).toBe('connection_reset');
    }
    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBeGreaterThan(0);
  });

  it('holds the reservation as reconciliation_pending when the response body is cut off mid-stream', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"choices": [truncated', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('reconciliation_pending');
    if (outcome.status === 'reconciliation_pending') {
      expect(outcome.code).toBe('incomplete_response');
    }
    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBeGreaterThan(0);
  });

  it('safely releases (does not hold pending) when the connection was certainly refused — the request never reached Mindlogic', async () => {
    const fetchImpl = rejectingFetch('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:1');
    const creditService = buildCreditService();
    const mindlogicClient = buildMindlogicClient(fetchImpl);

    const outcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('upstream_failed');
    if (outcome.status === 'upstream_failed') {
      expect(outcome.code).toBe('connection_refused');
    }
    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
    expect(usage.usedCredits).toBe(0);
  });

  it('blocks a same-requestId retry while a reservation is pending — never calls Mindlogic again for it', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('aborted');
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
    const generateRequestId = () => 'fixed-request-id-pending';

    const first = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
      generateRequestId,
    });
    expect(first.status).toBe('reconciliation_pending');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const second = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
      generateRequestId,
    });

    expect(second.status).toBe('reconciliation_pending');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // still 1 — the retry never reached Mindlogic
  });

  it('keeps a pending reservation counting against the monthly budget for new reservations', async () => {
    const monthlyLimit = 5000;
    const fetchImpl = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });
    const repository = new InMemoryCreditRepository();
    const creditService = new CreditService(repository, monthlyLimit);
    const mindlogicClient = new MindlogicClient({
      apiKey: 'test-fake-key',
      baseUrl: 'https://example.com/v1/gateway',
      fetchImpl,
      timeoutMs: 10,
    });

    const pendingOutcome = await compareReflections(INPUT, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });
    expect(pendingOutcome.status).toBe('reconciliation_pending');
    const pendingReserved = pendingOutcome.accounting.reservedCredits ?? 0;
    expect(pendingReserved).toBeGreaterThan(0);

    // The pending reservation must still be reflected as reserved budget
    // — not silently dropped.
    const usageBefore = await creditService.getUsageSummary();
    expect(usageBefore.reservedCredits).toBe(pendingReserved);
    expect(usageBefore.remainingCredits).toBe(monthlyLimit - pendingReserved);

    // A second CreditService sharing the same underlying repository, with
    // a limit equal to exactly the pending amount, has zero headroom left
    // — proving the pending reservation is still counted against a fresh
    // reservation attempt, not silently ignored.
    const constrainedService = new CreditService(repository, pendingReserved);
    const secondReservation = await constrainedService.reserveCredits({
      requestId: crypto.randomUUID(),
      feature: 'reflection_comparison',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 100,
      outputTokens: 100,
    });
    expect(secondReservation.ok).toBe(false);
  });
});

describe('CreditService reconciliation transitions', () => {
  it('moves a pending reservation to completed via reconcileCommit', async () => {
    const creditService = buildCreditService();
    const requestId = crypto.randomUUID();
    await creditService.reserveCredits({
      requestId,
      feature: 'reflection_comparison',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
    });
    await creditService.markReconciliationPending(requestId, 'timeout');

    await creditService.reconcileCommit(requestId, 5);

    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
    expect(usage.usedCredits).toBe(5);
  });

  it('moves a pending reservation to released via reconcileRelease', async () => {
    const creditService = buildCreditService();
    const requestId = crypto.randomUUID();
    await creditService.reserveCredits({
      requestId,
      feature: 'reflection_comparison',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
    });
    await creditService.markReconciliationPending(requestId, 'connection_reset');

    await creditService.reconcileRelease(requestId);

    const usage = await creditService.getUsageSummary();
    expect(usage.reservedCredits).toBe(0);
    expect(usage.usedCredits).toBe(0);
  });

  it('rejects reconcileCommit/reconcileRelease on a record that was never marked pending', async () => {
    const creditService = buildCreditService();
    const requestId = crypto.randomUUID();
    await creditService.reserveCredits({
      requestId,
      feature: 'reflection_comparison',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
    });

    await expect(creditService.reconcileCommit(requestId, 5)).rejects.toThrow();
    await expect(creditService.reconcileRelease(requestId)).rejects.toThrow();
  });

  it('rejects ordinary commitCredits/releaseCredits on a pending record — only reconcile* may resolve it', async () => {
    const creditService = buildCreditService();
    const requestId = crypto.randomUUID();
    await creditService.reserveCredits({
      requestId,
      feature: 'reflection_comparison',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
    });
    await creditService.markReconciliationPending(requestId, 'timeout');

    await expect(creditService.commitCredits(requestId, 5)).rejects.toThrow();
    await expect(creditService.releaseCredits(requestId)).rejects.toThrow();
  });

  it('rejects marking an already-settled record as pending', async () => {
    const creditService = buildCreditService();
    const requestId = crypto.randomUUID();
    await creditService.reserveCredits({
      requestId,
      feature: 'reflection_comparison',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
    });
    await creditService.commitCredits(requestId, 5);

    await expect(creditService.markReconciliationPending(requestId, 'timeout')).rejects.toThrow();
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

describe('compareReflections — token reservation sizing for non-ASCII input', () => {
  it('reserves a sane, bounded amount for Korean names, title, and reflections', async () => {
    const koreanInput = compareReflectionsRequestSchema.parse({
      article: {
        title: '한류의 조용한 혁명: K-컬처가 할리우드를 다시 쓰는 방법',
        summary:
          '한국의 문화 수출은 글로벌 엔터테인먼트가 한 방향으로만 흐른다는 가정을 조용히 무너뜨렸다.',
      },
      mine: {
        displayName: '현지',
        reflection:
          '이 기사가 정말 흥미로웠던 이유는 한국의 문화적 부상을 1997년 위기 이후의 의도적인 정부 투자와 연결시켰기 때문이다. 그 전략이 얼마나 체계적이었는지 미처 생각해보지 못했다. 다른 나라들도 이 방식을 따라할 수 있을지 궁금하다.',
      },
      partner: {
        displayName: '지수',
        reflection:
          '내 생각은 조금 더 회의적이었다. 미학적 세탁이라는 개념이 계속 머릿속에 남았다. 할리우드는 한국 영화의 시각적 스타일만 가져가고 그 안에 담긴 사회적 비판은 다루지 않을 수 있다고 생각한다. 기생충은 한국 특유의 불평등에 대한 불안을 다뤘기 때문에 성공했다.',
      },
    });
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

    const outcome = await compareReflections(koreanInput, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('ok');
    const reserved = outcome.accounting.reservedCredits ?? 0;
    expect(reserved).toBeGreaterThan(0);
    // Sane upper bound: even generous Korean input should reserve a small
    // fraction of the 5,000 monthly cap, never anywhere close to it.
    expect(reserved).toBeLessThan(200);
  });

  it('reserves a sane, bounded amount for emoji and mixed-script (multilingual) input', async () => {
    const multilingualInput = compareReflectionsRequestSchema.parse({
      article: {
        title: 'K-culture 🌏 goes global 🎬🎉',
        summary: 'A mixed-script summary — 한글 + English + emoji 😀.',
      },
      mine: {
        displayName: 'Hyun 🙂',
        reflection: `${VALID_REFLECTION} 정말 흥미로웠어요! 🎉🎬 This mixes English, 한국어, and emoji 😀🔥✨ throughout.`,
      },
      partner: {
        displayName: '지수 🌟',
        reflection: `${VALID_REFLECTION} 조금 다르게 생각했어요 🤔. Emoji-heavy reflection with mixed scripts 🎭📚✍️.`,
      },
    });
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

    const outcome = await compareReflections(multilingualInput, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('ok');
    const reserved = outcome.accounting.reservedCredits ?? 0;
    expect(reserved).toBeGreaterThan(0);
    expect(reserved).toBeLessThan(200);
  });

  it('never lets a maximum-length request (any script) push the reservation anywhere near the monthly cap', async () => {
    // Worst realistic case: maximum-length reflections in Korean (3
    // bytes/char, 1 UTF-16 unit each — the densest byte-per-length-unit
    // combination the schema's length limit allows).
    const maxReflection = '가'.repeat(6000); // REFLECTION_MAX_LENGTH
    const maxInput = compareReflectionsRequestSchema.parse({
      article: { title: '가'.repeat(300), summary: '가'.repeat(2000) },
      mine: { displayName: '가'.repeat(80), reflection: maxReflection },
      partner: { displayName: '가'.repeat(80), reflection: maxReflection },
    });
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

    const outcome = await compareReflections(maxInput, {
      creditService,
      mindlogicClient,
      sleep: noopSleep,
    });

    expect(outcome.status).toBe('ok');
    const reserved = outcome.accounting.reservedCredits ?? 0;
    // Even the worst case must stay well under 5,000 — a single request
    // must never come close to exhausting the whole monthly budget.
    expect(reserved).toBeLessThan(500);
  });
});
