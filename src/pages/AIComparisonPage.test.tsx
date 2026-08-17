import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import AIComparisonPage from './AIComparisonPage'

describe('AIComparisonPage', () => {
  it('requires a discussion topic to be selected before continuing', async () => {
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
})
