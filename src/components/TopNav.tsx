import type { Page } from '../App'

interface Props {
  page: Page
  setPage: (p: Page) => void
}

const NAV_LINKS: { label: string; page: Page }[] = [
  { label: 'Today', page: 'dashboard' },
  { label: 'Weekly Plan', page: 'weekly' },
  { label: 'Review', page: 'review' },
]

export default function TopNav({ page, setPage }: Props) {
  return (
    <nav style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      backgroundColor: 'rgba(250,250,249,0.92)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid #e7e5e4',
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', gap: 32 }}>
        {/* Logo */}
        <button onClick={() => setPage('dashboard')} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="4.5" cy="7" r="3" fill="white" opacity="0.9"/>
              <circle cx="9.5" cy="7" r="3" fill="white" opacity="0.6"/>
            </svg>
          </span>
          <span style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 17, color: '#1c1917', letterSpacing: '-0.3px' }}>Pairly English</span>
        </button>

        {/* Nav Links */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {NAV_LINKS.map(link => (
            <button
              key={link.page}
              onClick={() => setPage(link.page)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: page === link.page ? 600 : 400,
                color: page === link.page ? '#4f46e5' : '#57534e',
                backgroundColor: page === link.page ? '#eef2ff' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              {link.label}
            </button>
          ))}
        </div>

        {/* Right side */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Streak */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, backgroundColor: '#fff7ed', border: '1px solid #fed7aa' }}>
            <span style={{ fontSize: 14 }}>🔥</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#c2410c' }}>12</span>
            <span style={{ fontSize: 12, color: '#9a3412' }}>days</span>
          </div>
          {/* Notification */}
          <button style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#57534e' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', backgroundColor: '#ef4444', border: '1.5px solid #fafaf9' }} />
          </button>
          {/* Avatar */}
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            HJ
          </div>
        </div>
      </div>
    </nav>
  )
}
