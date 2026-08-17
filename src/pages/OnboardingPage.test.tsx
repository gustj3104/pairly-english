import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import OnboardingPage from './OnboardingPage'

describe('OnboardingPage', () => {
  it('keeps Continue disabled until a level and an interest are chosen', () => {
    const setPage = vi.fn()
    renderWithLearning(<OnboardingPage setPage={setPage} />)

    const continueBtn = screen.getByText('Continue to Dashboard →')
    expect(continueBtn).toBeDisabled()

    fireEvent.click(screen.getByText('Intermediate'))
    expect(continueBtn).toBeDisabled()

    fireEvent.click(screen.getByText('Culture'))
    expect(continueBtn).not.toBeDisabled()
  })

  it('saves the chosen level/interests and continues to the dashboard', () => {
    const setPage = vi.fn()
    renderWithLearning(<OnboardingPage setPage={setPage} />)

    fireEvent.click(screen.getByText('Advanced'))
    fireEvent.click(screen.getByText('Technology'))
    fireEvent.click(screen.getByText('Continue to Dashboard →'))

    expect(setPage).toHaveBeenCalledWith('dashboard')
    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.onboarding).toEqual({ complete: true, level: 'Advanced', interests: ['Technology'] })
  })
})
