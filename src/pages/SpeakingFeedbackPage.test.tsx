import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import SpeakingFeedbackPage from './SpeakingFeedbackPage'
import { aiService } from '../services'

describe('SpeakingFeedbackPage', () => {
  it('analyzes the actual selected File object, not just its name', async () => {
    const spy = vi.spyOn(aiService, 'analyzeAudio')
    const file = new File(['fake-audio-bytes'], 'discussion.mp3', { type: 'audio/mpeg' })

    renderWithLearning(<SpeakingFeedbackPage setPage={vi.fn()} />, { audioFile: file })

    await waitFor(() => expect(spy).toHaveBeenCalledWith(file), { timeout: 3000 })
    spy.mockRestore()
  })

  it('marks the day complete and hands off to the completion screen', async () => {
    const setPage = vi.fn()
    const file = new File(['fake-audio-bytes'], 'discussion.mp3', { type: 'audio/mpeg' })
    renderWithLearning(<SpeakingFeedbackPage setPage={setPage} />, { audioFile: file })

    await waitFor(() => expect(screen.getByText('🎉 Mark Today Complete')).toBeInTheDocument(), { timeout: 3000 })

    fireEvent.click(screen.getByText('🎉 Mark Today Complete'))
    expect(setPage).toHaveBeenCalledWith('completed')

    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.today.completed).toBe(true)
  })

  it('prompts to go back and reselect audio when no file is available in this session', () => {
    localStorage.setItem('pairly:state:v1', JSON.stringify({
      discussion: { selectedTopicIndex: 0, selectedTopicText: null, audioFileName: 'discussion.mp3' },
    }))
    const setPage = vi.fn()
    renderWithLearning(<SpeakingFeedbackPage setPage={setPage} />)

    expect(screen.getByText(/No audio file is available in this session/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('← Back to Discussion Room'))
    expect(setPage).toHaveBeenCalledWith('discussion')
  })
})
