import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import VocabularyPage from './VocabularyPage'
import { getVocabularyDictionary, VOCAB_GOAL } from '../services/mockNewsService'

const WORDS = getVocabularyDictionary()

function clickMemorizeCheckbox(word: string) {
  const wordLabel = screen.getByText(word)
  const card = wordLabel.closest('div')!.parentElement!.parentElement!
  const checkbox = card.querySelectorAll('button')[1]
  fireEvent.click(checkbox)
}

describe('VocabularyPage', () => {
  it('unlocks "Start Writing" once the goal count is reached, not before', () => {
    const setPage = vi.fn()
    renderWithLearning(<VocabularyPage setPage={setPage} />)

    const startWriting = screen.getByText('Start Writing →')
    expect(startWriting).toBeDisabled()

    for (let i = 0; i < VOCAB_GOAL - 1; i++) clickMemorizeCheckbox(WORDS[i].word)
    expect(startWriting).toBeDisabled()

    clickMemorizeCheckbox(WORDS[VOCAB_GOAL - 1].word)
    expect(startWriting).not.toBeDisabled()
  })

  it('navigates to reflection once the goal is already met', () => {
    localStorage.setItem('pairly:state:v1', JSON.stringify({
      vocabulary: { savedWords: [], checkedWords: WORDS.slice(0, VOCAB_GOAL).map(w => w.word), userExamples: {} },
    }))
    const setPage = vi.fn()
    renderWithLearning(<VocabularyPage setPage={setPage} />)

    const startWriting = screen.getByText('Start Writing →')
    expect(startWriting).not.toBeDisabled()
    fireEvent.click(startWriting)
    expect(setPage).toHaveBeenCalledWith('reflection')
  })
})
