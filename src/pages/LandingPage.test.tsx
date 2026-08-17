import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import { ApiError } from '../services/api/errors'
import LandingPage from './LandingPage'

const { mockLogin, mockGetSession } = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('../services/api/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/authService')>()
  return { ...actual, login: mockLogin, getSession: mockGetSession }
})

beforeEach(() => {
  mockLogin.mockReset()
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ authenticated: false })
})

async function waitForLoginForm() {
  await waitFor(() => expect(screen.getByLabelText('Name')).toBeInTheDocument())
}

describe('LandingPage', () => {
  it('shows the hero page for a first-time (never logged in) visitor, with no session-expired notice', async () => {
    renderWithLearning(<LandingPage setPage={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByText('Get Started')[0]).toBeInTheDocument())
    expect(screen.queryByText(/세션이 만료/)).not.toBeInTheDocument()
  })

  it('navigates through Get Started -> login -> connect -> onboarding', async () => {
    mockLogin.mockResolvedValue({ name: 'TestUser' })
    const setPage = vi.fn()
    renderWithLearning(<LandingPage setPage={setPage} />)

    await waitFor(() => expect(screen.getAllByText('Get Started')[0]).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('Get Started')[0])
    await waitForLoginForm()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'TestUser' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'shared-pw' } })
    fireEvent.click(screen.getByText('Continue'))

    await waitFor(() => expect(screen.getByText(/Welcome, TestUser/)).toBeInTheDocument())
    expect(mockLogin).toHaveBeenCalledWith('TestUser', 'shared-pw')

    fireEvent.click(screen.getByText('Simulate Partner Joining ✓'))
    await waitFor(() => expect(screen.getByText("You're paired up!")).toBeInTheDocument())

    fireEvent.click(screen.getByText('Start Learning Together →'))
    expect(setPage).toHaveBeenCalledWith('onboarding')

    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.partner.myName).toBe('TestUser')
  }, 10000)

  it('shows an error and does not navigate on a wrong password, and clears the password field', async () => {
    mockLogin.mockRejectedValue(new ApiError('unauthorized', '이름 또는 비밀번호가 올바르지 않습니다.'))
    const setPage = vi.fn()
    renderWithLearning(<LandingPage setPage={setPage} />)

    await waitFor(() => expect(screen.getAllByText('Get Started')[0]).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('Get Started')[0])
    await waitForLoginForm()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'TestUser' } })
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement
    fireEvent.change(passwordInput, { target: { value: 'wrong-pw' } })
    fireEvent.click(screen.getByText('Continue'))

    await waitFor(() => expect(screen.getByText('이름 또는 비밀번호가 올바르지 않습니다.')).toBeInTheDocument())
    expect(setPage).not.toHaveBeenCalled()
    expect(passwordInput.value).toBe('')
  })

  it('shows a backend-unavailable message on a network-style login failure', async () => {
    mockLogin.mockRejectedValue(new ApiError('backend_unavailable', '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.'))
    renderWithLearning(<LandingPage setPage={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Get Started')[0]).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('Get Started')[0])
    await waitForLoginForm()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'TestUser' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByText('Continue'))

    await waitFor(() => expect(screen.getByText('서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.')).toBeInTheDocument())
  })

  it('shows a rate-limited message on repeated failed attempts', async () => {
    mockLogin.mockRejectedValue(new ApiError('rate_limited', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'))
    renderWithLearning(<LandingPage setPage={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Get Started')[0]).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('Get Started')[0])
    await waitForLoginForm()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'TestUser' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByText('Continue'))

    await waitFor(() => expect(screen.getByText('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument())
  })

  it('disables the submit button and does not double-submit while a login request is in flight', async () => {
    let resolveLogin: (value: { name: string }) => void = () => {}
    mockLogin.mockReturnValue(new Promise(resolve => { resolveLogin = resolve }))
    renderWithLearning(<LandingPage setPage={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Get Started')[0]).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('Get Started')[0])
    await waitForLoginForm()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'TestUser' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByText('Continue'))

    await waitFor(() => expect(screen.getByText('Signing in...')).toBeInTheDocument())
    expect(screen.getByText('Signing in...').closest('button')).toBeDisabled()
    // Clicking a disabled submit button fires no submit — this proves the
    // guard isn't the only thing preventing a duplicate call.
    fireEvent.click(screen.getByText('Signing in...'))
    fireEvent.click(screen.getByText('Signing in...'))

    expect(mockLogin).toHaveBeenCalledTimes(1)
    resolveLogin({ name: 'TestUser' })
    await waitFor(() => expect(screen.getByText(/Welcome, TestUser/)).toBeInTheDocument())
  })

  it('restores an authenticated session on mount and skips straight past the login screen', async () => {
    mockGetSession.mockResolvedValue({ authenticated: true, name: 'RestoredUser' })
    renderWithLearning(<LandingPage setPage={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/Welcome, RestoredUser/)).toBeInTheDocument())
    expect(screen.queryByText('Get Started')).not.toBeInTheDocument()

    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.partner.myName).toBe('RestoredUser')
  })

  it('shows a session-expired notice when a previously-known user has no valid session anymore', async () => {
    localStorage.setItem('pairly:state:v1', JSON.stringify({
      partner: { connected: false, myName: 'OldUser', partnerName: '', reflection: '' },
    }))
    mockGetSession.mockResolvedValue({ authenticated: false })
    renderWithLearning(<LandingPage setPage={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Get Started')[0]).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('Get Started')[0])
    await waitForLoginForm()

    expect(screen.getByText(/세션이 만료되었습니다/)).toBeInTheDocument()
  })
})
