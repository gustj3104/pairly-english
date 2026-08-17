import { getJson, postJson } from './client'
import { ApiError } from './errors'
import { loginResponseSchema, sessionResponseSchema, type LoginResponse, type SessionResponse } from './schemas'

/**
 * The password is sent once, in this request body, and never stored
 * afterward by this module or any caller — no localStorage, no
 * persisted state. The server never returns it either.
 */
export async function login(name: string, password: string): Promise<LoginResponse> {
  try {
    const raw = await postJson<unknown>('/api/v1/auth/login', { name, password })
    const parsed = loginResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new ApiError('invalid_response', '서버 응답 형식이 올바르지 않습니다.')
    }
    return parsed.data
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'unauthorized') {
      throw new ApiError('unauthorized', '이름 또는 비밀번호가 올바르지 않습니다.', {
        status: error.status,
        requestId: error.requestId,
      })
    }
    throw error
  }
}

export async function getSession(): Promise<SessionResponse> {
  const raw = await getJson<unknown>('/api/v1/auth/session')
  const parsed = sessionResponseSchema.safeParse(raw)
  if (!parsed.success) {
    // Fails closed: an unparsable session response is treated as "not logged in".
    return { authenticated: false }
  }
  return parsed.data
}

export async function logout(): Promise<void> {
  await postJson<void>('/api/v1/auth/logout', undefined)
}
