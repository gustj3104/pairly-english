import { useState } from 'react'
import type { Page } from '../App'

interface Props { setPage: (p: Page) => void }

type Tab = 'records' | 'vocabulary' | 'corrections'

const RECORDS = [
  { date: 'Aug 14', topic: 'Culture', article: 'The Quiet Revolution: How K-Culture Is Rewriting Hollywood\'s Playbook', words: 8, discussed: false, today: true },
  { date: 'Aug 13', topic: 'Business', article: "The Startup Graveyard: What 2025's Funding Winter Means for Innovation", words: 14, discussed: false },
  { date: 'Aug 12', topic: 'Society', article: 'Urban Loneliness: Why Young Professionals Feel More Isolated Than Ever', words: 12, discussed: true },
  { date: 'Aug 11', topic: 'Technology', article: 'AI Systems Are Now Writing More Code Than Human Developers', words: 15, discussed: true },
]

const VOCAB = [
  { word: 'harbinger', kr: '선구자, 전조', pos: 'noun', date: 'Aug 14', source: 'Culture' },
  { word: 'hallyu', kr: '한류', pos: 'noun', date: 'Aug 14', source: 'Culture' },
  { word: 'ambivalent', kr: '양가적인', pos: 'adj', date: 'Aug 14', source: 'Culture' },
  { word: 'paradigm shift', kr: '패러다임 전환', pos: 'noun', date: 'Aug 13', source: 'Business' },
  { word: 'venture capital', kr: '벤처 캐피탈', pos: 'noun', date: 'Aug 13', source: 'Business' },
  { word: 'pervasive', kr: '만연한, 퍼져있는', pos: 'adj', date: 'Aug 12', source: 'Society' },
  { word: 'exacerbate', kr: '악화시키다', pos: 'verb', date: 'Aug 12', source: 'Society' },
  { word: 'unprecedented', kr: '전례 없는', pos: 'adj', date: 'Aug 11', source: 'Technology' },
]

const CORRECTIONS = [
  { original: 'Without those investment', corrected: 'Without that investment', type: 'Article', date: 'Aug 14' },
  { original: 'what concern me is', corrected: 'what concerns me is', type: 'Subject-Verb', date: 'Aug 14' },
  { original: 'about wealth gap', corrected: 'about the wealth gap', type: 'Article', date: 'Aug 14' },
  { original: 'more easier', corrected: 'easier', type: 'Comparative', date: 'Aug 12' },
  { original: 'I have lived here since 3 years', corrected: 'I have lived here for 3 years', type: 'Preposition', date: 'Aug 12' },
]

export default function ReviewPage({ setPage }: Props) {
  const [tab, setTab] = useState<Tab>('records')
  const [search, setSearch] = useState('')

  const filteredVocab = VOCAB.filter(v => v.word.includes(search.toLowerCase()) || v.kr.includes(search))

  return (
    <div style={{ paddingTop: 32 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 30, color: '#1c1917', margin: '0 0 6px' }}>Review Archive</h1>
        <p style={{ color: '#78716c', fontSize: 15, margin: 0 }}>Your complete learning history with Jisoo.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, backgroundColor: '#f5f5f4', borderRadius: 12, padding: 4, marginBottom: 24, width: 'fit-content' }}>
        {([
          { key: 'records', label: '📋 Learning Records' },
          { key: 'vocabulary', label: '📚 Vocabulary Bank' },
          { key: 'corrections', label: '✏️ Saved Corrections' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '9px 20px', borderRadius: 9, backgroundColor: tab === t.key ? 'white' : 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.key ? 600 : 400, color: tab === t.key ? '#1c1917' : '#78716c', boxShadow: tab === t.key ? '0 1px 6px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'records' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {RECORDS.map((r, i) => (
            <div key={i} style={{ backgroundColor: 'white', borderRadius: 18, padding: '22px 24px', border: `1.5px solid ${r.today ? '#4f46e5' : '#e7e5e4'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: '#a8a29e' }}>{r.date}</span>
                    <span style={{ fontSize: 11, backgroundColor: '#eef2ff', color: '#4f46e5', padding: '2px 8px', borderRadius: 10 }}>{r.topic}</span>
                    {r.today && <span style={{ fontSize: 11, backgroundColor: '#4f46e5', color: 'white', padding: '2px 8px', borderRadius: 10 }}>In Progress</span>}
                  </div>
                  <h3 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 18, color: '#1c1917', margin: 0 }}>{r.article}</h3>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {[
                  { label: 'Words', val: `${r.words} saved`, done: r.words > 0 },
                  { label: 'Discussion', val: r.discussed ? 'Completed' : 'Not yet', done: r.discussed },
                  { label: 'Reflection', val: 'Submitted', done: true },
                ].map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, backgroundColor: s.done ? '#ecfdf5' : '#f5f5f4', border: `1px solid ${s.done ? '#a7f3d0' : '#e7e5e4'}` }}>
                    <span style={{ fontSize: 12 }}>{s.done ? '✓' : '○'}</span>
                    <span style={{ fontSize: 12, color: s.done ? '#059669' : '#a8a29e', fontWeight: 500 }}>{s.label}: {s.val}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'vocabulary' && (
        <div>
          <div style={{ marginBottom: 20 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search words..." style={{ width: '100%', maxWidth: 360, padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e7e5e4', fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {filteredVocab.map(v => (
              <div key={v.word} style={{ backgroundColor: 'white', borderRadius: 14, padding: '16px', border: '1px solid #e7e5e4' }}>
                <div style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 18, color: '#1c1917', marginBottom: 6 }}>{v.word}</div>
                <div style={{ fontSize: 13, color: '#4f46e5', marginBottom: 10 }}>{v.kr}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, backgroundColor: '#eef2ff', color: '#4f46e5', padding: '2px 7px', borderRadius: 8 }}>{v.pos}</span>
                  <span style={{ fontSize: 10, backgroundColor: '#f5f5f4', color: '#78716c', padding: '2px 7px', borderRadius: 8 }}>{v.source}</span>
                  <span style={{ fontSize: 10, backgroundColor: '#f5f5f4', color: '#a8a29e', padding: '2px 7px', borderRadius: 8 }}>{v.date}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: '#a8a29e' }}>Showing {filteredVocab.length} of {VOCAB.length} saved words</div>
        </div>
      )}

      {tab === 'corrections' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {CORRECTIONS.map((c, i) => (
            <div key={i} style={{ backgroundColor: 'white', borderRadius: 14, padding: '18px 20px', border: '1px solid #e7e5e4', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#a8a29e', flexShrink: 0, width: 52 }}>{c.date}</div>
              <div style={{ flex: 1, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                <div style={{ padding: '7px 12px', backgroundColor: '#fef2f2', borderRadius: 8, fontSize: 13, color: '#991b1b', textDecoration: 'line-through' }}>"{c.original}"</div>
                <span style={{ color: '#a8a29e', fontSize: 16 }}>→</span>
                <div style={{ padding: '7px 12px', backgroundColor: '#ecfdf5', borderRadius: 8, fontSize: 13, color: '#065f46', fontWeight: 500 }}>"{c.corrected}"</div>
              </div>
              <span style={{ fontSize: 11, backgroundColor: '#dbeafe', color: '#1e40af', padding: '4px 10px', borderRadius: 20, fontWeight: 500, flexShrink: 0 }}>{c.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
