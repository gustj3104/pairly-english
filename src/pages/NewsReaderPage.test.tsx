import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import NewsReaderPage from './NewsReaderPage'
import { getVocabularyDictionary } from '../services/mockNewsService'

const TOTAL = getVocabularyDictionary().length

describe('NewsReaderPage', () => {
  it('adds a clicked vocabulary word to the saved list', () => {
    const setPage = vi.fn()
    renderWithLearning(<NewsReaderPage setPage={setPage} />)

    expect(screen.getByText(`0/${TOTAL}`)).toBeInTheDocument()

    fireEvent.click(screen.getAllByText('hallyu')[0])
    fireEvent.click(screen.getByText('+ Add to Vocabulary'))

    expect(screen.getByText(`1/${TOTAL}`)).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.vocabulary.savedWords).toContain('hallyu')
  })

  it('keeps "Continue to Vocabulary" disabled below the word goal', () => {
    const setPage = vi.fn()
    renderWithLearning(<NewsReaderPage setPage={setPage} />)

    expect(screen.getByText('Continue to Vocabulary →')).toBeDisabled()
  })
})
