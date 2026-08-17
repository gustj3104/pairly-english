import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import LandingPage from './LandingPage'

describe('LandingPage', () => {
  it('navigates through Get Started -> connect -> onboarding', async () => {
    const setPage = vi.fn()
    renderWithLearning(<LandingPage setPage={setPage} />)

    fireEvent.click(screen.getAllByText('Get Started')[0])
    expect(screen.getByText('Connect with your partner')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Simulate Partner Joining ✓'))
    await waitFor(() => expect(screen.getByText("You're paired up!")).toBeInTheDocument())

    fireEvent.click(screen.getByText('Start Learning Together →'))
    expect(setPage).toHaveBeenCalledWith('onboarding')
  })

  it('sends returning users straight to the dashboard via Sign in', () => {
    const setPage = vi.fn()
    renderWithLearning(<LandingPage setPage={setPage} />)

    fireEvent.click(screen.getByText('Sign in'))
    expect(setPage).toHaveBeenCalledWith('dashboard')
  })
})
