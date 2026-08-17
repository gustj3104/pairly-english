import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import VocabularyPage from './VocabularyPage'
import { newsService } from '../services'
import { getVocabGoals, type Article } from '../services/mockNewsService'

let article: Article

function clickMemorizeCheckbox(word: string) {
  const wordLabel = screen.getByText(word)
  const card = wordLabel.closest('div')!.parentElement!.parentElement!
  const checkbox = card.querySelectorAll('button')[1]
  fireEvent.click(checkbox)
}

describe('VocabularyPage', () => {
  it('shows a memorize goal computed from the article, not a fixed number', async () => {
    article = await newsService.getTodayArticle()
    const goals = getVocabGoals(article)

    const setPage = vi.fn()
    renderWithLearning(<VocabularyPage setPage={setPage} />)

    await waitFor(() => expect(screen.getByText(new RegExp(`Goal: ${goals.memorizeGoal}/${goals.total} words`))).toBeInTheDocument())
  })

  it('unlocks "Start Writing" once the goal count is reached, not before', async () => {
    const goals = getVocabGoals(article)
    const setPage = vi.fn()
    renderWithLearning(<VocabularyPage setPage={setPage} />)

    await waitFor(() => expect(screen.getByText('Start Writing →')).toBeInTheDocument())
    const startWriting = screen.getByText('Start Writing →')
    expect(startWriting).toBeDisabled()

    for (let i = 0; i < goals.memorizeGoal - 1; i++) clickMemorizeCheckbox(article.vocabulary[i].word)
    expect(startWriting).toBeDisabled()

    clickMemorizeCheckbox(article.vocabulary[goals.memorizeGoal - 1].word)
    expect(startWriting).not.toBeDisabled()
  })

  it('navigates to reflection once the goal is already met', async () => {
    const goals = getVocabGoals(article)
    localStorage.setItem('pairly:state:v1', JSON.stringify({
      vocabulary: { savedWords: [], checkedWords: article.vocabulary.slice(0, goals.memorizeGoal).map(w => w.word), userExamples: {} },
    }))
    const setPage = vi.fn()
    renderWithLearning(<VocabularyPage setPage={setPage} />)

    await waitFor(() => expect(screen.getByText('Start Writing →')).toBeInTheDocument())
    const startWriting = screen.getByText('Start Writing →')
    expect(startWriting).not.toBeDisabled()
    fireEvent.click(startWriting)
    expect(setPage).toHaveBeenCalledWith('reflection')
  })
})
