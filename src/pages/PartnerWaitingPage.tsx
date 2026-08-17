import { useState, useEffect } from 'react'
import type { Page } from '../App'

interface Props { setPage: (p: Page) => void }

export default function PartnerWaitingPage({ setPage }: Props) {
  const [dots, setDots] = useState(1)
  const [notified, setNotified] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setDots(d => (d % 3) + 1), 600)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={{ paddingTop: 40, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ maxWidth: 640, width: '100%', textAlign: 'center' }}>
        {/* Status illustration */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32, marginBottom: 28 }}>
            {/* Me */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 10px' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 22, fontWeight: 700 }}>HJ</div>
                <div style={{ position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: '50%', backgroundColor: '#10b981', border: '2.5px solid #fafaf9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1917' }}>Me</div>
              <div style={{ fontSize: 12, color: '#10b981', fontWeight: 500, marginTop: 3 }}>✓ Submitted</div>
            </div>

            {/* Connecting dots */}
            <div style={{ display: 'flex', gap: 6, paddingTop: 0 }}>
              {[1,2,3].map(i => (
                <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: i <= dots ? '#f59e0b' : '#e7e5e4', transition: 'background 0.3s' }} />
              ))}
            </div>

            {/* Partner */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 10px' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 22, fontWeight: 700 }}>J</div>
                <div style={{ position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: '50%', backgroundColor: '#f59e0b', border: '2.5px solid #fafaf9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M6 3v6M3 6h6" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1917' }}>Jisoo</div>
              <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 500, marginTop: 3 }}>✏️ Writing...</div>
            </div>
          </div>

          <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '28px 32px', border: '1px solid #e7e5e4', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, color: '#a8a29e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Status</div>
            <h2 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 26, color: '#1c1917', margin: '0 0 10px' }}>Your partner is still writing.</h2>
            <p style={{ color: '#78716c', fontSize: 15, lineHeight: 1.7, margin: '0 0 20px' }}>
              Take a break or use this time to review your vocabulary. We'll notify you the moment Jisoo submits their reflection.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { emoji: '✓', label: 'You submitted', val: 'Reflection ready', color: '#10b981', bg: '#ecfdf5' },
                { emoji: '⏳', label: 'Partner status', val: 'Writing in progress', color: '#f59e0b', bg: '#fffbeb' },
              ].map(item => (
                <div key={item.label} style={{ padding: '12px 14px', borderRadius: 12, backgroundColor: item.bg, border: `1px solid ${item.color}30` }}>
                  <div style={{ fontSize: 11, color: item.color, fontWeight: 600, marginBottom: 4 }}>{item.emoji} {item.label}</div>
                  <div style={{ fontSize: 13, color: '#1c1917', fontWeight: 500 }}>{item.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 28 }}>
          <button onClick={() => !notified && setNotified(true)} style={{ padding: '14px 12px', borderRadius: 14, backgroundColor: notified ? '#ecfdf5' : 'white', border: `1.5px solid ${notified ? '#a7f3d0' : '#e7e5e4'}`, cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{notified ? '✅' : '🔔'}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: notified ? '#059669' : '#1c1917' }}>{notified ? 'Reminder Sent' : 'Nudge Partner'}</div>
            <div style={{ fontSize: 11, color: '#78716c', marginTop: 2 }}>{notified ? 'Jisoo was notified' : 'Send a reminder'}</div>
          </button>
          <button style={{ padding: '14px 12px', borderRadius: 14, backgroundColor: 'white', border: '1.5px solid #e7e5e4', cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>📖</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1917' }}>Reread Mine</div>
            <div style={{ fontSize: 11, color: '#78716c', marginTop: 2 }}>Review your reflection</div>
          </button>
          <button style={{ padding: '14px 12px', borderRadius: 14, backgroundColor: 'white', border: '1.5px solid #e7e5e4', cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>📚</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1917' }}>Review Words</div>
            <div style={{ fontSize: 11, color: '#78716c', marginTop: 2 }}>Flashcard review</div>
          </button>
        </div>

        {/* Simulate */}
        <button onClick={() => setPage('ai-comparison')} style={{ padding: '13px 32px', borderRadius: 12, backgroundColor: '#10b981', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
          Simulate: Partner Submitted → Compare Now
        </button>
      </div>
    </div>
  )
}
