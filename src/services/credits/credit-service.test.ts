import { describe, expect, it } from 'vitest';
import { CreditService, ModelNotAllowedError } from './credit-service.js';
import { InMemoryCreditRepository } from '../../../tests/helpers/in-memory-credit-repository.js';

const NOW = new Date('2026-08-17T03:00:00.000Z'); // 2026-08-17 12:00 KST

function buildService(monthlyLimit = 5000) {
  return new CreditService(new InMemoryCreditRepository(), monthlyLimit);
}

describe('CreditService.reserveCredits', () => {
  it('rejects a model the client did not (and cannot) choose from the server allow-list', async () => {
    const service = buildService();
    await expect(
      service.reserveCredits({
        requestId: crypto.randomUUID(),
        feature: 'grammar_feedback',
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 100,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ModelNotAllowedError);
  });

  it('reserves credits when comfortably within the monthly limit', async () => {
    const service = buildService(5000);
    const result = await service.reserveCredits({
      requestId: crypto.randomUUID(),
      feature: 'grammar_feedback',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a reservation that would push committed + reserved over the monthly limit', async () => {
    const service = buildService(10);
    // First reservation uses up all 10 credits worth of capacity.
    const first = await service.reserveCredits({
      requestId: crypto.randomUUID(),
      feature: 'grammar_feedback',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 10_000, // 10 credits
      outputTokens: 0,
      now: NOW,
    });
    expect(first.ok).toBe(true);

    const second = await service.reserveCredits({
      requestId: crypto.randomUUID(),
      feature: 'grammar_feedback',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000, // 1 more credit -> would exceed the limit
      outputTokens: 0,
      now: NOW,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('limit_exceeded');
    }
  });

  it('does not double-reserve when the same requestId is submitted twice', async () => {
    const service = buildService(5000);
    const requestId = crypto.randomUUID();
    const input = {
      requestId,
      feature: 'grammar_feedback' as const,
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
      now: NOW,
    };

    const first = await service.reserveCredits(input);
    const second = await service.reserveCredits(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.record.requestId).toBe(first.record.requestId);
      expect(second.idempotentReplay).toBe(true);
    }

    const usage = await service.getUsageSummary(NOW);
    // Only one reservation should have been counted, not two.
    expect(usage.reservedCredits).toBe(first.ok ? first.record.creditsReserved : -1);
  });
});

describe('CreditService usage lifecycle', () => {
  it('moves credits from reserved to committed on commitCredits', async () => {
    const service = buildService(5000);
    const requestId = crypto.randomUUID();
    const reserved = await service.reserveCredits({
      requestId,
      feature: 'grammar_feedback',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
      now: NOW,
    });
    expect(reserved.ok).toBe(true);

    await service.commitCredits(requestId, 6);

    const usage = await service.getUsageSummary(NOW);
    expect(usage.usedCredits).toBe(6);
    expect(usage.reservedCredits).toBe(0);
  });

  it('releases reserved credits back without committing them', async () => {
    const service = buildService(5000);
    const requestId = crypto.randomUUID();
    await service.reserveCredits({
      requestId,
      feature: 'grammar_feedback',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
      now: NOW,
    });

    await service.releaseCredits(requestId, 'upstream_failure');

    const usage = await service.getUsageSummary(NOW);
    expect(usage.usedCredits).toBe(0);
    expect(usage.reservedCredits).toBe(0);
  });

  it('reports warning levels and next reset date from getUsageSummary', async () => {
    const service = buildService(5000);
    const usage = await service.getUsageSummary(NOW);
    expect(usage.limitCredits).toBe(5000);
    expect(usage.warningLevel).toBe('ok');
    expect(usage.nextResetDate).toBe('2026-09-01');
    expect(usage.aiFeaturesAvailable).toBe(true);
  });

  it('marks a billing month exhausted and reflects it in the usage summary', async () => {
    const service = buildService(5000);
    await service.markExhausted('2026-08');
    const usage = await service.getUsageSummary(NOW);
    expect(usage.warningLevel).toBe('exhausted');
    expect(usage.aiFeaturesAvailable).toBe(false);
  });

  it('rejects committing a request that was already committed', async () => {
    const service = buildService(5000);
    const requestId = crypto.randomUUID();
    await service.reserveCredits({
      requestId,
      feature: 'grammar_feedback',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
      now: NOW,
    });
    await service.commitCredits(requestId, 5);

    await expect(service.commitCredits(requestId, 5)).rejects.toThrow();
  });

  it('rejects releasing a request that was already released', async () => {
    const service = buildService(5000);
    const requestId = crypto.randomUUID();
    await service.reserveCredits({
      requestId,
      feature: 'grammar_feedback',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
      now: NOW,
    });
    await service.releaseCredits(requestId, 'upstream_failure');

    await expect(service.releaseCredits(requestId, 'upstream_failure')).rejects.toThrow();
  });

  it('rejects releasing a request that was already committed', async () => {
    const service = buildService(5000);
    const requestId = crypto.randomUUID();
    await service.reserveCredits({
      requestId,
      feature: 'grammar_feedback',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 1000,
      now: NOW,
    });
    await service.commitCredits(requestId, 5);

    await expect(service.releaseCredits(requestId, 'too_late')).rejects.toThrow();
  });
});
