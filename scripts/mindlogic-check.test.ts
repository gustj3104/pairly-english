import { describe, expect, it, vi } from 'vitest';
import { MindlogicClient } from '../src/services/mindlogic/client.js';
import { MindlogicApiError } from '../src/services/mindlogic/types.js';
import { runMindlogicCheck } from './mindlogic-check.js';

const FAKE_KEY = 'sk-test-fake-key-do-not-leak';
const BASE_URL = 'https://example.com/v1/gateway';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function modelsBody(ids: string[]) {
  return {
    object: 'list',
    data: ids.map((id) => ({
      id,
      object: 'model',
      created: 0,
      owned_by: 'mindlogic',
      type: 'chat',
    })),
  };
}

function creditsBody(overrides: { quota?: number; used?: number; remaining?: number } = {}) {
  const quota = overrides.quota ?? 5000;
  const used = overrides.used ?? 0;
  const remaining = overrides.remaining ?? quota - used;
  return {
    object: 'credits',
    monthly_allocated: { quota, used, remaining, renewal_date: '2026-09-01T00:00:00+09:00' },
    purchased: { quota: 0, used: 0, remaining: 0 },
    total: { quota, used, remaining },
  };
}

function buildFetchMock(
  models: ReturnType<typeof modelsBody>,
  credits: ReturnType<typeof creditsBody>,
) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/models/')) return jsonResponse(200, models);
    if (url.endsWith('/credits/')) return jsonResponse(200, credits);
    throw new Error(`unexpected url in test: ${url}`);
  });
}

describe('runMindlogicCheck', () => {
  it('performs exactly two GET requests — /models/ and /credits/ — never a POST', async () => {
    const fetchImpl = buildFetchMock(modelsBody(['claude-haiku-4-5-20251001']), creditsBody());
    const client = new MindlogicClient({ apiKey: FAKE_KEY, baseUrl: BASE_URL, fetchImpl });

    await runMindlogicCheck(client, 'claude-haiku-4-5-20251001', 5000);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const calledUrls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(calledUrls).toEqual([`${BASE_URL}/models/`, `${BASE_URL}/credits/`]);
    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.method).toBe('GET');
    }
  });

  it('reports the configured model as available when present in the models list', async () => {
    const fetchImpl = buildFetchMock(
      modelsBody(['claude-haiku-4-5-20251001', 'some-other-model']),
      creditsBody(),
    );
    const client = new MindlogicClient({ apiKey: FAKE_KEY, baseUrl: BASE_URL, fetchImpl });

    const result = await runMindlogicCheck(client, 'claude-haiku-4-5-20251001', 5000);

    expect(result.models.status).toBe(200);
    expect(result.models.modelCount).toBe(2);
    expect(result.models.configuredModelAvailable).toBe(true);
    expect(result.models.relevantModelIds).toContain('claude-haiku-4-5-20251001');
  });

  it('reports the configured model as unavailable when absent from the models list', async () => {
    const fetchImpl = buildFetchMock(modelsBody(['some-other-model']), creditsBody());
    const client = new MindlogicClient({ apiKey: FAKE_KEY, baseUrl: BASE_URL, fetchImpl });

    const result = await runMindlogicCheck(client, 'claude-haiku-4-5-20251001', 5000);

    expect(result.models.configuredModelAvailable).toBe(false);
  });

  it('flags a quota mismatch instead of silently accepting it', async () => {
    const fetchImpl = buildFetchMock(
      modelsBody(['claude-haiku-4-5-20251001']),
      creditsBody({ quota: 8000 }),
    );
    const client = new MindlogicClient({ apiKey: FAKE_KEY, baseUrl: BASE_URL, fetchImpl });

    const result = await runMindlogicCheck(client, 'claude-haiku-4-5-20251001', 5000);

    expect(result.credits.quotaMatchesConfiguredLimit).toBe(false);
    expect(result.credits.monthlyAllocated.quota).toBe(8000);
    expect(result.credits.configuredMonthlyLimit).toBe(5000);
  });

  it('confirms quota matches when configured limit and reported quota agree', async () => {
    const fetchImpl = buildFetchMock(
      modelsBody(['claude-haiku-4-5-20251001']),
      creditsBody({ quota: 5000 }),
    );
    const client = new MindlogicClient({ apiKey: FAKE_KEY, baseUrl: BASE_URL, fetchImpl });

    const result = await runMindlogicCheck(client, 'claude-haiku-4-5-20251001', 5000);

    expect(result.credits.quotaMatchesConfiguredLimit).toBe(true);
  });

  it('surfaces a models failure as a typed MindlogicApiError, not a raw fetch error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { message: 'unauthorized' }));
    const client = new MindlogicClient({ apiKey: FAKE_KEY, baseUrl: BASE_URL, fetchImpl });

    await expect(
      runMindlogicCheck(client, 'claude-haiku-4-5-20251001', 5000),
    ).rejects.toBeInstanceOf(MindlogicApiError);
  });

  it('never includes the API key anywhere in the returned summary', async () => {
    const fetchImpl = buildFetchMock(modelsBody(['claude-haiku-4-5-20251001']), creditsBody());
    const client = new MindlogicClient({ apiKey: FAKE_KEY, baseUrl: BASE_URL, fetchImpl });

    const result = await runMindlogicCheck(client, 'claude-haiku-4-5-20251001', 5000);

    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);

    // The key is sent to the (mocked) API, as expected — just never in the summary.
    const sentHeaders = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    expect(sentHeaders?.Authorization).toBe(`Bearer ${FAKE_KEY}`);
  });
});
