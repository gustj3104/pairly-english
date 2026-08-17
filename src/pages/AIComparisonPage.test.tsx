import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import { ApiError } from '../services/api/errors'
import AIComparisonPage from './AIComparisonPage'

const { mockCompareReflections } = vi.hoisted(() => ({ mockCompareReflections: vi.fn() }))

vi.mock('../services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services')>()
  return {
    ...actual,
    aiService: { ...actual.aiService, compareReflections: mockCompareReflections },
  }
})

const VALID_PARTNER_REFLECTION =
  'This is a placeholder partner reflection long enough to clear the minimum length required by the backend contract for a valid submission.'

function seedPartnerReflection() {
  localStorage.setItem('pairly:state:v1', JSON.stringify({
    reflection: { title: 'My reflection', body: 'My own reflection text about the article.', submitted: true },
    partner: { connected: true, myName: 'Hyunji', partnerName: 'Jisoo', reflection: VALID_PARTNER_REFLECTION },
  }))
}

const SAMPLE_RESULT = {
  requestId: 'req-1',
  commonGround: [{ point: 'p', mine: 'm', partner: 'pt' }],
  differences: [
    { topic: 't', mine: { stance: 's1', quote: 'q1' }, partner: { stance: 's2', quote: 'q2' } },
  ],
  topics: [
    { question: "Is K-culture's global rise a result of genuine artistic quality, or primarily effective marketing strategy?", reason: 'r1', difficulty: 'Intermediate' as const },
    { question: 'q2?', reason: 'r2', difficulty: 'Advanced' as const },
    { question: 'q3?', reason: 'r3', difficulty: 'Intermediate' as const },
  ],
}

beforeEach(() => {
  mockCompareReflections.mockReset()
})

describe('AIComparisonPage', () => {
  it('redirects to the waiting page when there is no partner reflection yet, and never calls the API', async () => {
    const setPage = vi.fn()
    renderWithLearning(<AIComparisonPage setPage={setPage} />)

    await waitFor(() => expect(setPage).toHaveBeenCalledWith('waiting'))
    expect(mockCompareReflections).not.toHaveBeenCalled()
  })

  it('requires a discussion topic to be selected before continuing', async () => {
    mockCompareReflections.mockResolvedValue(SAMPLE_RESULT)
    seedPartnerReflection()
    const setPage = vi.fn()
    renderWithLearning(<AIComparisonPage setPage={setPage} />)

    await waitFor(() => expect(screen.getByText('Start Discussion →')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByText('Start Discussion →')).toBeDisabled()

    fireEvent.click(screen.getByText("Is K-culture's global rise a result of genuine artistic quality, or primarily effective marketing strategy?"))
    expect(screen.getByText('Start Discussion →')).not.toBeDisabled()

    fireEvent.click(screen.getByText('Start Discussion →'))
    expect(setPage).toHaveBeenCalledWith('discussion')

    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.discussion.selectedTopicIndex).toBe(0)
  })

  it('sends exactly one request for a given input — no duplicate calls while loading', async () => {
    let resolvePromise: (value: typeof SAMPLE_RESULT) => void = () => {}
    mockCompareReflections.mockReturnValue(new Promise(resolve => { resolvePromise = resolve }))
    seedPartnerReflection()
    renderWithLearning(<AIComparisonPage setPage={vi.fn()} />)

    await waitFor(() => expect(mockCompareReflections).toHaveBeenCalledTimes(1))
    resolvePromise(SAMPLE_RESULT)
    await waitFor(() => expect(screen.getByText('Start Discussion →')).toBeInTheDocument())
    expect(mockCompareReflections).toHaveBeenCalledTimes(1)
  })

  it('shows the credit-limit-exceeded message and no Retry button when the API returns 402', async () => {
    mockCompareReflections.mockRejectedValue(new ApiError('credit_limit_exceeded', '이번 달 AI 학습 한도를 모두 사용했습니다.'))
    seedPartnerReflection()
    renderWithLearning(<AIComparisonPage setPage={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('이번 달 AI 학습 한도를 모두 사용했습니다.')).toBeInTheDocument())
    expect(screen.queryByText('Retry')).not.toBeInTheDocument()
    // Never falls back to mock content on failure.
    expect(screen.queryByText('Common Ground')).not.toBeInTheDocument()
  })

  it('shows a reconciliation-pending message with no Retry button when the API returns 409', async () => {
    mockCompareReflections.mockRejectedValue(new ApiError('reconciliation_pending', '확인 중입니다.'))
    seedPartnerReflection()
    renderWithLearning(<AIComparisonPage setPage={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('확인 중입니다.')).toBeInTheDocument())
    expect(screen.queryByText('Retry')).not.toBeInTheDocument()
  })

  it('shows a rate-limited message with a Retry button, and Retry calls the API again', async () => {
    mockCompareReflections.mockRejectedValueOnce(new ApiError('rate_limited', '요청이 너무 많습니다.'))
    seedPartnerReflection()
    renderWithLearning(<AIComparisonPage setPage={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('요청이 너무 많습니다.')).toBeInTheDocument())
    expect(mockCompareReflections).toHaveBeenCalledTimes(1)

    mockCompareReflections.mockResolvedValueOnce(SAMPLE_RESULT)
    fireEvent.click(screen.getByText('Retry'))

    await waitFor(() => expect(screen.getByText('Start Discussion →')).toBeInTheDocument())
    expect(mockCompareReflections).toHaveBeenCalledTimes(2)
  })

  it('shows a backend-unavailable message on a network-style failure', async () => {
    mockCompareReflections.mockRejectedValue(new ApiError('backend_unavailable', '서버에 연결할 수 없습니다.'))
    seedPartnerReflection()
    renderWithLearning(<AIComparisonPage setPage={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('서버에 연결할 수 없습니다.')).toBeInTheDocument())
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('shows an invalid-response message when the response fails Zod validation', async () => {
    mockCompareReflections.mockRejectedValue(new ApiError('invalid_response', '서버 응답 형식이 올바르지 않습니다.'))
    seedPartnerReflection()
    renderWithLearning(<AIComparisonPage setPage={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('서버 응답 형식이 올바르지 않습니다.')).toBeInTheDocument())
  })

  it('shows a generic error for an unexpected (non-ApiError) failure', async () => {
    mockCompareReflections.mockRejectedValue(new Error('boom'))
    seedPartnerReflection()
    renderWithLearning(<AIComparisonPage setPage={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('문제가 발생했습니다')).toBeInTheDocument())
  })
})
