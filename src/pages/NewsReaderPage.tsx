import { useState } from 'react'
import type { Page } from '../App'

interface Props { setPage: (p: Page) => void }

const ARTICLE_PARAGRAPHS = [
  { id: 'p1', text: "When Bong Joon-ho clutched his Oscars in 2020, many in the entertainment industry treated it as a pleasant anomaly — a foreign film that somehow broke through. Five years later, it is clear that Parasite was not a fluke but a harbinger. Korean pop culture has not merely found an international audience; it has begun to reshape the very grammar of global entertainment." },
  { id: 'p2', text: "The phenomenon is sometimes reduced to the K-pop fandom, with its elaborate fan culture, meticulously choreographed performances, and algorithmic mastery of YouTube and TikTok. But the Korean wave — known domestically as hallyu — runs far deeper. Korean cinema, television dramas, fashion, food, and even language learning have all surged in global popularity over the past decade, creating an ecosystem of cultural influence that rivals, and in some demographics surpasses, that of Hollywood." },
  { id: 'p3', text: "The success is no accident. The Korean government began investing in its cultural industries as a deliberate economic strategy following the 1997 Asian financial crisis. What followed was a systematic cultivation of creative infrastructure: subsidies for film schools, export incentives for production companies, and diplomatic soft power deployed through cultural centers worldwide. The result is an industry that blends genuine artistic ambition with extraordinary commercial discipline." },
  { id: 'p4', text: "Hollywood's response has been characteristically ambivalent. Studios have hired Korean directors, acquired remake rights to popular dramas, and begun casting Korean actors in major productions. Yet the deeper challenge — whether Western studios can genuinely absorb Korean storytelling sensibilities rather than merely appropriating their surface aesthetics — remains unresolved. The risk is what some scholars call aesthetic laundering: taking the visual vocabulary of a foreign culture while stripping it of the specific social critique that made it resonate." },
]

type SavedWord = { word: string; pos: string; def: string; kr: string; sentence: string }

const VOCAB_POPUP: Record<string, SavedWord> = {
  hallyu: { word: 'hallyu', pos: 'noun', def: 'The spread of South Korean culture globally', kr: '한류 (韓流)', sentence: 'The Korean wave — known domestically as hallyu — runs far deeper.' },
  harbinger: { word: 'harbinger', pos: 'noun', def: 'A person or thing that signals the approach of another', kr: '선구자, 전조', sentence: 'Parasite was not a fluke but a harbinger.' },
  ambivalent: { word: 'ambivalent', pos: 'adjective', def: 'Having mixed feelings or contradictory ideas about something', kr: '양가적인, 모호한', sentence: "Hollywood's response has been characteristically ambivalent." },
  subsidy: { word: 'subsidy', pos: 'noun', def: 'A sum of money granted by the government to assist an industry', kr: '보조금, 장려금', sentence: 'Subsidies for film schools, export incentives for production companies.' },
}

