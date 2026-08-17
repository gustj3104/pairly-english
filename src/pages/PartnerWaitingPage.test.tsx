import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import PartnerWaitingPage from './PartnerWaitingPage'

describe('PartnerWaitingPage', () => {
  it('renders the waiting-for-partner state', () => {
    renderWithLearning(<PartnerWaitingPage setPage={vi.fn()} />)

    expect(screen.getByText('Your partner is still writing.')).toBeInTheDocument()
    expect(screen.getByText('✓ Submitted')).toBeInTheDocument()
  })

  it('moves to AI comparison once the partner has submitted, and stores the partner reflection', async () => {
    const setPage = vi.fn()
    renderWithLearning(<PartnerWaitingPage setPage={setPage} />)

    fireEvent.click(screen.getByText('Simulate: Partner Submitted → Compare Now'))
    await waitFor(() => expect(setPage).toHaveBeenCalledWith('ai-comparison'))

    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(typeof saved.partner.reflection).toBe('string')
    expect(saved.partner.reflection.trim().length).toBeGreaterThan(0)
  })
})
