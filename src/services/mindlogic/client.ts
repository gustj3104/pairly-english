import { MindlogicApiError } from './types.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  MindlogicCreditsResponse,
  MindlogicErrorCode,
  MindlogicModel,
  MindlogicModelsResponse,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/** Joins a base URL and a path without producing `//` or dropping a segment. */
export function buildMindlogicUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

function mapStatusToErrorCode(status: number): MindlogicErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'payment_required';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Classifies a thrown network-level error (fetch rejected before any HTTP
 * response was received) by inspecting the underlying cause's error code.
 * Only ever returns 'connection_refused' when we recognize a specific,
 * well-known "never connected" signal (DNS failure, refused TCP connect)
 * — everything else defaults to 'unknown', the conservative bucket,
 * rather than guessing. This is deliberately biased toward classifying
 * ambiguous failures as uncertain rather than certain-safe.
 */
function classifyNetworkError(error: unknown): MindlogicErrorCode {
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
  const code = cause?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'connection_refused';
  }
  if (code === 'ECONNRESET') {
    return 'connection_reset';
  }
  return 'unknown';
}

export interface MindlogicClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Thin, typed client over the Mindlogic gateway. Never returns or logs
 * the API key. As of this stage, createChatCompletion's request/response
 * shape is inferred (never exercised against the real endpoint — see
 * scripts/mindlogic-check.ts for the two GET endpoints that have been
 * verified for real).
 */
export class MindlogicClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MindlogicClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; data: T }> {
    const url = buildMindlogicUrl(this.baseUrl, path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const code = mapStatusToErrorCode(response.status);
        throw new MindlogicApiError(
          code,
          response.status,
          `Mindlogic request failed with status ${response.status}`,
        );
      }

      let data: T;
      try {
        data = (await response.json()) as T;
      } catch {
        // The response status/headers arrived — the request definitely
        // reached Mindlogic — but the body was truncated, malformed, or
        // the connection dropped while streaming it. We cannot tell
        // whether generation completed or what it cost; never treat this
        // as a clean failure safe to release.
        throw new MindlogicApiError(
          'incomplete_response',
          response.status,
          'Mindlogic response body was incomplete or malformed',
        );
      }

      return { status: response.status, data };
    } catch (error) {
      if (error instanceof MindlogicApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        // Distinct from a real 5xx: we never received a response, so we
        // cannot tell whether Mindlogic processed (and will bill) this
        // request. See RETRYABLE_ERROR_CODES in types.ts for why this is
        // deliberately excluded from the retry policy.
        throw new MindlogicApiError('timeout', 0, 'Mindlogic request timed out');
      }
      throw new MindlogicApiError(classifyNetworkError(error), 0, 'Mindlogic request failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  async getModels(): Promise<MindlogicModel[]> {
    // Trailing slash matters for this gateway — the bare path (no
    // trailing slash) is a different, undocumented route. The gateway
    // wraps the list in an envelope ({ object, data }), not a bare array.
    const { data } = await this.request<MindlogicModelsResponse>('models/', { method: 'GET' });
    return data.data;
  }

  async getCredits(): Promise<MindlogicCreditsResponse> {
    const { data } = await this.request<MindlogicCreditsResponse>('credits/', { method: 'GET' });
    return data;
  }

  async createChatCompletion(payload: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // Trailing slash for consistency with the confirmed /models/ and
    // /credits/ convention — unverified for this endpoint specifically,
    // since no real chat completion call has been made yet.
    const { data } = await this.request<ChatCompletionResponse>('chat/completions/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data;
  }

  /**
   * Status-aware variant used only by scripts/mindlogic-check.ts (a
   * read-only operational health check, not part of any HTTP route).
   * Business code should use getModels()/getCredits() above.
   */
  async getModelsWithStatus(): Promise<{ status: number; models: MindlogicModel[] }> {
    const { status, data } = await this.request<MindlogicModelsResponse>('models/', {
      method: 'GET',
    });
    return { status, models: data.data };
  }

  async getCreditsWithStatus(): Promise<{ status: number; credits: MindlogicCreditsResponse }> {
    const { status, data } = await this.request<MindlogicCreditsResponse>('credits/', {
      method: 'GET',
    });
    return { status, credits: data };
  }
}
