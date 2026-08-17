import { useState } from 'react'
import type { Page } from '../App'

interface Props { setPage: (p: Page) => void }

type Tab = 'transcript' | 'grammar' | 'expressions' | 'vocabulary'

const TRANSCRIPT = [
  { speaker: 'A', time: '0:05', text: 'So, I think the main reason K-culture became so popular is because the quality was genuinely good. Like, Parasite wasn\'t successful just because of marketing — it was a masterpiece.', corrections: [] },
  { speaker: 'B', time: '1:12', text: 'I agree to some extent, but I think we should also consider the role of the government subsidies. Without those investment, the infrastructure couldn\'t have been built.', corrections: ['subsidies', 'those investment → that investment'] },
  { speaker: 'A', time: '2:30', text: 'That\'s fair. But does that mean the art is less authentic? I don\'t think government support automatically makes something less genuine.', corrections: [] },
  { speaker: 'B', time: '3:45', text: 'Not necessarily. But what concern me is that when you design culture for export, you risk losing the specific social critique that made it resonate in the first place.', corrections: ['what concern me → what concerns me'] },
  { speaker: 'A', time: '5:02', text: 'That\'s a really interesting point. I hadn\'t thought about the aesthetic laundering idea from this angle. Do you think Hollywood is guilty of this with their Korean remakes?', corrections: [] },
  { speaker: 'B', time: '6:18', text: 'Absolutely. They take the visual style but they remove the class commentary. Parasite worked in Korean because it spoke to very specific Korean anxieties about wealth gap.', corrections: ['about wealth gap → about the wealth gap'] },
]

const GRAMMAR_ISSUES = [
  { original: 'Without those investment, the infrastructure...', corrected: 'Without that investment, the infrastructure...', type: 'Article', reason: '\'Investment\'는 불가산 명사이므로 \'those\' 대신 \'that\'을 사용해야 합니다.', natural: 'Without sufficient investment in the sector, ...' },
  { original: 'what concern me is that...', corrected: 'what concerns me is that...', type: 'Tense', reason: '\'What\' 주어절에서 동사는 3인칭 단수 형태여야 합니다.', natural: 'My main concern is that...' },
  { original: 'about wealth gap', corrected: 'about the wealth gap', type: 'Article', reason: '특정 사회 현상을 지칭할 때 정관사 \'the\'가 필요합니다.', natural: 'about the growing wealth disparity' },
]

const EXPRESSIONS = [
  { original: 'the quality was genuinely good', natural: 'the quality genuinely stood out', explanation: '\'stand out\'은 특별히 뛰어나다는 뉘앙스를 더 잘 전달합니다.' },
  { original: 'I agree to some extent', natural: 'I\'d partially agree with that', explanation: '\'To some extent\'보다 더 자연스러운 표현입니다.' },
  { original: 'That\'s a really interesting point', natural: 'That\'s a compelling point, actually', explanation: '\'Compelling\'은 단순한 흥미보다 설득력 있다는 뉘앙스를 줍니다.' },
]

