import { useState } from 'react'
import type { Page } from '../App'
import { useLearning } from '../state/LearningContext'
import { getVocabularyDictionary, VOCAB_GOAL } from '../services/mockNewsService'

interface Props { setPage: (p: Page) => void }

const WORDS = getVocabularyDictionary()

export default function VocabularyPage({ setPage }: Props) {
  const { state, update } = useLearning()
  const checked = state.vocabulary.checkedWords
  const userExamples = state.vocabulary.userExamples
  const [mode, setMode] = useState<'list' | 'flashcard'>('list')
  const [cardIdx, setCardIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const toggleCheck = (w: string) => {
    const next = checked.includes(w) ? checked.filter(c => c !== w) : [...checked, w]
    update({ vocabulary: { ...state.vocabulary, checkedWords: next } })
  }

  const setExample = (word: string, value: string) => {
    update({ vocabulary: { ...state.vocabulary, userExamples: { ...userExamples, [word]: value } } })
  }

  const goalMet = checked.length >= VOCAB_GOAL

  if (mode === 'flashcard') {
    const w = WORDS[cardIdx]
    return (
      <div style={{ paddingTop: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            <h2 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 26, color: '#1c1917', margin: '0 0 4px' }}>Flashcard Mode</h2>
            <p style={{ color: '#78716c', fontSize: 14, margin: 0 }}>{cardIdx + 1} of {WORDS.length} words</p>
          </div>
          <button onClick={() => setMode('list')} style={{ padding: '8px 16px', borderRadius: 10, border: '1.5px solid #e7e5e4', backgroundColor: 'white', fontSize: 13, cursor: 'pointer', color: '#57534e' }}>
            ☰ List View
          </button>
        </div>

        <div style={{ maxWidth: 540, margin: '0 auto' }}>
          {/* Progress */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 28 }}>
            {WORDS.map((_, i) => (
              <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < cardIdx ? '#10b981' : i === cardIdx ? '#4f46e5' : '#e7e5e4' }} />
            ))}
          </div>

          {/* Card */}
          <div onClick={() => setFlipped(!flipped)} style={{ backgroundColor: 'white', borderRadius: 24, padding: '48px 40px', textAlign: 'center', cursor: 'pointer', border: '1px solid #e7e5e4', boxShadow: '0 4px 24px rgba(0,0,0,0.06)', minHeight: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.15s', userSelect: 'none' }}>
            {!flipped ? (
              <>
                <div style={{ fontSize: 12, color: '#a8a29e', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Word</div>
                <div style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 44, color: '#1c1917', marginBottom: 10 }}>{w.word}</div>
                <div style={{ fontSize: 15, color: '#a8a29e', marginBottom: 20 }}>{w.pron}</div>
                <span style={{ fontSize: 12, backgroundColor: '#eef2ff', color: '#4f46e5', padding: '4px 12px', borderRadius: 20 }}>{w.pos}</span>
                <div style={{ marginTop: 28, fontSize: 13, color: '#c8c4c0' }}>Tap to reveal definition</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 24, color: '#1c1917', marginBottom: 12 }}>{w.word}</div>
                <div style={{ fontSize: 16, color: '#44403c', lineHeight: 1.6, marginBottom: 12, maxWidth: 380 }}>{w.def}</div>
                <div style={{ fontSize: 18, color: '#4f46e5', fontWeight: 600, marginBottom: 16 }}>{w.kr}</div>
                <div style={{ fontSize: 13, color: '#78716c', fontStyle: 'italic', maxWidth: 380, lineHeight: 1.5 }}>"{w.sentence}"</div>
              </>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
            <button onClick={() => { setCardIdx(Math.max(0, cardIdx - 1)); setFlipped(false) }} disabled={cardIdx === 0} style={{ padding: '10px 20px', borderRadius: 10, border: '1.5px solid #e7e5e4', backgroundColor: 'white', fontSize: 14, cursor: cardIdx === 0 ? 'not-allowed' : 'pointer', color: cardIdx === 0 ? '#c8c4c0' : '#57534e' }}>
              ← Prev
            </button>
            <button onClick={() => toggleCheck(w.word)} style={{ padding: '10px 20px', borderRadius: 10, border: `1.5px solid ${checked.includes(w.word) ? '#10b981' : '#e7e5e4'}`, backgroundColor: checked.includes(w.word) ? '#ecfdf5' : 'white', fontSize: 13, cursor: 'pointer', color: checked.includes(w.word) ? '#059669' : '#57534e', fontWeight: 600 }}>
              {checked.includes(w.word) ? '✓ Memorized' : 'Mark as Done'}
            </button>
            <button onClick={() => { if (cardIdx < WORDS.length - 1) { setCardIdx(cardIdx + 1); setFlipped(false) } }} disabled={cardIdx === WORDS.length - 1} style={{ padding: '10px 20px', borderRadius: 10, border: '1.5px solid #e7e5e4', backgroundColor: 'white', fontSize: 14, cursor: cardIdx === WORDS.length - 1 ? 'not-allowed' : 'pointer', color: cardIdx === WORDS.length - 1 ? '#c8c4c0' : '#57534e' }}>
              Next →
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingTop: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 28, color: '#1c1917', margin: '0 0 6px' }}>Vocabulary Study</h2>
          <p style={{ color: '#78716c', fontSize: 14, margin: 0 }}>Use these words in your reflection. Goal: {VOCAB_GOAL}+ words.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2, backgroundColor: '#f5f5f4', borderRadius: 10, padding: 3 }}>
            <button onClick={() => setMode('list')} style={{ padding: '6px 14px', borderRadius: 8, backgroundColor: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#1c1917', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
              ☰ List
            </button>
            <button onClick={() => { setMode('flashcard'); setCardIdx(0); setFlipped(false) }} style={{ padding: '6px 14px', borderRadius: 8, backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 400, color: '#78716c' }}>
              ⊞ Flashcard
            </button>
          </div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: goalMet ? '#059669' : '#4f46e5', backgroundColor: goalMet ? '#ecfdf5' : '#eef2ff', padding: '6px 14px', borderRadius: 10 }}>
            {checked.length} / {WORDS.length} words
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {WORDS.map(w => {
          const isChecked = checked.includes(w.word)
          return (
            <div key={w.word} style={{ backgroundColor: 'white', borderRadius: 16, padding: '20px', border: `1.5px solid ${isChecked ? '#a7f3d0' : '#e7e5e4'}`, transition: 'border-color 0.2s', boxShadow: isChecked ? '0 0 0 3px rgba(16,185,129,0.1)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 22, color: '#1c1917' }}>{w.word}</span>
                    <span style={{ fontSize: 12, color: '#a8a29e', fontFamily: 'JetBrains Mono, monospace' }}>{w.pron}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{ fontSize: 11, backgroundColor: '#eef2ff', color: '#4f46e5', padding: '2px 8px', borderRadius: 8 }}>{w.pos}</span>
                    <span style={{ fontSize: 11, backgroundColor: '#f5f5f4', color: '#78716c', padding: '2px 8px', borderRadius: 8 }}>{w.kr}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button style={{ fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', color: '#78716c' }}>🔊</button>
                  <button onClick={() => toggleCheck(w.word)} style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid ${isChecked ? '#10b981' : '#e7e5e4'}`, backgroundColor: isChecked ? '#10b981' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s' }}>
                    {isChecked && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                </div>
              </div>
              <p style={{ fontSize: 13, color: '#44403c', lineHeight: 1.6, margin: '0 0 10px' }}>{w.def}</p>
              <div style={{ padding: '8px 12px', backgroundColor: '#f5f5f4', borderRadius: 8, fontSize: 12, color: '#78716c', fontStyle: 'italic', marginBottom: 12, lineHeight: 1.5 }}>
                "{w.sentence}"
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#a8a29e', marginBottom: 4 }}>My example sentence:</div>
                <input
                  value={userExamples[w.word] || ''}
                  onChange={e => setExample(w.word, e.target.value)}
                  placeholder={`Write a sentence using "${w.word}"...`}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e7e5e4', fontSize: 12, color: '#44403c', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', backgroundColor: '#fafaf9' }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }}>
        {!goalMet && <span style={{ fontSize: 13, color: '#a8a29e' }}>Mark {VOCAB_GOAL - checked.length} more words as memorized to continue</span>}
        <button onClick={() => setPage('reflection')} disabled={!goalMet} style={{ padding: '13px 32px', borderRadius: 12, backgroundColor: goalMet ? '#4f46e5' : '#e7e5e4', color: goalMet ? 'white' : '#a8a29e', fontSize: 15, fontWeight: 600, border: 'none', cursor: goalMet ? 'pointer' : 'not-allowed' }}>
          Start Writing →
        </button>
      </div>
    </div>
  )
}
