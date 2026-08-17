import { useState } from 'react'
import type { Page } from '../App'
import { useLearning } from '../state/LearningContext'
import { partnerService } from '../services'

interface Props { setPage: (p: Page) => void }

export default function LandingPage({ setPage }: Props) {
  const { state, update } = useLearning()
  const [showConnect, setShowConnect] = useState(false)
  const [connected, setConnected] = useState(state.partner.connected)
  const [connecting, setConnecting] = useState(false)
  const [name, setName] = useState(state.partner.myName)

  const handleSimulateJoin = async () => {
    setConnecting(true)
    const { partnerName } = await partnerService.connectPartner('PRL-7829')
    update({ partner: { ...state.partner, connected: true, myName: name || 'Hyunji', partnerName } })
    setConnecting(false)
    setConnected(true)
  }

  const handleStartLearning = () => {
    setPage(state.onboarding.complete ? 'dashboard' : 'onboarding')
  }

  if (connected) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafaf9', gap: 32, padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 28, color: '#1c1917', marginBottom: 8 }}>You're paired up!</div>
          <p style={{ color: '#78716c', fontSize: 15 }}>Your study partner has joined. Ready to start learning together?</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '28px 40px', backgroundColor: 'white', borderRadius: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.07)', border: '1px solid #e7e5e4' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 20, fontWeight: 700, margin: '0 auto 8px' }}>
              {name ? name[0].toUpperCase() : 'H'}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1917' }}>{name || 'Hyunji'}</div>
            <div style={{ fontSize: 12, color: '#4f46e5', marginTop: 2 }}>Me</div>
          </div>
          <div style={{ fontSize: 22, color: '#d6d3d1' }}>⟷</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 20, fontWeight: 700, margin: '0 auto 8px' }}>
              {(state.partner.partnerName || 'J')[0].toUpperCase()}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1917' }}>{state.partner.partnerName || 'Jisoo'}</div>
            <div style={{ fontSize: 12, color: '#10b981', marginTop: 2 }}>Partner</div>
          </div>
        </div>
        <button onClick={handleStartLearning} style={{ padding: '14px 40px', borderRadius: 12, backgroundColor: '#4f46e5', color: 'white', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
          Start Learning Together →
        </button>
      </div>
    )
  }

  if (showConnect) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafaf9', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 440, backgroundColor: 'white', borderRadius: 24, padding: 40, boxShadow: '0 8px 40px rgba(0,0,0,0.08)', border: '1px solid #e7e5e4' }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="4.5" cy="7" r="3" fill="white" opacity="0.9"/>
                  <circle cx="9.5" cy="7" r="3" fill="white" opacity="0.6"/>
                </svg>
              </span>
              <span style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 16, color: '#1c1917' }}>Pairly English</span>
            </div>
            <h2 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 26, color: '#1c1917', margin: 0, marginBottom: 8 }}>Connect with your partner</h2>
            <p style={{ color: '#78716c', fontSize: 14, margin: 0 }}>Share your invite code or link so your study partner can join.</p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#44403c', display: 'block', marginBottom: 6 }}>Your nickname</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Hyunji"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e7e5e4', fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ backgroundColor: '#f5f5f4', borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: '#78716c', marginBottom: 8, fontWeight: 500 }}>Invite Code</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 600, letterSpacing: 6, color: '#4f46e5', textAlign: 'center', padding: '10px 0' }}>
                PRL-7829
              </div>
              <button style={{ padding: '8px 14px', borderRadius: 8, backgroundColor: 'white', border: '1.5px solid #e7e5e4', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: '#44403c' }}>
                Copy
              </button>
            </div>
          </div>

          <div style={{ textAlign: 'center', fontSize: 12, color: '#a8a29e', marginBottom: 16 }}>— or share link —</div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <div style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e7e5e4', fontSize: 12, color: '#78716c', backgroundColor: '#fafaf9', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              pairly.english/join/PRL-7829
            </div>
            <button style={{ padding: '9px 14px', borderRadius: 8, backgroundColor: '#4f46e5', color: 'white', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer' }}>
              Copy Link
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', backgroundColor: '#fffbeb', borderRadius: 10, border: '1px solid #fde68a', marginBottom: 24 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#f59e0b', animation: 'pulse 2s infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#92400e' }}>Waiting for partner to connect...</span>
          </div>

          <button onClick={handleSimulateJoin} disabled={connecting} style={{ width: '100%', padding: '12px', borderRadius: 10, backgroundColor: connecting ? '#a7f3d0' : '#10b981', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: connecting ? 'default' : 'pointer' }}>
            {connecting ? 'Connecting...' : 'Simulate Partner Joining ✓'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', overflow: 'hidden' }}>
      {/* Hero */}
      <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
        {/* Background */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, #1e1b4b 0%, #312e81 40%, #1e1b4b 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 70% 30%, rgba(99,102,241,0.3) 0%, transparent 50%), radial-gradient(circle at 20% 70%, rgba(16,185,129,0.15) 0%, transparent 40%)' }} />

        {/* Floating nav */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '20px 40px', display: 'flex', alignItems: 'center', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                <circle cx="4.5" cy="7" r="3" fill="white" opacity="0.9"/>
                <circle cx="9.5" cy="7" r="3" fill="white" opacity="0.6"/>
              </svg>
            </span>
            <span style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 18, color: 'white', letterSpacing: '-0.3px' }}>Pairly English</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
            <button onClick={() => setPage('dashboard')} style={{ padding: '8px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)', backgroundColor: 'transparent', color: 'white', fontSize: 14, cursor: 'pointer' }}>
              Sign in
            </button>
            <button onClick={() => setShowConnect(true)} style={{ padding: '8px 20px', borderRadius: 10, backgroundColor: '#4f46e5', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              Get Started
            </button>
          </div>
        </div>

        <div style={{ position: 'relative', maxWidth: 1200, margin: '0 auto', padding: '0 40px', width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>
          {/* Left: Copy */}
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 20, backgroundColor: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', marginBottom: 28 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#34d399' }} />
              <span style={{ fontSize: 13, color: '#6ee7b7', fontWeight: 500 }}>Collaborative English Learning</span>
            </div>
            <h1 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 58, color: 'white', lineHeight: 1.1, margin: '0 0 24px', letterSpacing: '-1px' }}>
              Read differently.<br/>
              <span style={{ color: '#818cf8' }}>Think together.</span><br/>
              Speak better.
            </h1>
            <p style={{ fontSize: 17, color: '#c7d2fe', lineHeight: 1.7, margin: '0 0 36px', maxWidth: 440 }}>
              영어 뉴스를 읽고, 서로의 생각을 비교하고,<br/>
              대화하며 영어를 배워보세요.
            </p>
            <div style={{ display: 'flex', gap: 14 }}>
              <button onClick={() => setShowConnect(true)} style={{ padding: '14px 32px', borderRadius: 12, backgroundColor: '#4f46e5', color: 'white', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                Get Started
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
              <button onClick={() => setPage('dashboard')} style={{ padding: '14px 24px', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', color: 'white', fontSize: 15, border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}>
                View Demo
              </button>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 32, marginTop: 48, paddingTop: 36, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              {[
                { n: '10K+', label: 'Active Pairs' },
                { n: '2.4M', label: 'Words Learned' },
                { n: '98K', label: 'Discussions' },
              ].map(s => (
                <div key={s.n}>
                  <div style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 26, color: 'white' }}>{s.n}</div>
                  <div style={{ fontSize: 12, color: '#a5b4fc', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: UI Preview card */}
          <div style={{ position: 'relative' }}>
            <div style={{ backgroundColor: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', borderRadius: 24, border: '1px solid rgba(255,255,255,0.12)', padding: 24, boxShadow: '0 32px 80px rgba(0,0,0,0.4)' }}>
              {/* Mini step bar */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
                {['Read', 'Vocab', 'Write', 'Compare', 'Discuss', 'Feedback'].map((s, i) => (
                  <div key={s} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ height: 3, borderRadius: 2, backgroundColor: i <= 1 ? '#10b981' : i === 2 ? '#4f46e5' : 'rgba(255,255,255,0.15)', marginBottom: 4 }} />
                    <span style={{ fontSize: 9, color: i <= 1 ? '#6ee7b7' : i === 2 ? '#a5b4fc' : 'rgba(255,255,255,0.3)' }}>{s}</span>
                  </div>
                ))}
              </div>

              {/* News card */}
              <div style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ height: 110, background: 'linear-gradient(135deg, #1d4ed8 0%, #0e7490 100%)', position: 'relative', display: 'flex', alignItems: 'flex-end', padding: 14 }}>
                  <span style={{ fontSize: 10, backgroundColor: 'rgba(0,0,0,0.4)', color: 'white', padding: '3px 8px', borderRadius: 20 }}>Technology</span>
                </div>
                <div style={{ padding: '12px 14px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'white', fontFamily: 'DM Serif Display, Georgia, serif', lineHeight: 1.4, marginBottom: 6 }}>
                    AI Systems Are Now Writing More Code Than Human Developers
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>The Verge · 4 min read · Intermediate</div>
                </div>
              </div>

              {/* Partner progress */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { label: 'Me', init: 'HJ', color: '#4f46e5', bg: 'rgba(79,70,229,0.15)', status: 'Writing...', step: 'Write' },
                  { label: 'Jisoo', init: 'J', color: '#10b981', bg: 'rgba(16,185,129,0.15)', status: 'Vocab done', step: 'Vocabulary' },
                ].map(u => (
                  <div key={u.label} style={{ backgroundColor: u.bg, borderRadius: 12, padding: '12px 14px', border: `1px solid ${u.color}30` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: u.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11, fontWeight: 700 }}>{u.init}</div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'white' }}>{u.label}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{u.status}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: u.color, fontWeight: 500, backgroundColor: `${u.color}20`, padding: '3px 8px', borderRadius: 10, display: 'inline-block' }}>{u.step}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Floating badges */}
            <div style={{ position: 'absolute', top: -12, right: -16, backgroundColor: 'white', borderRadius: 12, padding: '10px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>🎯</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#1c1917' }}>12 words learned</div>
                <div style={{ fontSize: 10, color: '#78716c' }}>today's session</div>
              </div>
            </div>
            <div style={{ position: 'absolute', bottom: -10, left: -16, backgroundColor: 'white', borderRadius: 12, padding: '10px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>💬</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#1c1917' }}>3 corrections found</div>
                <div style={{ fontSize: 10, color: '#78716c' }}>grammar feedback</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Features section */}
      <div style={{ backgroundColor: 'white', padding: '80px 40px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 38, color: '#1c1917', margin: '0 0 14px' }}>A complete learning loop, together</h2>
            <p style={{ color: '#78716c', fontSize: 16, maxWidth: 500, margin: '0 auto' }}>From reading to speaking, every step is designed for collaborative growth.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
            {[
              { icon: '📰', title: 'Curated News', desc: 'Daily AI-selected articles matched to your level and interests — real news, not textbook English.', color: '#eef2ff', accent: '#4f46e5' },
              { icon: '🤝', title: 'Paired Learning', desc: 'Stay in sync with your partner. See their progress in real time and grow together.', color: '#ecfdf5', accent: '#10b981' },
              { icon: '🧠', title: 'AI Analysis', desc: 'After you both write, AI compares your opinions and generates personalized discussion topics.', color: '#faf5ff', accent: '#7c3aed' },
              { icon: '💬', title: 'Discussion Practice', desc: 'Use AI-curated expressions and questions to fuel real English conversation between the two of you.', color: '#fff7ed', accent: '#d97706' },
              { icon: '🎤', title: 'Speaking Feedback', desc: 'Upload your conversation and get detailed grammar corrections and natural expression suggestions.', color: '#fef2f2', accent: '#ef4444' },
              { icon: '📊', title: 'Learning Archive', desc: 'Every word, correction, and discussion saved — review your progress any time.', color: '#f0fdfa', accent: '#0d9488' },
            ].map(f => (
              <div key={f.title} style={{ padding: 28, borderRadius: 16, backgroundColor: f.color, border: `1px solid ${f.accent}15` }}>
                <div style={{ fontSize: 28, marginBottom: 14 }}>{f.icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', margin: '0 0 8px' }}>{f.title}</h3>
                <p style={{ fontSize: 14, color: '#78716c', lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA bottom */}
      <div style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)', padding: '72px 40px', textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 38, color: 'white', margin: '0 0 16px' }}>Start learning with a partner today</h2>
        <p style={{ color: '#c7d2fe', fontSize: 16, margin: '0 0 32px' }}>No credit card. No downloads. Just you, your partner, and better English.</p>
        <button onClick={() => setShowConnect(true)} style={{ padding: '16px 44px', borderRadius: 14, backgroundColor: '#4f46e5', color: 'white', fontSize: 16, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
          Get Started Free
        </button>
      </div>
    </div>
  )
}
