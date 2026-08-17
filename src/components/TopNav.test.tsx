import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import TopNav from './TopNav'

const { mockLogout } = vi.hoisted(() => ({ mockLogout: vi.fn() }))

vi.mock('../services/api/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/authService')>()
  return { ...actual, logout: mockLogout }
})

beforeEach(() => {
  mockLogout.mockReset()
  mockLogout.mockResolvedValue(undefined)
})

describe('TopNav', () => {
  it('logs out, clears local learning state, and navigates to landing', async () => {
    localStorage.setItem('pairly:state:v1', JSON.stringify({
      partner: { connected: true, myName: 'TestUser', partnerName: 'Jisoo', reflection: '' },
      onboarding: { complete: true, level: 'Intermediate', interests: ['Culture'] },
    }))
    const setPage = vi.fn()
    renderWithLearning(<TopNav page="dashboard" setPage={setPage} />)

    fireEvent.click(screen.getByText('Log out'))

    await waitFor(() => expect(setPage).toHaveBeenCalledWith('landing'))
    expect(mockLogout).toHaveBeenCalledTimes(1)

    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.partner.myName).toBe('')
    expect(saved.onboarding.complete).toBe(false)
  })

  it('still resets and navigates to landing even if the server logout call fails', async () => {
    mockLogout.mockRejectedValue(new Error('network down'))
    const setPage = vi.fn()
    renderWithLearning(<TopNav page="dashboard" setPage={setPage} />)

    fireEvent.click(screen.getByText('Log out'))

    await waitFor(() => expect(setPage).toHaveBeenCalledWith('landing'))
  })

  it('disables the logout button and does not double-submit while logging out', async () => {
    let resolveLogout: () => void = () => {}
    mockLogout.mockReturnValue(new Promise<void>(resolve => { resolveLogout = resolve }))
    renderWithLearning(<TopNav page="dashboard" setPage={vi.fn()} />)

    fireEvent.click(screen.getByText('Log out'))
    await waitFor(() => expect(screen.getByText('Logging out...')).toBeInTheDocument())
    expect(screen.getByText('Logging out...').closest('button')).toBeDisabled()
    fireEvent.click(screen.getByText('Logging out...'))

    expect(mockLogout).toHaveBeenCalledTimes(1)
    resolveLogout()
  })
})
