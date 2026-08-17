import type { Page } from '../App'
import { useLearning } from '../state/LearningContext'

interface Props { setPage: (p: Page) => void }

export default function LearningCompletePage({ setPage }: Props) {
  const { state } = useLearning()

  const stats = [
    { icon: '📚', label: 'Words learned', val: state.vocabulary.checkedWords.length },
    { icon: '✍️', label: 'Reflection', val: state.reflection.submitted ? 'Submitted' : '—' },
    { icon: '🎤', label: 'Speaking feedback', val: 'Reviewed' },
  ]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafaf9', gap: 28, padding: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
        <div style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 30, color: '#1c1917', marginBottom: 8 }}>Today's session complete!</div>
        <p style={{ color: '#78716c', fontSize: 15, margin: 0 }}>
          🔥 {state.today.streak}-day streak · Great work with {state.partner.partnerName || 'your partner'}.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 16, padding: '24px 32px', backgroundColor: 'white', borderRadius: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.07)', border: '1px solid #e7e5e4' }}>
        {stats.map(s => (
          <div key={s.label} style={{ textAlign: 'center', minWidth: 120 }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1c1917' }}>{s.val}</div>
            <div style={{ fontSize: 12, color: '#78716c', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <button onClick={() => setPage('dashboard')} style={{ padding: '14px 40px', borderRadius: 12, backgroundColor: '#4f46e5', color: 'white', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
        Back to Dashboard →
      </button>
    </div>
  )
}
