import { ApiError } from './errors'

const DEFAULT_TIMEOUT_MS = 20_000

/** Best-effort extraction of `{ error: { code, requestId } }` — never throws on a malformed body. */
function readErrorEnvelope(payload: unknown): { code?: string; requestId?: string } {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return {}
  const err = (payload as { error?: unknown }).error
  if (typeof err !== 'object' || err === null) return {}
  const code = 'code' in err && typeof err.code === 'string' ? err.code : undefined
  const requestId = 'requestId' in err && typeof err.requestId === 'string' ? err.requestId : undefined
  return { code, requestId }
}

function mapErrorResponse(status: number, payload: unknown): ApiError {
  const { requestId } = readErrorEnvelope(payload)

  if (status === 401) {
    return new ApiError('unauthorized', '인증이 필요합니다.', { status, requestId })
  }
  if (status === 402) {
    return new ApiError('credit_limit_exceeded', '이번 달 AI 학습 한도를 모두 사용했습니다.', { status, requestId })
  }
  if (status === 409) {
    return new ApiError(
      'reconciliation_pending',
      '이전 요청을 확인하는 중입니다. 잠시 후 다시 시도해 주세요. (다시 제출하지 마세요)',
      { status, requestId },
    )
  }
  if (status === 429) {
    return new ApiError('rate_limited', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', { status, requestId })
  }
  if (status >= 500) {
    return new ApiError('backend_unavailable', '서버에 일시적으로 연결할 수 없습니다.', { status, requestId })
  }
  if (status === 400) {
    return new ApiError('validation', '요청 형식이 올바르지 않습니다.', { status, requestId })
  }
  return new ApiError('unknown', '알 수 없는 오류가 발생했습니다.', { status, requestId })
}

export interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

async function request<TResponse>(
  path: string,
  init: RequestInit,
  options: RequestOptions = {},
): Promise<TResponse> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  let response: Response
  try {
    response = await fetch(path, {
      // Relative path (e.g. "/api/v1/...") — resolved against the current
      // origin, never an absolute backend URL. In dev, Vite's own proxy
      // (see vite.config.ts) forwards it to the backend; in production,
      // the deployment's own rewrite is expected to do the same (see
      // README). `credentials: 'include'` so the HttpOnly session cookie
      // is sent — there is no API key or token for this client to hold.
      credentials: 'include',
      signal: controller.signal,
      ...init,
    })
  } catch {
    throw new ApiError('backend_unavailable', '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.')
  } finally {
    clearTimeout(timeoutId)
  }

  let payload: unknown
  try {
    payload = response.status === 204 ? undefined : await response.json()
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    throw mapErrorResponse(response.status, payload)
  }

  return payload as TResponse
}

export function postJson<TResponse>(
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<TResponse> {
  return request<TResponse>(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    options,
  )
}

export function getJson<TResponse>(path: string, options: RequestOptions = {}): Promise<TResponse> {
  return request<TResponse>(path, { method: 'GET' }, options)
}
