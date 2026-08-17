import { useEffect, useState } from 'react'
import type { Page } from '../App'
import { useLearning } from '../state/LearningContext'
import { newsService } from '../services'
import { findVocabWord, getVocabGoals, type Article, type VocabWord } from '../services/mockNewsService'

interface Props { setPage: (p: Page) => void }

export default function NewsReaderPage({ setPage }: Props) {
  const { state, update } = useLearning()
  const savedWords = state.vocabulary.savedWords
  const [article, setArticle] = useState<Article | null>(null)
  const [popup, setPopup] = useState<{ word: VocabWord; x: number; y: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    newsService.getTodayArticle().then(a => { if (!cancelled) setArticle(a) })
    return () => { cancelled = true }
  }, [])

  const clickableWords = article ? article.vocabulary.map(w => w.word) : []
  const goals = article ? getVocabGoals(article) : { total: 0, selectGoal: 0, memorizeGoal: 0, reflectionUseGoal: 0 }

  const handleWordClick = (word: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!article) return
    const found = findVocabWord(article.vocabulary, word)
    if (found) {
      setPopup({ word: found, x: e.clientX, y: e.clientY })
    }
  }

  const isSaved = (word: string) => savedWords.includes(word)

  const addWord = (w: VocabWord) => {
    if (!isSaved(w.word)) {
      update({ vocabulary: { ...state.vocabulary, savedWords: [...savedWords, w.word] } })
    }
    setPopup(null)
  }

  const highlightText = (text: string) => {
    const words = text.split(/(\s+|[,.:;!?—–])/)
    return words.map((w, i) => {
      const lower = w.toLowerCase().replace(/[^a-z]/g, '')
      if (clickableWords.includes(lower)) {
        const saved = isSaved(lower)
        return (
          <span key={i} onClick={e => handleWordClick(w, e)} style={{ cursor: 'pointer', backgroundColor: saved ? '#e0e7ff' : '#fef9c3', borderRadius: 3, padding: '1px 2px', fontWeight: saved ? 500 : undefined, color: saved ? '#4338ca' : undefined, transition: 'background 0.2s' }}>
            {w}
          </span>
        )
      }
      return <span key={i}>{w}</span>
    })
  }

  if (!article) {
    return (
      <div style={{ paddingTop: 28, display: 'flex', justifyContent: 'center', minHeight: 300, alignItems: 'center' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid #e7e5e4', borderTopColor: '#4f46e5', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ paddingTop: 28 }} onClick={() => setPopup(null)}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28, alignItems: 'start' }}>
        {/* Article */}
        <div>
          <div style={{ backgroundColor: 'white', borderRadius: 20, overflow: 'hidden', border: '1px solid #e7e5e4' }}>
            <div style={{ position: 'relative', height: 280, background: '#0f172a' }}>
              <img src={article.imageUrl} alt={article.topic} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 50%)' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 32px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, backgroundColor: '#4f46e5', color: 'white', padding: '4px 10px', borderRadius: 20 }}>{article.topic}</span>
                  <span style={{ fontSize: 11, backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '4px 10px', borderRadius: 20 }}>Thursday</span>
                </div>
                <h1 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 28, color: 'white', margin: 0, lineHeight: 1.3 }}>
                  {article.title}
                </h1>
              </div>
            </div>

            <div style={{ padding: '22px 32px 32px' }}>
              <div style={{ display: 'flex', gap: 20, marginBottom: 22, paddingBottom: 18, borderBottom: '1px solid #f5f5f4' }}>
                {[
                  { label: article.source, icon: '📰' },
                  { label: article.author, icon: '✍️' },
                  { label: article.date, icon: '📅' },
                  { label: article.readTime, icon: '🕐' },
                  { label: article.level, icon: '📊' },
                ].map(m => (
                  <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#78716c' }}>
                    <span>{m.icon}</span><span>{m.label}</span>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 15, color: '#292524', lineHeight: 1.85, fontWeight: 400 }}>
                {article.paragraphs.map(p => (
                  <p key={p.id} style={{ margin: '0 0 20px' }}>
                    {highlightText(p.text)}
                  </p>
                ))}

                <div style={{ padding: '16px 20px', borderLeft: '3px solid #4f46e5', backgroundColor: '#eef2ff', borderRadius: '0 10px 10px 0', margin: '24px 0', fontStyle: 'italic', color: '#3730a3', fontSize: 15 }}>
                  "The risk is what some scholars call aesthetic laundering: taking the visual vocabulary of a foreign culture while stripping it of the specific social critique that made it resonate."
                </div>

                <p style={{ margin: 0, color: '#78716c', fontSize: 13 }}>
                  Source: <a href="#" style={{ color: '#4f46e5' }}>{article.source} — Original Article ↗</a>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Vocabulary Panel */}
        <div style={{ position: 'sticky', top: 130 }}>
          <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '22px', border: '1px solid #e7e5e4', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', margin: 0 }}>My Vocabulary</h3>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: savedWords.length >= goals.total ? '#10b981' : '#4f46e5', backgroundColor: savedWords.length >= goals.total ? '#ecfdf5' : '#eef2ff', padding: '3px 10px', borderRadius: 20 }}>
                {savedWords.length}/{goals.total}
              </span>
            </div>

            {/* Progress bar */}
            <div style={{ height: 5, backgroundColor: '#f5f5f4', borderRadius: 4, marginBottom: 18 }}>
              <div style={{ height: '100%', borderRadius: 4, backgroundColor: savedWords.length >= goals.total ? '#10b981' : '#4f46e5', width: `${Math.min((savedWords.length / goals.total) * 100, 100)}%`, transition: 'width 0.3s' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', marginBottom: 18 }}>
              {savedWords.map(word => {
                const w = findVocabWord(article.vocabulary, word)
                if (!w) return null
                return (
                  <div key={w.word} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', backgroundColor: '#f5f5f4', borderRadius: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1917' }}>{w.word}</div>
                      <div style={{ fontSize: 11, color: '#78716c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.kr}</div>
                    </div>
                    <span style={{ fontSize: 10, color: '#78716c', backgroundColor: '#e7e5e4', padding: '2px 6px', borderRadius: 6 }}>{w.pos}</span>
                  </div>
                )
              })}
              {savedWords.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px', color: '#a8a29e', fontSize: 13 }}>
                  Click highlighted words to add them
                </div>
              )}
            </div>

            <div style={{ padding: '12px', backgroundColor: '#f0f9ff', borderRadius: 10, marginBottom: 16, fontSize: 12, color: '#0369a1', lineHeight: 1.5 }}>
              💡 Click <span style={{ backgroundColor: '#fef9c3', padding: '1px 4px', borderRadius: 3 }}>highlighted words</span> to see definitions and add to vocabulary.
            </div>

            <button
              onClick={() => setPage('vocabulary')}
              disabled={savedWords.length < goals.selectGoal}
              style={{ width: '100%', padding: '12px', borderRadius: 12, backgroundColor: savedWords.length >= goals.selectGoal ? '#4f46e5' : '#e7e5e4', color: savedWords.length >= goals.selectGoal ? 'white' : '#a8a29e', fontSize: 14, fontWeight: 600, border: 'none', cursor: savedWords.length >= goals.selectGoal ? 'pointer' : 'not-allowed' }}>
              Continue to Vocabulary →
            </button>
            {savedWords.length < goals.selectGoal && (
              <p style={{ textAlign: 'center', fontSize: 11, color: '#a8a29e', marginTop: 8, margin: '8px 0 0' }}>
                Add {goals.selectGoal - savedWords.length} more words to continue
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Word popup */}
      {popup && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: Math.min(popup.x - 10, window.innerWidth - 320), top: Math.min(popup.y + 12, window.innerHeight - 280),
            width: 300, backgroundColor: 'white', borderRadius: 16, padding: 20, boxShadow: '0 16px 48px rgba(0,0,0,0.18)', border: '1px solid #e7e5e4', zIndex: 100,
          }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 22, color: '#1c1917' }}>{popup.word.word}</div>
              <span style={{ fontSize: 11, backgroundColor: '#eef2ff', color: '#4f46e5', padding: '2px 8px', borderRadius: 10 }}>{popup.word.pos}</span>
            </div>
            <button onClick={() => setPopup(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a8a29e', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: 13, color: '#44403c', marginBottom: 6, lineHeight: 1.5 }}>{popup.word.def}</div>
          <div style={{ fontSize: 13, color: '#78716c', marginBottom: 10, padding: '6px 10px', backgroundColor: '#f5f5f4', borderRadius: 8 }}>{popup.word.kr}</div>
          <div style={{ fontSize: 12, color: '#78716c', fontStyle: 'italic', marginBottom: 14, lineHeight: 1.5 }}>"{popup.word.sentence}"</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e7e5e4', backgroundColor: 'white', fontSize: 12, cursor: 'pointer', color: '#57534e' }}>🔊</button>
            <button
              onClick={() => addWord(popup.word)}
              disabled={isSaved(popup.word.word)}
              style={{ flex: 1, padding: '8px', borderRadius: 8, backgroundColor: isSaved(popup.word.word) ? '#ecfdf5' : '#4f46e5', color: isSaved(popup.word.word) ? '#10b981' : 'white', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              {isSaved(popup.word.word) ? '✓ Saved' : '+ Add to Vocabulary'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