export default function SpeakingFeedbackPage({ setPage }: Props) {
  const [tab, setTab] = useState<Tab>('transcript')
  const [selected, setSelected] = useState<number | null>(null)
  const [saved, setSaved] = useState<Set<number>>(new Set())

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'transcript', label: 'Transcript' },
    { key: 'grammar', label: 'Grammar', count: GRAMMAR_ISSUES.length },
    { key: 'expressions', label: 'Natural Expressions', count: EXPRESSIONS.length },
    { key: 'vocabulary', label: 'Vocabulary' },
  ]

  return (
    <div style={{ paddingTop: 28 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { icon: '⏱️', val: '14:32', label: 'Duration' },
          { icon: '💬', val: '48', label: 'Utterances' },
          { icon: '📚', val: '6', label: 'Vocab Used' },
          { icon: '✏️', val: '3', label: 'Corrections', accent: '#ef4444', bg: '#fef2f2' },
          { icon: '✨', val: '3', label: 'Better Phrases', accent: '#7c3aed', bg: '#faf5ff' },
        ].map(s => (
          <div key={s.label} style={{ backgroundColor: s.bg || 'white', borderRadius: 16, padding: '18px 16px', textAlign: 'center', border: `1px solid ${s.accent ? s.accent + '25' : '#e7e5e4'}` }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 24, fontWeight: 700, color: s.accent || '#1c1917', marginBottom: 4 }}>{s.val}</div>
            <div style={{ fontSize: 12, color: '#78716c' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ backgroundColor: 'white', borderRadius: 20, border: '1px solid #e7e5e4', overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #f5f5f4', padding: '0 4px' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: tab === t.key ? 600 : 400, color: tab === t.key ? '#4f46e5' : '#78716c', borderBottom: `2.5px solid ${tab === t.key ? '#4f46e5' : 'transparent'}`, display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s', marginBottom: -1 }}>
              {t.label}
              {t.count && <span style={{ fontSize: 11, backgroundColor: tab === t.key ? '#eef2ff' : '#f5f5f4', color: tab === t.key ? '#4f46e5' : '#78716c', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>{t.count}</span>}
            </button>
          ))}
        </div>

        <div style={{ padding: '24px' }}>
          {tab === 'transcript' && (
            <div style={{ display: 'grid', gridTemplateColumns: selected !== null ? '1fr 360px' : '1fr', gap: 20, alignItems: 'start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {TRANSCRIPT.map((line, i) => {
                  const hasCorrections = line.corrections.length > 0
                  return (
                    <div key={i} onClick={() => hasCorrections && setSelected(selected === i ? null : i)} style={{ display: 'flex', gap: 12, padding: '14px', borderRadius: 12, backgroundColor: hasCorrections ? (selected === i ? '#fef2f2' : '#fff8f6') : '#f9f9f9', border: `1.5px solid ${hasCorrections ? (selected === i ? '#fca5a5' : '#fdd9cc') : 'transparent'}`, cursor: hasCorrections ? 'pointer' : 'default', transition: 'all 0.15s' }}>
                      <div style={{ flexShrink: 0 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: line.speaker === 'A' ? '#4f46e5' : '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 12, fontWeight: 700 }}>{line.speaker}</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 10, marginBottom: 5 }}>
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#a8a29e' }}>{line.time}</span>
                          {hasCorrections && <span style={{ fontSize: 10, color: '#ef4444', backgroundColor: '#fef2f2', padding: '1px 6px', borderRadius: 8, fontWeight: 600 }}>{line.corrections.length} correction{line.corrections.length > 1 ? 's' : ''}</span>}
                        </div>
                        <p style={{ fontSize: 14, color: '#1c1917', lineHeight: 1.7, margin: 0 }}>
                          {line.text}
                          {hasCorrections && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8, fontSize: 12, color: '#ef4444' }}>— click to see corrections ↗</span>}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {selected !== null && TRANSCRIPT[selected].corrections.length > 0 && (
                <div style={{ position: 'sticky', top: 130, backgroundColor: 'white', borderRadius: 16, border: '1.5px solid #fca5a5', padding: '18px', boxShadow: '0 4px 16px rgba(239,68,68,0.1)' }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, color: '#991b1b', margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    🔍 Corrections
                  </h4>
                  {GRAMMAR_ISSUES.slice(0, 1).map((g, i) => (
                    <div key={i} style={{ marginBottom: 16 }}>
                      <div style={{ padding: '10px 12px', backgroundColor: '#fef2f2', borderRadius: 8, marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 600, marginBottom: 3 }}>Original</div>
                        <div style={{ fontSize: 13, color: '#1c1917', textDecoration: 'line-through', opacity: 0.7 }}>"{g.original}"</div>
                      </div>
                      <div style={{ padding: '10px 12px', backgroundColor: '#ecfdf5', borderRadius: 8, marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: '#059669', fontWeight: 600, marginBottom: 3 }}>Corrected</div>
                        <div style={{ fontSize: 13, color: '#1c1917' }}>"{g.corrected}"</div>
                      </div>
                      <div style={{ padding: '10px 12px', backgroundColor: '#f0f9ff', borderRadius: 8, marginBottom: 10 }}>
                        <div style={{ fontSize: 11, color: '#0284c7', fontWeight: 600, marginBottom: 3 }}>More Natural</div>
                        <div style={{ fontSize: 13, color: '#1c1917' }}>"{g.natural}"</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#78716c', lineHeight: 1.6, padding: '8px 10px', backgroundColor: '#f5f5f4', borderRadius: 8, marginBottom: 10 }}>{g.reason}</div>
                      <span style={{ fontSize: 11, backgroundColor: '#dbeafe', color: '#1e40af', padding: '3px 10px', borderRadius: 20 }}>{g.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'grammar' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {GRAMMAR_ISSUES.map((g, i) => (
                <div key={i} style={{ borderRadius: 16, border: '1px solid #e7e5e4', overflow: 'hidden' }}>
                  <div style={{ padding: '14px 18px', backgroundColor: '#f5f5f4', borderBottom: '1px solid #e7e5e4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1c1917' }}>Correction #{i + 1}</span>
                    <span style={{ fontSize: 11, backgroundColor: '#dbeafe', color: '#1e40af', padding: '3px 10px', borderRadius: 20, fontWeight: 500 }}>{g.type}</span>
                  </div>
                  <div style={{ padding: '18px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, marginBottom: 8 }}>ORIGINAL</div>
                      <div style={{ padding: '10px 12px', backgroundColor: '#fef2f2', borderRadius: 8, fontSize: 13, color: '#991b1b', textDecoration: 'line-through' }}>"{g.original}"</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#10b981', fontWeight: 600, marginBottom: 8 }}>CORRECTED</div>
                      <div style={{ padding: '10px 12px', backgroundColor: '#ecfdf5', borderRadius: 8, fontSize: 13, color: '#065f46' }}>"{g.corrected}"</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#0284c7', fontWeight: 600, marginBottom: 8 }}>MORE NATURAL</div>
                      <div style={{ padding: '10px 12px', backgroundColor: '#f0f9ff', borderRadius: 8, fontSize: 13, color: '#0c4a6e' }}>"{g.natural}"</div>
                    </div>
                  </div>
                  <div style={{ padding: '0 18px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ flex: 1, fontSize: 12, color: '#78716c', lineHeight: 1.5, padding: '8px 12px', backgroundColor: '#f5f5f4', borderRadius: 8 }}>{g.reason}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #e7e5e4', backgroundColor: 'white', fontSize: 12, cursor: 'pointer', color: '#57534e' }}>🔊</button>
                      <button onClick={() => { const s = new Set(saved); s.add(i); setSaved(s) }} style={{ padding: '7px 14px', borderRadius: 8, backgroundColor: saved.has(i) ? '#ecfdf5' : '#4f46e5', color: saved.has(i) ? '#059669' : 'white', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                        {saved.has(i) ? '✓ Saved' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'expressions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {EXPRESSIONS.map((e, i) => (
                <div key={i} style={{ borderRadius: 14, border: '1px solid #e7e5e4', overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #f5f5f4' }}>
                    <div style={{ padding: '16px 18px', borderRight: '1px solid #f5f5f4' }}>
                      <div style={{ fontSize: 11, color: '#78716c', fontWeight: 600, marginBottom: 6 }}>YOU SAID</div>
                      <div style={{ fontSize: 14, color: '#44403c' }}>"{e.original}"</div>
                    </div>
                    <div style={{ padding: '16px 18px', backgroundColor: '#f0fdf4' }}>
                      <div style={{ fontSize: 11, color: '#059669', fontWeight: 600, marginBottom: 6 }}>MORE NATURAL</div>
                      <div style={{ fontSize: 14, color: '#1c1917', fontWeight: 500 }}>"{e.natural}"</div>
                    </div>
                  </div>
                  <div style={{ padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 12, color: '#78716c' }}>{e.explanation}</div>
                    <button style={{ padding: '6px 14px', borderRadius: 8, backgroundColor: '#4f46e5', color: 'white', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }}>Save</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'vocabulary' && (
            <div>
              <p style={{ fontSize: 14, color: '#78716c', marginBottom: 16 }}>You used <strong style={{ color: '#4f46e5' }}>6 out of 8</strong> vocabulary words in your discussion. Great job!</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {[
                  { word: 'harbinger', used: true },
                  { word: 'hallyu', used: true },
                  { word: 'ambivalent', used: true },
                  { word: 'subsidy', used: true },
                  { word: 'aesthetic', used: true },
                  { word: 'infrastructure', used: true },
                  { word: 'hegemony', used: false },
                  { word: 'meticulously', used: false },
                ].map(w => (
                  <div key={w.word} style={{ padding: '14px', borderRadius: 12, backgroundColor: w.used ? '#ecfdf5' : '#f5f5f4', border: `1.5px solid ${w.used ? '#a7f3d0' : '#e7e5e4'}`, textAlign: 'center' }}>
                    <div style={{ fontSize: 16, marginBottom: 6 }}>{w.used ? '✅' : '⬜'}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: w.used ? '#065f46' : '#a8a29e' }}>{w.word}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <button style={{ padding: '11px 20px', borderRadius: 10, border: '1.5px solid #e7e5e4', backgroundColor: 'white', fontSize: 13, cursor: 'pointer', color: '#57534e' }}>
            Review Saved Expressions
          </button>
          <button onClick={() => setPage('dashboard')} style={{ padding: '11px 20px', borderRadius: 10, border: '1.5px solid #e7e5e4', backgroundColor: 'white', fontSize: 13, cursor: 'pointer', color: '#57534e' }}>
            ← Back to Dashboard
          </button>
        </div>
        <button style={{ padding: '13px 28px', borderRadius: 12, backgroundColor: '#10b981', color: 'white', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          🎉 Mark Today Complete
        </button>
      </div>
    </div>
  )
}
