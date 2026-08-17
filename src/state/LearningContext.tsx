import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Page } from '../App'

export type Level = 'Beginner' | 'Intermediate' | 'Advanced'

export interface LearningState {
  page: Page
  partner: {
    connected: boolean
    myName: string
    partnerName: string
  }
  onboarding: {
    complete: boolean
    level: Level | null
    interests: string[]
  }
  vocabulary: {
    savedWords: string[]
    checkedWords: string[]
    userExamples: Record<string, string>
  }
  reflection: {
    title: string
    body: string
    submitted: boolean
  }
  discussion: {
    selectedTopicIndex: number | null
    selectedTopicText: string | null
    audioFileName: string | null
  }
  today: {
    completed: boolean
    streak: number
  }
}

const STORAGE_KEY = 'pairly:state:v1'

const DEFAULT_STATE: LearningState = {
  page: 'landing',
  partner: { connected: false, myName: '', partnerName: '' },
  onboarding: { complete: false, level: null, interests: [] },
  vocabulary: { savedWords: [], checkedWords: [], userExamples: {} },
  reflection: { title: '', body: '', submitted: false },
  discussion: { selectedTopicIndex: null, selectedTopicText: null, audioFileName: null },
  today: { completed: false, streak: 12 },
}

function loadState(): LearningState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_STATE, ...parsed }
  } catch {
    return DEFAULT_STATE
  }
}

interface LearningContextValue {
  state: LearningState
  setPage: (page: Page) => void
  update: (patch: Partial<LearningState>) => void
  reset: () => void
}

const LearningContext = createContext<LearningContextValue | null>(null)

export function LearningProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LearningState>(loadState)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const setPage = (page: Page) => setState(s => ({ ...s, page }))
  const update = (patch: Partial<LearningState>) => setState(s => ({ ...s, ...patch }))
  const reset = () => setState(DEFAULT_STATE)

  return (
    <LearningContext.Provider value={{ state, setPage, update, reset }}>
      {children}
    </LearningContext.Provider>
  )
}

export function useLearning() {
  const ctx = useContext(LearningContext)
  if (!ctx) throw new Error('useLearning must be used within a LearningProvider')
  return ctx
}
