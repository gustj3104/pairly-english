import { useState } from 'react'
import type { Page } from '../App'
import { useLearning, type Level } from '../state/LearningContext'

interface Props { setPage: (p: Page) => void }

const LEVELS: { key: Level; label: string; desc: string }[] = [
  { key: 'Beginner', label: 'Beginner', desc: 'I can read simple sentences and basic vocabulary.' },
  { key: 'Intermediate', label: 'Intermediate', desc: 'I can follow news articles with some new words.' },
  { key: 'Advanced', label: 'Advanced', desc: 'I can read fluently and want nuanced discussion.' },
]

const INTERESTS = ['Technology', 'Society', 'Business', 'Culture', 'Environment', 'Lifestyle', 'Sports']

export default function OnboardingPage({ setPage }: Props) {
  const { state, update } = useLearning()
  const [level, setLevel] = useState<Level | null>(state.onboarding.level)
  const [interests, setInterests] = useState<string[]>(state.onboarding.interests)

  const toggleInterest = (topic: string) => {
    setInterests(prev => (prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]))
  }

  const canContinue = level !== null && interests.length > 0

  const handleContinue = () => {
    if (!canContinue) return
    update({ onboarding: { complete: true, level, interests } })
    setPage('dashboard')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafaf9', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 560, backgroundColor: 'white', borderRadius: 24, padding: 40, boxShadow: '0 8px 40px rgba(0,0,0,0.08)', border: '1px solid #e7e5e4' }}>
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 26, color: '#1c1917', margin: 0, marginBottom: 8 }}>Let's set up your learning</h2>
          <p style={{ color: '#78716c', fontSize: 14, margin: 0 }}>We'll use this to match you with articles at the right level and topics you care about.</p>
        </div>

        <div style={{ marginBottom: 28 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#44403c', display: 'block', marginBottom: 12 }}>Your English level</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {LEVELS.map(l => (
              <div
                key={l.key}
                role="button"
                onClick={() => setLevel(l.key)}
                style={{
                  padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
                  border: `1.5px solid ${level === l.key ? '#4f46e5' : '#e7e5e4'}`,
                  backgroundColor: level === l.key ? '#eef2ff' : 'white',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: level === l.key ? '#4f46e5' : '#1c1917' }}>{l.label}</div>
                <div style={{ fontSize: 12, color: '#78716c', marginTop: 2 }}>{l.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 32 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#44403c', display: 'block', marginBottom: 12 }}>Topics you're interested in</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {INTERESTS.map(topic => {
              const active = interests.includes(topic)
              return (
                <button
                  key={topic}
                  onClick={() => toggleInterest(topic)}
                  style={{
                    padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                    border: `1.5px solid ${active ? '#4f46e5' : '#e7e5e4'}`,
                    backgroundColor: active ? '#4f46e5' : 'white',
                    color: active ? 'white' : '#57534e',
                  }}
                >
                  {topic}
                </button>
              )
            })}
          </div>
        </div>

        <button
          onClick={handleContinue}
          disabled={!canContinue}
          style={{
            width: '100%', padding: '13px', borderRadius: 12, fontSize: 15, fontWeight: 600, border: 'none',
            backgroundColor: canContinue ? '#4f46e5' : '#e7e5e4',
            color: canContinue ? 'white' : '#a8a29e',
            cursor: canContinue ? 'pointer' : 'not-allowed',
          }}
        >
          Continue to Dashboard →
        </button>
        {!canContinue && (
          <p style={{ textAlign: 'center', fontSize: 12, color: '#a8a29e', margin: '10px 0 0' }}>
            Choose a level and at least one topic to continue
          </p>
        )}
      </div>
    </div>
  )
}
