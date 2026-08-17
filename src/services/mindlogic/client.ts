import { EMPTY_ERROR_OBSERVABILITY, MindlogicApiError } from './types.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  MindlogicCreditsResponse,
  MindlogicErrorCode,
  MindlogicErrorObservability,
  MindlogicModel,
  MindlogicModelsResponse,
  MindlogicValidationErrorDetail,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/** Joins a base URL and a path without producing `//` or dropping a segment. */
export function buildMindlogicUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

/**
 * Maps every real received HTTP status to a specific code. Any 4xx not
 * explicitly named still gets a real, received-response code
 * ('client_error') — never 'unknown', which is reserved for genuinely
 * unrecognized network-level failures (see classifyNetworkError below).
 */
function mapStatusToErrorCode(status: number): MindlogicErrorCode {
  if (status === 400) return 'invalid_request';
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'credits_exhausted';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408) return 'request_timeout_response';
  if (status === 409) return 'conflict';
  if (status === 422) return 'validation_error';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status <= 599) return 'provider_error';
  if (status >= 400 && status <= 499) return 'client_error';
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

/** Only ever extracts a short, safe-looking code — never a free-text message. */
const SAFE_SHORT_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/** Header names checked, in order, for a provider-assigned request id. */
const REQUEST_ID_HEADER_CANDIDATES = [
  'x-request-id',
  'x-requestid',
  'request-id',
  'x-mindlogic-request-id',
];

function extractProviderRequestId(headers: Headers): string | null {
  for (const name of REQUEST_ID_HEADER_CANDIDATES) {
    const value = headers.get(name);
    if (value && SAFE_SHORT_CODE_PATTERN.test(value)) return value;
  }
  return null;
}

/**
 * Looks for a short error code under a small allow-list of common field
 * names (`error.code`, `error.type`, `code`, `type`). Never reads or
 * returns a `message` field — messages can be arbitrarily long and may
 * echo request content back.
 */
function extractProviderErrorCode(body: Record<string, unknown>): string | null {
  const nestedError = body.error;
  const candidates: unknown[] = [
    nestedError && typeof nestedError === 'object'
      ? (nestedError as Record<string, unknown>).code
      : undefined,
    nestedError && typeof nestedError === 'object'
      ? (nestedError as Record<string, unknown>).type
      : undefined,
    body.code,
    body.type,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && SAFE_SHORT_CODE_PATTERN.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

const MAX_VALIDATION_ERRORS_CAPTURED = 10;
const MAX_LOC_SEGMENTS_CAPTURED = 10;

/** A `loc` segment is either a short safe field name or a plain finite number (array index). */
function extractLocSegment(segment: unknown): string | number | null {
  if (typeof segment === 'number' && Number.isFinite(segment)) return segment;
  if (typeof segment === 'string' && SAFE_SHORT_CODE_PATTERN.test(segment)) return segment;
  return null;
}

/**
 * Reduces one FastAPI/Pydantic-style validation error entry to only its
 * `type` and `loc` (field path) — deliberately never `msg` (free text,
 * may echo request content), `input` (the actual rejected value), or
 * `ctx` (may embed arbitrary context data).
 */
function extractValidationErrorDetail(entry: unknown): MindlogicValidationErrorDetail {
  if (!entry || typeof entry !== 'object') return { type: null, loc: null };
  const record = entry as Record<string, unknown>;
  const type =
    typeof record.type === 'string' && SAFE_SHORT_CODE_PATTERN.test(record.type)
      ? record.type
      : null;
  const loc = Array.isArray(record.loc)
    ? record.loc
        .slice(0, MAX_LOC_SEGMENTS_CAPTURED)
        .map(extractLocSegment)
        .filter((segment): segment is string | number => segment !== null)
    : null;
  return { type, loc };
}

/**
 * Summarizes a FastAPI/Pydantic-style `detail` field structurally — array
 * vs string, how many validation errors, and each one's type+loc — without
 * ever touching the free-text `msg`, the rejected `input` value, or `ctx`.
 */
function extractDetailSummary(
  body: Record<string, unknown>,
): Pick<MindlogicErrorObservability, 'detailKind' | 'validationErrorCount' | 'validationErrors'> {
  const detail = body.detail;
  if (Array.isArray(detail)) {
    return {
      detailKind: 'array',
      validationErrorCount: detail.length,
      validationErrors: detail
        .slice(0, MAX_VALIDATION_ERRORS_CAPTURED)
        .map(extractValidationErrorDetail),
    };
  }
  if (typeof detail === 'string') {
    return { detailKind: 'string', validationErrorCount: null, validationErrors: null };
  }
  return { detailKind: null, validationErrorCount: null, validationErrors: null };
}

/**
 * Builds safe diagnostic detail for a non-ok response, reading the body
 * exactly once as text so a parse failure never throws here. The raw
 * text itself is never retained — only the derived, allow-listed fields.
 */
async function buildErrorObservability(response: Response): Promise<MindlogicErrorObservability> {
  const contentType = response.headers.get('content-type');
  const providerRequestId = extractProviderRequestId(response.headers);
  let responseTopLevelKeys: string[] | null = null;
  let providerErrorCode: string | null = null;
  let detailSummary: Pick<
    MindlogicErrorObservability,
    'detailKind' | 'validationErrorCount' | 'validationErrors'
  > = {
    detailKind: null,
    validationErrorCount: null,
    validationErrors: null,
  };

  try {
    const text = await response.text();
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      responseTopLevelKeys = Object.keys(record).slice(0, 20);
      providerErrorCode = extractProviderErrorCode(record);
      detailSummary = extractDetailSummary(record);
    }
  } catch {
    // Body wasn't valid JSON, or couldn't be read — leave keys/code null.
    // Never store the raw text.
  }

  return {
    providerErrorCode,
    providerRequestId,
    contentType,
    responseTopLevelKeys,
    ...detailSummary,
  };
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
  ): Promise<{ status: number; data: T; headers: Headers }> {
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
        const observability = await buildErrorObservability(response);
        throw new MindlogicApiError(
          code,
          response.status,
          `Mindlogic request failed with status ${response.status}`,
          observability,
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
        // as a clean failure safe to release. The body stream is already
        // consumed by the failed .json() call, so only header-derived
        // observability is available here.
        throw new MindlogicApiError(
          'incomplete_response',
          response.status,
          'Mindlogic response body was incomplete or malformed',
          {
            ...EMPTY_ERROR_OBSERVABILITY,
            providerRequestId: extractProviderRequestId(response.headers),
            contentType: response.headers.get('content-type'),
          },
        );
      }

      return { status: response.status, data, headers: response.headers };
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

  /**
   * Status- and header-aware variant used only by
   * scripts/mindlogic-contract-check.ts (a one-shot, credit-ledger-backed
   * diagnostic call, not part of any HTTP route). Exposes the same
   * allow-listed provider request id extraction used for error
   * observability, but on the success path, since a diagnostic contract
   * check needs it regardless of outcome. Business code should use
   * createChatCompletion() above.
   */
  async createChatCompletionWithStatus(payload: ChatCompletionRequest): Promise<{
    status: number;
    completion: ChatCompletionResponse;
    providerRequestId: string | null;
  }> {
    const { status, data, headers } = await this.request<ChatCompletionResponse>(
      'chat/completions/',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
    return { status, completion: data, providerRequestId: extractProviderRequestId(headers) };
  }
}
