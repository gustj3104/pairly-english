import { useState } from 'react'
import type { Page } from '../App'

interface Props { setPage: (p: Page) => void }

const TOPICS = [
  {
    q: 'Is K-culture\'s global rise a result of genuine artistic quality, or primarily effective marketing strategy?',
    reason: 'Both reflections touch on this tension differently — Hyunji emphasized artistic merit, while Jisoo focused on systematic commercial strategy.',
    difficulty: 'Intermediate',
  },
  {
    q: 'Should governments subsidize cultural industries as a form of soft power? What are the risks?',
    reason: 'Jisoo\'s reflection raised concerns about government-directed art losing authenticity. Hyunji suggested economic benefits outweigh the risks.',
    difficulty: 'Advanced',
  },
  {
    q: 'Does the global popularity of Korean culture challenge Western cultural hegemony, or simply add to it?',
    reason: 'A direct extension of the "aesthetic laundering" concept in the article — both writers engaged with this idea from different angles.',
    difficulty: 'Advanced',
  },
]

export default function AIComparisonPage({ setPage }: Props) {
  const [loading, setLoading] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState<number | null>(null)

  return (
    <div style={{ paddingTop: 28 }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 14px', borderRadius: 20, backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', marginBottom: 16 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981' }} />
          <span style={{ fontSize: 12, color: '#059669', fontWeight: 500 }}>AI Analysis Complete</span>
        </div>
        <h1 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 34, color: '#1c1917', margin: '0 0 10px' }}>
          You read the same story differently.
        </h1>
        <p style={{ color: '#78716c', fontSize: 15, margin: '0 0 20px' }}>
          AI compared both reflections to find common ground and diverging perspectives.
        </p>

        {/* Pair display */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 16, padding: '14px 24px', backgroundColor: 'white', borderRadius: 20, border: '1px solid #e7e5e4' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700 }}>HJ</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1917' }}>Hyunji</div>
              <div style={{ fontSize: 11, color: '#4f46e5' }}>Me · 243 words</div>
            </div>
          </div>
          <span style={{ fontSize: 18, color: '#d6d3d1' }}>vs</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700 }}>J</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1917' }}>Jisoo</div>
              <div style={{ fontSize: 11, color: '#10b981' }}>Partner · 198 words</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: '#a8a29e' }}>
          ℹ️ AI analysis compares perspectives in the texts — not a factual verdict on either view.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        {/* Common Ground */}
        <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '24px', border: '1px solid #e7e5e4', gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🤝</div>
            <div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1c1917', margin: 0 }}>Common Ground</h3>
              <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>Points both reflections agreed on</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {[
              { point: 'Korean culture\'s global rise is unprecedented and historically significant', hj: '"...Parasite was not a fluke but a harbinger of something larger that was already in motion."', js: '"The scale of hallyu in 2025 is something that scholars predicted but few believed would happen this quickly."' },
              { point: 'Government investment played a key role in building the cultural infrastructure', hj: '"...systematic subsidies created the conditions for both artistic ambition and commercial discipline."', js: '"The 1997 financial crisis paradoxically created the foundation for Korean soft power — necessity driving innovation."' },
            ].map((item, i) => (
              <div key={i} style={{ padding: '16px', backgroundColor: '#f0fdf4', borderRadius: 14, border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#166534', lineHeight: 1.5, marginBottom: 14 }}>{item.point}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ padding: '10px 12px', backgroundColor: 'rgba(79,70,229,0.08)', borderRadius: 10, borderLeft: '3px solid #4f46e5' }}>
                    <div style={{ fontSize: 10, color: '#4f46e5', fontWeight: 600, marginBottom: 4 }}>HYUNJI</div>
                    <div style={{ fontSize: 12, color: '#44403c', fontStyle: 'italic', lineHeight: 1.5 }}>{item.hj}</div>
                  </div>
                  <div style={{ padding: '10px 12px', backgroundColor: 'rgba(16,185,129,0.08)', borderRadius: 10, borderLeft: '3px solid #10b981' }}>
                    <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600, marginBottom: 4 }}>JISOO</div>
                    <div style={{ fontSize: 12, color: '#44403c', fontStyle: 'italic', lineHeight: 1.5 }}>{item.js}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Different Perspectives */}
        <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '24px', border: '1px solid #e7e5e4', gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>⚡</div>
            <div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1c1917', margin: 0 }}>Different Perspectives</h3>
              <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>Where your views diverged</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {[
              {
                topic: 'Hollywood\'s response to K-culture',
                hj: { stance: 'Cautiously optimistic', quote: '"The hiring of Korean directors suggests genuine openness — Hollywood can learn from a different storytelling tradition."' },
                js: { stance: 'Skeptical', quote: '"Studios are appropriating the surface aesthetics of K-culture without engaging with its social critique — classic aesthetic laundering."' },
              },
              {
                topic: 'The role of government in cultural production',
                hj: { stance: 'Supportive', quote: '"Strategic investment in creative industries is legitimate soft power — economic success validates the approach."' },
                js: { stance: 'Concerned', quote: '"When governments systematically cultivate culture for export, there is a risk of homogenizing art to fit marketable narratives."' },
              },
            ].map((item, i) => (
              <div key={i} style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid #e7e5e4' }}>
                <div style={{ padding: '12px 16px', backgroundColor: '#f5f5f4', borderBottom: '1px solid #e7e5e4' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1917' }}>{item.topic}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <div style={{ padding: '14px', borderRight: '1px solid #f5f5f4' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#4f46e5', marginTop: 3 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5' }}>HYUNJI · {item.hj.stance}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#57534e', fontStyle: 'italic', lineHeight: 1.6 }}>{item.hj.quote}</div>
                  </div>
                  <div style={{ padding: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981', marginTop: 3 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981' }}>JISOO · {item.js.stance}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#57534e', fontStyle: 'italic', lineHeight: 1.6 }}>{item.js.quote}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Discussion Topics */}
      <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '24px 28px', border: '1px solid #e7e5e4' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>💬</div>
          <div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1c1917', margin: 0 }}>Questions Worth Discussing</h3>
            <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>Choose one topic to discuss in English</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {TOPICS.map((t, i) => (
            <div key={i} onClick={() => setSelectedTopic(selectedTopic === i ? null : i)} style={{ borderRadius: 14, border: `2px solid ${selectedTopic === i ? '#4f46e5' : '#e7e5e4'}`, backgroundColor: selectedTopic === i ? '#f5f3ff' : 'white', cursor: 'pointer', overflow: 'hidden', transition: 'all 0.2s' }}>
              <div style={{ padding: '18px 20px', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: selectedTopic === i ? '#4f46e5' : '#f5f5f4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: selectedTopic === i ? 'white' : '#78716c', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#1c1917', lineHeight: 1.5, marginBottom: 8 }}>{t.q}</div>
                  <div style={{ fontSize: 12, color: '#78716c', lineHeight: 1.5, marginBottom: 10 }}>{t.reason}</div>
                  <span style={{ fontSize: 11, backgroundColor: t.difficulty === 'Advanced' ? '#fef3c7' : '#dbeafe', color: t.difficulty === 'Advanced' ? '#92400e' : '#1e40af', padding: '3px 10px', borderRadius: 20, fontWeight: 500 }}>
                    {t.difficulty}
                  </span>
                </div>
                {selectedTopic === i && (
                  <div style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => selectedTopic !== null && setPage('discussion')} disabled={selectedTopic === null} style={{ padding: '13px 32px', borderRadius: 12, backgroundColor: selectedTopic !== null ? '#4f46e5' : '#e7e5e4', color: selectedTopic !== null ? 'white' : '#a8a29e', fontSize: 14, fontWeight: 600, border: 'none', cursor: selectedTopic !== null ? 'pointer' : 'not-allowed' }}>
            Start Discussion →
          </button>
        </div>
      </div>
    </div>
  )
}
