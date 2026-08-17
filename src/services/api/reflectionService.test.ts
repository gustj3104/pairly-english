import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareReflections } from './reflectionService'
import { ApiError } from './errors'
import type { CompareReflectionsRequest } from './schemas'

const VALID_REQUEST: CompareReflectionsRequest = {
  article: { title: 'The Quiet Revolution', summary: 'A summary.' },
  mine: { displayName: 'Alex', reflection: 'x'.repeat(60) },
  partner: { displayName: 'Sam', reflection: 'y'.repeat(60) },
}

function validResponseBody() {
  return {
    requestId: 'req-1',
    commonGround: [{ point: 'p', mine: 'm', partner: 'pt' }],
    differences: [
      { topic: 't', mine: { stance: 's1', quote: 'q1' }, partner: { stance: 's2', quote: 'q2' } },
    ],
    topics: [
      { question: 'q1?', reason: 'r1', difficulty: 'Intermediate' },
      { question: 'q2?', reason: 'r2', difficulty: 'Advanced' },
      { question: 'q3?', reason: 'r3', difficulty: 'Intermediate' },
    ],
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reflectionService.compareReflections', () => {
  it('sends the exact server-shaped request body, with no Authorization header', async () => {
    const fetchSpy = vi.fn(async (_input: string, _init: RequestInit) => jsonResponse(200, validResponseBody()))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await compareReflections(VALID_REQUEST)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/reflections/compare')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(VALID_REQUEST)
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()

    expect(result.requestId).toBe('req-1')
    expect(result.topics).toHaveLength(3)
  })

  it.each([
    [402, 'credit_limit_exceeded'],
    [409, 'reconciliation_pending'],
    [429, 'rate_limited'],
    [500, 'backend_unavailable'],
    [503, 'backend_unavailable'],
  ] as const)('maps HTTP %i to ApiError kind %s', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, { error: { message: 'nope', code: 'X', requestId: 'r' } })))

    await expect(compareReflections(VALID_REQUEST)).rejects.toMatchObject({ kind })
  })

  it('rejects with backend_unavailable when the network request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))

    await expect(compareReflections(VALID_REQUEST)).rejects.toBeInstanceOf(ApiError)
    await expect(compareReflections(VALID_REQUEST)).rejects.toMatchObject({ kind: 'backend_unavailable' })
  })

  it('rejects with invalid_response when the 200 body fails schema validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { requestId: 'r', commonGround: [], differences: [], topics: [] })))

    await expect(compareReflections(VALID_REQUEST)).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('never shows a raw provider/server error message — only the sanitized ApiError.message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: { message: 'Mindlogic upstream stack trace leaked here', code: 'X', requestId: 'r' } })))

    try {
      await compareReflections(VALID_REQUEST)
      throw new Error('expected compareReflections to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).message).not.toContain('Mindlogic upstream stack trace')
    }
  })
})
