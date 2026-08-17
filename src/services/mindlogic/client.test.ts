import { describe, expect, it, vi } from 'vitest';
import { buildMindlogicUrl, MindlogicClient } from './client.js';
import { MindlogicApiError } from './types.js';

const FAKE_KEY = 'sk-super-secret-mindlogic-key-do-not-leak';

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('buildMindlogicUrl', () => {
  it('joins a base with no trailing slash and a path with no leading slash', () => {
    expect(buildMindlogicUrl('https://example.com/v1', 'models')).toBe(
      'https://example.com/v1/models',
    );
  });

  it('does not produce a double slash when both sides have one', () => {
    expect(buildMindlogicUrl('https://example.com/v1/', '/models')).toBe(
      'https://example.com/v1/models',
    );
  });

  it('does not drop the path when the base has multiple trailing slashes', () => {
    expect(buildMindlogicUrl('https://example.com/v1///', '///models')).toBe(
      'https://example.com/v1/models',
    );
  });
});

describe('MindlogicClient error mapping', () => {
  const cases: { status: number; code: string }[] = [
    { status: 400, code: 'invalid_request' },
    { status: 401, code: 'unauthorized' },
    { status: 402, code: 'credits_exhausted' },
    { status: 403, code: 'forbidden' },
    { status: 404, code: 'not_found' },
    { status: 408, code: 'request_timeout_response' },
    { status: 409, code: 'conflict' },
    { status: 422, code: 'validation_error' },
    { status: 429, code: 'rate_limited' },
    { status: 500, code: 'provider_error' },
    { status: 503, code: 'provider_error' },
    { status: 599, code: 'provider_error' },
    { status: 418, code: 'client_error' },
  ];

  for (const { status, code } of cases) {
    it(`maps HTTP ${status} to '${code}'`, async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { message: 'boom' }));
      const client = new MindlogicClient({
        apiKey: FAKE_KEY,
        baseUrl: 'https://example.com/v1',
        fetchImpl,
      });

      await expect(client.getModels()).rejects.toMatchObject({ code, status });
    });
  }

  it('sends the Authorization header but never returns or throws the key itself', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500));
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    let caught: unknown;
    try {
      await client.getModels();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MindlogicApiError);
    const serialized = JSON.stringify(caught, Object.getOwnPropertyNames(caught));
    expect(serialized).not.toContain(FAKE_KEY);
    expect((caught as Error).message).not.toContain(FAKE_KEY);

    const sentHeaders = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBe(`Bearer ${FAKE_KEY}`);
  });

  it('unwraps the { object, data } envelope on a successful models response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { object: 'list', data: [{ id: 'claude-haiku-4-5-20251001' }] }),
      );
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    await expect(client.getModels()).resolves.toEqual([{ id: 'claude-haiku-4-5-20251001' }]);
  });

  it("maps a timed-out request to code 'timeout', distinct from a real provider_error", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
      timeoutMs: 10,
    });

    await expect(client.getModels()).rejects.toMatchObject({ code: 'timeout' });
  });

  it("maps a connection-refused failure to 'connection_refused' (certain the request was never sent)", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
        code: 'ECONNREFUSED',
      });
      return Promise.reject(new Error('fetch failed', { cause }));
    });
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    await expect(client.getModels()).rejects.toMatchObject({ code: 'connection_refused' });
  });

  it("maps a DNS resolution failure to 'connection_refused' too", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const cause = Object.assign(new Error('getaddrinfo ENOTFOUND example.invalid'), {
        code: 'ENOTFOUND',
      });
      return Promise.reject(new Error('fetch failed', { cause }));
    });
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    await expect(client.getModels()).rejects.toMatchObject({ code: 'connection_refused' });
  });

  it("maps a connection reset to 'connection_reset' (uncertain — may have been mid-request)", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return Promise.reject(new Error('fetch failed', { cause }));
    });
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    await expect(client.getModels()).rejects.toMatchObject({ code: 'connection_reset' });
  });

  it("maps an unrecognized network failure to 'unknown' rather than guessing it's safe", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('something unexpected happened'));
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    await expect(client.getModels()).rejects.toMatchObject({ code: 'unknown' });
  });

  it("maps a response whose body fails to parse to 'incomplete_response' — status/headers arrived, so the request definitely reached Mindlogic", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"truncated": tr', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    await expect(client.getModels()).rejects.toMatchObject({
      code: 'incomplete_response',
      status: 200,
    });
  });
});

describe('MindlogicClient error observability', () => {
  it('extracts an allow-listed provider error code, request id header, content-type, and top-level keys', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'invalid_api_key', message: 'do not store this part' } }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'req_abc123',
          },
        },
      ),
    );
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    let caught: unknown;
    try {
      await client.getModels();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MindlogicApiError);
    const observability = (caught as MindlogicApiError).observability;
    expect(observability.providerErrorCode).toBe('invalid_api_key');
    expect(observability.providerRequestId).toBe('req_abc123');
    expect(observability.contentType).toBe('application/json');
    expect(observability.responseTopLevelKeys).toEqual(['error']);
  });

  it('never surfaces a free-text message field as the provider error code', async () => {
    const longMessage =
      'This is a long free-text error message that must never be stored verbatim, even if it reflects request content.';
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { message: longMessage, code: undefined }));
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    let caught: unknown;
    try {
      await client.getModels();
    } catch (error) {
      caught = error;
    }

    const observability = (caught as MindlogicApiError).observability;
    expect(observability.providerErrorCode).toBeNull();
    const serialized = JSON.stringify(observability);
    expect(serialized).not.toContain(longMessage);
  });

  it('ignores a request-id header value that does not look like a short safe code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'a'.repeat(200),
        },
      }),
    );
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    let caught: unknown;
    try {
      await client.getModels();
    } catch (error) {
      caught = error;
    }

    expect((caught as MindlogicApiError).observability.providerRequestId).toBeNull();
  });

  it('leaves observability fields null when the error body is not valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('not json at all', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    let caught: unknown;
    try {
      await client.getModels();
    } catch (error) {
      caught = error;
    }

    const observability = (caught as MindlogicApiError).observability;
    expect(observability.providerErrorCode).toBeNull();
    expect(observability.responseTopLevelKeys).toBeNull();
    expect(observability.contentType).toBe('text/plain');
  });

  it('extracts provider request id headers from the incomplete_response path (body already consumed)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"truncated": tr', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'req_partial1',
        },
      }),
    );
    const client = new MindlogicClient({
      apiKey: FAKE_KEY,
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    });

    let caught: unknown;
    try {
      await client.getModels();
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'incomplete_response' });
    const observability = (caught as MindlogicApiError).observability;
    expect(observability.providerRequestId).toBe('req_partial1');
    expect(observability.contentType).toBe('application/json');
    expect(observability.responseTopLevelKeys).toBeNull();
    expect(observability.providerErrorCode).toBeNull();
  });
});
