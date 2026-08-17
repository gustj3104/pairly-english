import type { Page } from '../App'

interface Props { setPage: (p: Page) => void }

const WEEK = [
  { day: 'Mon', date: 11, topic: 'Technology', done: true, partner: true },
  { day: 'Tue', date: 12, topic: 'Society', done: true, partner: true },
  { day: 'Wed', date: 13, topic: 'Business', done: true, partner: false },
  { day: 'Thu', date: 14, topic: 'Culture', done: false, today: true, partner: false, inProgress: true },
  { day: 'Fri', date: 15, topic: 'Environment', done: false, locked: true },
  { day: 'Sat', date: 16, topic: 'Lifestyle', done: false, locked: true },
  { day: 'Sun', date: 17, topic: 'Sports', done: false, locked: true },
]

export default function DashboardPage({ setPage }: Props) {
  return (
    <div style={{ paddingTop: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 32, color: '#1c1917', margin: '0 0 6px' }}>Good evening, Hyunji ✨</h1>
          <p style={{ color: '#78716c', fontSize: 15, margin: 0 }}>Thursday, August 14, 2025 · 🔥 12-day streak</p>
        </div>
        <div style={{ backgroundColor: 'white', borderRadius: 14, padding: '14px 20px', border: '1px solid #e7e5e4', textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: '#78716c', marginBottom: 6 }}>This week's progress</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {[1,1,1,0.4,0,0,0].map((v, i) => (
              <div key={i} style={{ width: 20, height: 6, borderRadius: 3, backgroundColor: v === 1 ? '#10b981' : v === 0.4 ? '#4f46e5' : '#e7e5e4' }} />
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#44403c', marginTop: 6, fontWeight: 600 }}>3 / 5 days completed</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24 }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Today's News Card */}
          <div style={{ backgroundColor: 'white', borderRadius: 20, overflow: 'hidden', border: '1px solid #e7e5e4', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <div style={{ position: 'relative', height: 200, background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0d4e6e 100%)', overflow: 'hidden' }}>
              <img
                src="https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=900&h=400&fit=crop&auto=format"
                alt="AI Technology"
                style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }}
              />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)' }} />
              <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 11, backgroundColor: '#4f46e5', color: 'white', padding: '4px 10px', borderRadius: 20, fontWeight: 500 }}>Thursday</span>
                <span style={{ fontSize: 11, backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '4px 10px', borderRadius: 20, backdropFilter: 'blur(4px)' }}>Culture</span>
              </div>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '16px 20px' }}>
                <h2 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 22, color: 'white', margin: 0, lineHeight: 1.3 }}>
                  The Quiet Revolution: How K-Culture Is Rewriting Hollywood's Playbook
                </h2>
              </div>
            </div>
            <div style={{ padding: '20px 24px 24px' }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
                {[
                  { icon: '📰', text: 'The Atlantic' },
                  { icon: '🕐', text: '6 min read' },
                  { icon: '📊', text: 'Intermediate' },
                  { icon: '📅', text: 'Aug 14, 2025' },
                ].map(item => (
                  <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#78716c' }}>
                    <span>{item.icon}</span>
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 14, color: '#57534e', lineHeight: 1.7, margin: '0 0 20px' }}>
                From Parasite's Oscar sweep to BTS filling stadiums on every continent, Korean cultural exports have quietly dismantled the long-standing assumption that global entertainment flows in one direction. This piece examines how a nation of 51 million people engineered one of history's most remarkable cultural exports...
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={() => setPage('news-reader')} style={{ flex: 1, padding: '12px', borderRadius: 12, backgroundColor: '#4f46e5', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  Start Reading →
                </button>
                <button style={{ padding: '12px 16px', borderRadius: 12, backgroundColor: '#f5f5f4', color: '#57534e', fontSize: 13, border: 'none', cursor: 'pointer' }}>
                  Source ↗
                </button>
              </div>
            </div>
          </div>

          {/* Weekly Calendar */}
          <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '22px 24px', border: '1px solid #e7e5e4' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', margin: '0 0 18px' }}>This Week</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
              {WEEK.map(d => (
                <div key={d.day} style={{
                  borderRadius: 12, padding: '12px 8px', textAlign: 'center',
                  backgroundColor: d.today ? '#eef2ff' : d.done ? '#ecfdf5' : '#f5f5f4',
                  border: d.today ? '2px solid #4f46e5' : d.done ? '1px solid #a7f3d0' : '1px solid #e7e5e4',
                  opacity: d.locked ? 0.5 : 1,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: d.today ? '#4f46e5' : d.done ? '#059669' : '#a8a29e', marginBottom: 4 }}>{d.day}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: d.today ? '#4f46e5' : '#1c1917', marginBottom: 4 }}>{d.date}</div>
                  <div style={{ fontSize: 9, color: d.done ? '#10b981' : d.today ? '#4f46e5' : '#a8a29e', marginBottom: 6, lineHeight: 1.3 }}>{d.topic}</div>
                  {d.done && <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981', margin: '0 auto' }} />}
                  {d.inProgress && <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#4f46e5', margin: '0 auto' }} />}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Partner Status */}
          <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '22px 24px', border: '1px solid #e7e5e4' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', margin: 0 }}>Today's Progress</h3>
              <span style={{ fontSize: 11, color: '#10b981', backgroundColor: '#ecfdf5', padding: '3px 8px', borderRadius: 10, fontWeight: 500 }}>● Live</span>
            </div>

            {[
              {
                name: 'Me', init: 'HJ', color: '#4f46e5', bg: '#eef2ff', label: 'Me',
                step: 'Write', words: 12, reflection: false, audio: false, stepIdx: 2,
              },
              {
                name: 'Jisoo', init: 'J', color: '#10b981', bg: '#ecfdf5', label: 'Partner',
                step: 'Vocabulary', words: 9, reflection: false, audio: false, stepIdx: 1,
              },
            ].map(u => (
              <div key={u.name} style={{ backgroundColor: u.bg, borderRadius: 14, padding: '16px', marginBottom: 14, border: `1px solid ${u.color}20` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', backgroundColor: u.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700 }}>{u.init}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1917' }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: u.color, fontWeight: 500 }}>{u.label}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', fontSize: 11, backgroundColor: u.color, color: 'white', padding: '4px 10px', borderRadius: 20, fontWeight: 500 }}>{u.step}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[
                    { label: 'Words', val: `${u.words}/15`, done: u.words >= 15 },
                    { label: 'Reflection', val: u.reflection ? '✓' : '—', done: u.reflection },
                    { label: 'Audio', val: u.audio ? '✓' : '—', done: u.audio },
                  ].map(stat => (
                    <div key={stat.label} style={{ textAlign: 'center', padding: '8px 4px', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 8 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: stat.done ? u.color : '#44403c' }}>{stat.val}</div>
                      <div style={{ fontSize: 10, color: '#78716c', marginTop: 2 }}>{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '22px 24px', border: '1px solid #e7e5e4' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', margin: '0 0 16px' }}>Quick Review</h3>
            {[
              { icon: '📚', title: 'Vocabulary Bank', sub: '87 words saved', color: '#eef2ff', accent: '#4f46e5' },
              { icon: '✏️', title: 'Saved Corrections', sub: '24 expressions', color: '#ecfdf5', accent: '#10b981' },
              { icon: '🎧', title: 'Past Discussions', sub: '8 recordings', color: '#faf5ff', accent: '#7c3aed' },
            ].map(item => (
              <div key={item.title} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px', borderRadius: 12, backgroundColor: item.color, marginBottom: 10, cursor: 'pointer', border: `1px solid ${item.accent}15` }}>
                <span style={{ fontSize: 20 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1917' }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: '#78716c' }}>{item.sub}</div>
                </div>
                <svg style={{ marginLeft: 'auto' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