export default function NewsReaderPage({ setPage }: Props) {
  const [savedWords, setSavedWords] = useState<SavedWord[]>([
    { word: 'harbinger', pos: 'noun', def: 'A person or thing that signals the approach of another', kr: '선구자, 전조', sentence: 'Parasite was not a fluke but a harbinger.' },
    { word: 'hallyu', pos: 'noun', def: 'The spread of South Korean culture globally', kr: '한류 (韓流)', sentence: 'The Korean wave — known domestically as hallyu — runs far deeper.' },
  ])
  const [popup, setPopup] = useState<{ word: SavedWord; x: number; y: number } | null>(null)

  const handleWordClick = (word: string, e: React.MouseEvent) => {
    const lower = word.toLowerCase().replace(/[^a-z]/g, '')
    if (VOCAB_POPUP[lower]) {
      setPopup({ word: VOCAB_POPUP[lower], x: e.clientX, y: e.clientY })
    }
  }

  const addWord = (w: SavedWord) => {
    if (!savedWords.find(s => s.word === w.word)) {
      setSavedWords([...savedWords, w])
    }
    setPopup(null)
  }

  const isSaved = (word: string) => savedWords.some(s => s.word === word)

  const highlightText = (text: string) => {
    const clickableWords = Object.keys(VOCAB_POPUP)
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

  return (
    <div style={{ paddingTop: 28 }} onClick={() => setPopup(null)}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28, alignItems: 'start' }}>
        {/* Article */}
        <div>
          <div style={{ backgroundColor: 'white', borderRadius: 20, overflow: 'hidden', border: '1px solid #e7e5e4' }}>
            <div style={{ position: 'relative', height: 280, background: '#0f172a' }}>
              <img src="https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=900&h=400&fit=crop&auto=format" alt="Korean culture" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 50%)' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 32px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, backgroundColor: '#4f46e5', color: 'white', padding: '4px 10px', borderRadius: 20 }}>Culture</span>
                  <span style={{ fontSize: 11, backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '4px 10px', borderRadius: 20 }}>Thursday</span>
                </div>
                <h1 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 28, color: 'white', margin: 0, lineHeight: 1.3 }}>
                  The Quiet Revolution: How K-Culture Is Rewriting Hollywood's Playbook
                </h1>
              </div>
            </div>

            <div style={{ padding: '22px 32px 32px' }}>
              <div style={{ display: 'flex', gap: 20, marginBottom: 22, paddingBottom: 18, borderBottom: '1px solid #f5f5f4' }}>
                {[
                  { label: 'The Atlantic', icon: '📰' },
                  { label: 'Eleanor Park', icon: '✍️' },
                  { label: 'August 14, 2025', icon: '📅' },
                  { label: '6 min read', icon: '🕐' },
                  { label: 'Intermediate', icon: '📊' },
                ].map(m => (
                  <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#78716c' }}>
                    <span>{m.icon}</span><span>{m.label}</span>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 15, color: '#292524', lineHeight: 1.85, fontWeight: 400 }}>
                {ARTICLE_PARAGRAPHS.map((p, i) => (
                  <p key={p.id} style={{ margin: '0 0 20px' }}>
                    {highlightText(p.text)}
                  </p>
                ))}

                <div style={{ padding: '16px 20px', borderLeft: '3px solid #4f46e5', backgroundColor: '#eef2ff', borderRadius: '0 10px 10px 0', margin: '24px 0', fontStyle: 'italic', color: '#3730a3', fontSize: 15 }}>
                  "The risk is what some scholars call aesthetic laundering: taking the visual vocabulary of a foreign culture while stripping it of the specific social critique that made it resonate."
                </div>

                <p style={{ margin: 0, color: '#78716c', fontSize: 13 }}>
                  Source: <a href="#" style={{ color: '#4f46e5' }}>The Atlantic — Original Article ↗</a>
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
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: savedWords.length >= 15 ? '#10b981' : '#4f46e5', backgroundColor: savedWords.length >= 15 ? '#ecfdf5' : '#eef2ff', padding: '3px 10px', borderRadius: 20 }}>
                {savedWords.length}/15
              </span>
            </div>

            {/* Progress bar */}
            <div style={{ height: 5, backgroundColor: '#f5f5f4', borderRadius: 4, marginBottom: 18 }}>
              <div style={{ height: '100%', borderRadius: 4, backgroundColor: savedWords.length >= 15 ? '#10b981' : '#4f46e5', width: `${Math.min((savedWords.length / 15) * 100, 100)}%`, transition: 'width 0.3s' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', marginBottom: 18 }}>
              {savedWords.map(w => (
                <div key={w.word} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', backgroundColor: '#f5f5f4', borderRadius: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1917' }}>{w.word}</div>
                    <div style={{ fontSize: 11, color: '#78716c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.kr}</div>
                  </div>
                  <span style={{ fontSize: 10, color: '#78716c', backgroundColor: '#e7e5e4', padding: '2px 6px', borderRadius: 6 }}>{w.pos}</span>
                </div>
              ))}
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
              disabled={savedWords.length < 10}
              style={{ width: '100%', padding: '12px', borderRadius: 12, backgroundColor: savedWords.length >= 10 ? '#4f46e5' : '#e7e5e4', color: savedWords.length >= 10 ? 'white' : '#a8a29e', fontSize: 14, fontWeight: 600, border: 'none', cursor: savedWords.length >= 10 ? 'pointer' : 'not-allowed' }}>
              Continue to Vocabulary →
            </button>
            {savedWords.length < 10 && (
              <p style={{ textAlign: 'center', fontSize: 11, color: '#a8a29e', marginTop: 8, margin: '8px 0 0' }}>
                Add {10 - savedWords.length} more words to continue
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
            position: 'fixed', left: Math.min(popup.x - 10, window.innerWidth - 320), top: popup.y + 12,
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
