import { useState, useEffect } from 'react'
import type { Page } from '../App'
import { useLearning } from '../state/LearningContext'
import { getVocabularyDictionary } from '../services/mockNewsService'

interface Props { setPage: (p: Page) => void }

const WORDS = getVocabularyDictionary().map(w => w.word)
const GUIDE = [
  'What was the main point of the article?',
  'What did you find most interesting?',
  "Do you agree with the article's argument?",
  'How does this issue affect society or your life?',
]

export default function ReflectionPage({ setPage }: Props) {
  const { state, update } = useLearning()
  const [title, setTitle] = useState(state.reflection.title)
  const [body, setBody] = useState(state.reflection.body)
  const [saved, setSaved] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const usedWords = WORDS.filter(w => body.toLowerCase().includes(w))
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0

  const saveDraft = () => {
    update({ reflection: { ...state.reflection, title, body } })
    setSaved(true)
  }

  useEffect(() => {
    setSaved(false)
    const t = setTimeout(saveDraft, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, title])

  const highlightUsedInBody = (text: string) => {
    return text.split(/(\s+)/).map((w, i) => {
      const clean = w.toLowerCase().replace(/[^a-z]/g, '')
      if (WORDS.includes(clean)) {
        return <mark key={i} style={{ backgroundColor: '#fef08a', borderRadius: 2, padding: '0 1px' }}>{w}</mark>
      }
      return <span key={i}>{w}</span>
    })
  }

  const handleSubmit = () => {
    update({ reflection: { title, body, submitted: true } })
    setPage('waiting')
  }

  return (
    <div style={{ paddingTop: 28 }}>
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 28, color: '#1c1917', margin: '0 0 4px' }}>Write Your Reflection</h2>
        <p style={{ color: '#78716c', fontSize: 14, margin: 0 }}>Use your vocabulary words to share your thoughts on the article.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24, alignItems: 'start' }}>
        {/* Left: Reference panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Article summary */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: '18px', border: '1px solid #e7e5e4' }}>
            <div style={{ fontSize: 11, color: '#a8a29e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Today's Article</div>
            <div style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 15, color: '#1c1917', lineHeight: 1.4, marginBottom: 10 }}>
              The Quiet Revolution: How K-Culture Is Rewriting Hollywood's Playbook
            </div>
            <p style={{ fontSize: 12, color: '#78716c', lineHeight: 1.6, margin: 0 }}>
              Korean cultural exports have quietly dismantled the assumption that global entertainment flows in one direction, reshaping the grammar of global entertainment.
            </p>
          </div>

          {/* Vocabulary checklist */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: '18px', border: '1px solid #e7e5e4' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#a8a29e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Vocabulary ({usedWords.length}/{WORDS.length})</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {WORDS.map(w => {
                const used = usedWords.includes(w)
                return (
                  <div key={w} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, backgroundColor: used ? '#ecfdf5' : '#fafaf9', border: `1px solid ${used ? '#a7f3d0' : '#f5f5f4'}`, transition: 'all 0.2s' }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${used ? '#10b981' : '#d6d3d1'}`, backgroundColor: used ? '#10b981' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {used && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4l2 2 3-3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <span style={{ fontSize: 13, color: used ? '#059669' : '#a8a29e', fontWeight: used ? 600 : 400 }}>{w}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Writing guide */}
          <div style={{ backgroundColor: '#faf5ff', borderRadius: 16, padding: '18px', border: '1px solid #e9d5ff' }}>
            <div style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Writing Guide</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {GUIDE.map((q, i) => (
                <div key={i} style={{ fontSize: 12, color: '#6d28d9', lineHeight: 1.5, paddingLeft: 12, borderLeft: '2px solid #c4b5fd' }}>
                  {q}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Editor */}
        <div>
          <div style={{ backgroundColor: 'white', borderRadius: 20, border: '1px solid #e7e5e4', overflow: 'hidden' }}>
            {/* Editor header */}
            <div style={{ padding: '14px 24px', borderBottom: '1px solid #f5f5f4', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ display: 'flex', gap: 16, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#78716c' }}>Words:</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: wordCount >= 150 ? '#059669' : '#4f46e5' }}>{wordCount}</span>
                  <span style={{ fontSize: 11, color: '#c8c4c0' }}>/ 200+ recommended</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#78716c' }}>Vocab:</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: usedWords.length >= 5 ? '#059669' : '#4f46e5' }}>{usedWords.length}/{WORDS.length}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: saved ? '#10b981' : '#f59e0b' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: saved ? '#10b981' : '#f59e0b' }} />
                {saved ? 'Saved' : 'Saving...'}
              </div>
            </div>

            <div style={{ padding: '24px 28px' }}>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Reflection title..."
                style={{ width: '100%', fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 24, color: '#1c1917', border: 'none', outline: 'none', backgroundColor: 'transparent', marginBottom: 20, boxSizing: 'border-box' }}
              />
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Start writing your reflection... Try to use your vocabulary words naturally. Share your opinion about K-culture's global influence, whether you agree with the article's argument, and what this trend means for the future of entertainment."
                style={{ width: '100%', minHeight: 360, fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#1c1917', lineHeight: 1.85, border: 'none', outline: 'none', backgroundColor: 'transparent', resize: 'none', boxSizing: 'border-box' }}
              />

              {body.length > 50 && (
                <div style={{ marginTop: 16, padding: '14px 16px', backgroundColor: '#f5f5f4', borderRadius: 10, fontSize: 14, lineHeight: 1.85, color: '#292524' }}>
                  <div style={{ fontSize: 11, color: '#a8a29e', marginBottom: 6 }}>Preview with vocabulary highlighted:</div>
                  {highlightUsedInBody(body)}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 28px', borderTop: '1px solid #f5f5f4', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end' }}>
              <button onClick={saveDraft} style={{ padding: '10px 20px', borderRadius: 10, border: '1.5px solid #e7e5e4', backgroundColor: 'white', fontSize: 13, cursor: 'pointer', color: '#57534e' }}>
                Save Draft
              </button>
              <button onClick={() => setShowModal(true)} style={{ padding: '10px 24px', borderRadius: 10, backgroundColor: '#4f46e5', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                Submit Reflection →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ backgroundColor: 'white', borderRadius: 24, padding: '36px', maxWidth: 440, width: '90%', boxShadow: '0 24px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24 }}>📤</div>
              <h3 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 24, color: '#1c1917', margin: '0 0 10px' }}>Submit your reflection?</h3>
              <p style={{ fontSize: 14, color: '#78716c', lineHeight: 1.6, margin: 0 }}>
                Once submitted, AI will begin analyzing both reflections when your partner also submits. You'll be notified when comparison is ready.
              </p>
            </div>

            <div style={{ backgroundColor: '#fffbeb', borderRadius: 12, padding: '14px 16px', marginBottom: 24, border: '1px solid #fde68a' }}>
              <div style={{ fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span>⏳</span>
                <span>Jisoo hasn't submitted yet. You'll wait here until both reflections are ready for comparison.</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: '12px', borderRadius: 12, border: '1.5px solid #e7e5e4', backgroundColor: 'white', fontSize: 14, cursor: 'pointer', color: '#57534e' }}>
                Edit More
              </button>
              <button onClick={handleSubmit} style={{ flex: 1, padding: '12px', borderRadius: 12, backgroundColor: '#4f46e5', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
