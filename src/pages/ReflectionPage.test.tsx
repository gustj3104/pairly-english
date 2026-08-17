import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import ReflectionPage from './ReflectionPage'

describe('ReflectionPage', () => {
  it('saves a draft to persisted state via the Save Draft button', async () => {
    const setPage = vi.fn()
    renderWithLearning(<ReflectionPage setPage={setPage} />)

    await waitFor(() => expect(screen.getByPlaceholderText('Reflection title...')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Reflection title...'), { target: { value: 'My take on K-culture' } })
    fireEvent.click(screen.getByText('Save Draft'))

    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.reflection.title).toBe('My take on K-culture')
    expect(saved.reflection.submitted).toBe(false)
  })

  it('submits the reflection and moves to the partner-waiting screen', async () => {
    const setPage = vi.fn()
    renderWithLearning(<ReflectionPage setPage={setPage} />)

    await waitFor(() => expect(screen.getByText('Submit Reflection →')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Submit Reflection →'))
    expect(screen.getByText('Submit your reflection?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Submit', { exact: true }))
    expect(setPage).toHaveBeenCalledWith('waiting')

    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.reflection.submitted).toBe(true)
  })

  it("shows the partner's name, not a hardcoded one, while waiting for their submission", async () => {
    localStorage.setItem('pairly:state:v1', JSON.stringify({
      partner: { connected: true, myName: 'TestUser', partnerName: 'PartnerX' },
    }))
    const setPage = vi.fn()
    renderWithLearning(<ReflectionPage setPage={setPage} />)

    await waitFor(() => expect(screen.getByText('Submit Reflection →')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Submit Reflection →'))

    expect(screen.getByText(/PartnerX hasn't submitted yet/)).toBeInTheDocument()
  })
})
