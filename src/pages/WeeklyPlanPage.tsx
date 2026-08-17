import type { Page } from '../App'

interface Props { setPage: (p: Page) => void }

const WEEK_DATA = [
  { day: 'Monday', date: 'Aug 11', topic: 'Technology', article: 'AI Systems Are Now Writing More Code Than Human Developers', me: true, partner: true, step: 'Completed', words: 15, discussed: true },
  { day: 'Tuesday', date: 'Aug 12', topic: 'Society', article: 'Urban Loneliness: Why Young Professionals Feel More Isolated Than Ever', me: true, partner: true, step: 'Completed', words: 12, discussed: true },
  { day: 'Wednesday', date: 'Aug 13', topic: 'Business', article: 'The Startup Graveyard: What 2025\'s Funding Winter Means for Innovation', me: true, partner: false, step: 'Completed', words: 14, discussed: false },
  { day: 'Thursday', date: 'Aug 14', topic: 'Culture', article: 'The Quiet Revolution: How K-Culture Is Rewriting Hollywood\'s Playbook', me: false, partner: false, step: 'In Progress', words: 8, discussed: false, today: true },
  { day: 'Friday', date: 'Aug 15', topic: 'Environment', article: null, me: false, partner: false, step: 'Locked', words: 0, discussed: false },
]

const STATS = [
  { label: 'Articles Read', val: '3', icon: '📰' },
  { label: 'Words Learned', val: '41', icon: '📚' },
  { label: 'Reflections Written', val: '3', icon: '✍️' },
  { label: 'Discussion Time', val: '37 min', icon: '🎙️' },
  { label: 'Day Streak', val: '12', icon: '🔥' },
]

export default function WeeklyPlanPage({ setPage }: Props) {
  return (
    <div style={{ paddingTop: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 30, color: '#1c1917', margin: '0 0 6px' }}>Weekly Plan</h1>
          <p style={{ color: '#78716c', fontSize: 15, margin: 0 }}>August 11–17, 2025</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ padding: '8px 14px', borderRadius: 10, border: '1.5px solid #e7e5e4', backgroundColor: 'white', fontSize: 13, cursor: 'pointer', color: '#57534e' }}>← Prev Week</button>
          <button style={{ padding: '8px 14px', borderRadius: 10, border: '1.5px solid #e7e5e4', backgroundColor: 'white', fontSize: 13, cursor: 'pointer', color: '#57534e' }}>Next Week →</button>
        </div>
      </div>

      {/* Week summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 28 }}>
        {STATS.map(s => (
          <div key={s.label} style={{ backgroundColor: 'white', borderRadius: 16, padding: '18px 16px', textAlign: 'center', border: '1px solid #e7e5e4' }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 24, fontWeight: 700, color: '#1c1917', marginBottom: 4 }}>{s.val}</div>
            <div style={{ fontSize: 12, color: '#78716c' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Days */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {WEEK_DATA.map(d => (
          <div key={d.day} style={{ backgroundColor: 'white', borderRadius: 18, overflow: 'hidden', border: `2px solid ${d.today ? '#4f46e5' : '#e7e5e4'}`, boxShadow: d.today ? '0 0 0 4px rgba(79,70,229,0.1)' : 'none', opacity: d.step === 'Locked' ? 0.55 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 0', gap: 14 }}>
              {/* Date */}
              <div style={{ width: 56, textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: 12, color: d.today ? '#4f46e5' : '#78716c', fontWeight: d.today ? 700 : 400 }}>{d.day.slice(0, 3)}</div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 700, color: d.today ? '#4f46e5' : '#1c1917' }}>{d.date.split(' ')[1]}</div>
              </div>

              {/* Topic & article */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, backgroundColor: '#eef2ff', color: '#4f46e5', padding: '2px 8px', borderRadius: 10, fontWeight: 500 }}>{d.topic}</span>
                  {d.today && <span style={{ fontSize: 11, backgroundColor: '#4f46e5', color: 'white', padding: '2px 8px', borderRadius: 10, fontWeight: 500 }}>Today</span>}
                </div>
                {d.article ? (
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#1c1917', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.article}</div>
                ) : (
                  <div style={{ fontSize: 13, color: '#a8a29e', fontStyle: 'italic' }}>Article not yet selected</div>
                )}
              </div>

              {/* Status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: d.step === 'Completed' ? '#059669' : d.step === 'In Progress' ? '#4f46e5' : '#a8a29e', backgroundColor: d.step === 'Completed' ? '#ecfdf5' : d.step === 'In Progress' ? '#eef2ff' : '#f5f5f4', padding: '4px 12px', borderRadius: 20 }}>
                  {d.step === 'Completed' ? '✓ ' : d.step === 'In Progress' ? '● ' : '🔒 '}{d.step}
                </span>
                {d.today && (
                  <button onClick={() => setPage('news-reader')} style={{ padding: '8px 16px', borderRadius: 10, backgroundColor: '#4f46e5', color: 'white', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                    Continue →
                  </button>
                )}
              </div>
            </div>

            {d.article && (
              <div style={{ padding: '12px 20px 16px', paddingLeft: 90, display: 'flex', gap: 20 }}>
                {/* Partner status */}
                <div style={{ display: 'flex', gap: 12 }}>
                  {[
                    { label: 'Me', init: 'HJ', color: '#4f46e5', done: d.me },
                    { label: 'Jisoo', init: 'J', color: '#10b981', done: d.partner },
                  ].map(u => (
                    <div key={u.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: u.done ? u.color : '#e7e5e4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: u.done ? 'white' : '#a8a29e', fontSize: 9, fontWeight: 700 }}>{u.init}</div>
                      <span style={{ fontSize: 12, color: u.done ? u.color : '#a8a29e', fontWeight: 500 }}>{u.label}</span>
                      {u.done ? <span style={{ fontSize: 11, color: u.color }}>✓</span> : <span style={{ fontSize: 11, color: '#a8a29e' }}>—</span>}
                    </div>
                  ))}
                </div>
                <div style={{ height: 20, width: 1, backgroundColor: '#e7e5e4' }} />
                <div style={{ display: 'flex', gap: 16 }}>
                  {[
                    { label: 'Words', val: `${d.words}`, done: d.words >= 10 },
                    { label: 'Discussed', val: d.discussed ? 'Yes' : 'No', done: d.discussed },
                  ].map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: s.done ? '#059669' : '#a8a29e' }}>
                      <span>{s.done ? '✓' : '○'}</span>
                      <span>{s.label}: <strong>{s.val}</strong></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
