import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import DashboardPage from './DashboardPage'
import { getWeekRecords, TODAY_DATE_KEY } from '../services/mockWeekService'

describe('DashboardPage', () => {
  it("greets the learner by their own name and shows their partner's name, not hardcoded ones", () => {
    localStorage.setItem('pairly:state:v1', JSON.stringify({
      partner: { connected: true, myName: 'Alex', partnerName: 'Sam' },
    }))
    renderWithLearning(<DashboardPage setPage={vi.fn()} />)

    expect(screen.getByText('Good evening, Alex ✨')).toBeInTheDocument()
    expect(screen.getAllByText('Alex').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sam').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Hyunji/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Jisoo/)).not.toBeInTheDocument()
  })

  it("renders every day of the mock weekly record and reflects today's live completion", () => {
    localStorage.setItem('pairly:state:v1', JSON.stringify({ today: { completed: true, streak: 5 } }))
    renderWithLearning(<DashboardPage setPage={vi.fn()} />)

    const records = getWeekRecords()
    for (const day of records) {
      expect(screen.getByText(day.day)).toBeInTheDocument()
    }

    // Today's record is normally not-done in the mock data; a completed
    // session should overlay a "done" dot onto that same record, not a
    // separately hand-built entry.
    const today = records.find(r => r.date === TODAY_DATE_KEY)!
    expect(today.done).toBe(false)
    expect(screen.getByText('4 / 5 days completed')).toBeInTheDocument()
  })
})
