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

export interface MindlogicClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Thin, typed skeleton over the Mindlogic gateway. No generative call is
 * ever triggered by this stage of the project — routes do not call
 * createChatCompletion yet. Never returns or logs the API key.
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

      return { status: response.status, data: (await response.json()) as T };
    } catch (error) {
      if (error instanceof MindlogicApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MindlogicApiError('server_error', 504, 'Mindlogic request timed out');
      }
      throw new MindlogicApiError('unknown', 0, 'Mindlogic request failed');
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
    const { data } = await this.request<ChatCompletionResponse>('/chat/completions', {
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
