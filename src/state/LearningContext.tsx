import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Page } from '../App'

export type Level = 'Beginner' | 'Intermediate' | 'Advanced'

export interface LearningState {
  page: Page
  partner: {
    connected: boolean
    myName: string
    partnerName: string
    /** The partner's submitted reflection text — MVP-mocked (see mockPartnerService), empty until available. */
    reflection: string
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
  partner: { connected: false, myName: '', partnerName: '', reflection: '' },
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
  /**
   * The selected discussion recording, held in memory only. A `File`
   * can't be serialized into localStorage, so it does not survive a
   * refresh — `state.discussion.audioFileName` is the persisted trace
   * of what was selected, used to prompt the learner to reselect it.
   */
  audioFile: File | null
  setAudioFile: (file: File | null) => void
}

const LearningContext = createContext<LearningContextValue | null>(null)

export function LearningProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LearningState>(loadState)
  const [audioFile, setAudioFile] = useState<File | null>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const setPage = (page: Page) => setState(s => ({ ...s, page }))
  const update = (patch: Partial<LearningState>) => setState(s => ({ ...s, ...patch }))
  const reset = () => {
    setState(DEFAULT_STATE)
    setAudioFile(null)
  }

  return (
    <LearningContext.Provider value={{ state, setPage, update, reset, audioFile, setAudioFile }}>
      {children}
    </LearningContext.Provider>
  )
}

/** First letter of up to the first two words, uppercased — a generic stand-in for the "HJ"-style avatar initials. */
export function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  return parts.slice(0, 2).map(p => p[0].toUpperCase()).join('')
}

export function useLearning() {
  const ctx = useContext(LearningContext)
  if (!ctx) throw new Error('useLearning must be used within a LearningProvider')
  return ctx
}
