import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import SpeakingFeedbackPage from './SpeakingFeedbackPage'

describe('SpeakingFeedbackPage', () => {
  it('marks the day complete and hands off to the completion screen', async () => {
    const setPage = vi.fn()
    renderWithLearning(<SpeakingFeedbackPage setPage={setPage} />)

    await waitFor(() => expect(screen.getByText('🎉 Mark Today Complete')).toBeInTheDocument(), { timeout: 3000 })

    fireEvent.click(screen.getByText('🎉 Mark Today Complete'))
    expect(setPage).toHaveBeenCalledWith('completed')

    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.today.completed).toBe(true)
  })
})
