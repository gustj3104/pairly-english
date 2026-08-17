import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import NewsReaderPage from './NewsReaderPage'
import { newsService } from '../services'
import { getVocabGoals } from '../services/mockNewsService'

describe('NewsReaderPage', () => {
  it('shows a word goal computed from the article, not a fixed number', async () => {
    const article = await newsService.getTodayArticle()
    const goals = getVocabGoals(article)

    const setPage = vi.fn()
    renderWithLearning(<NewsReaderPage setPage={setPage} />)

    await waitFor(() => expect(screen.getByText(`0/${goals.total}`)).toBeInTheDocument())
  })

  it('adds a clicked vocabulary word to the saved list', async () => {
    const article = await newsService.getTodayArticle()
    const goals = getVocabGoals(article)
    const setPage = vi.fn()
    renderWithLearning(<NewsReaderPage setPage={setPage} />)

    await waitFor(() => expect(screen.getByText(`0/${goals.total}`)).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('hallyu')[0])
    fireEvent.click(screen.getByText('+ Add to Vocabulary'))

    expect(screen.getByText(`1/${goals.total}`)).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.vocabulary.savedWords).toContain('hallyu')
  })

  it('keeps "Continue to Vocabulary" disabled below the word goal', async () => {
    const setPage = vi.fn()
    renderWithLearning(<NewsReaderPage setPage={setPage} />)

    await waitFor(() => expect(screen.getByText('Continue to Vocabulary →')).toBeInTheDocument())
    expect(screen.getByText('Continue to Vocabulary →')).toBeDisabled()
  })
})
