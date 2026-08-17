const STEPS = ['Read', 'Vocabulary', 'Write', 'Compare', 'Discuss', 'Feedback']

interface Props {
  currentStep: number
  completedUpTo: number
}

export default function StepProgressBar({ currentStep, completedUpTo }: Props) {
  return (
    <div style={{ backgroundColor: 'white', borderBottom: '1px solid #e7e5e4', padding: '0 24px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', height: 52 }}>
        {STEPS.map((step, i) => {
          const isDone = i < completedUpTo
          const isActive = i === currentStep
          const isLocked = i > completedUpTo
          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600,
                  backgroundColor: isDone ? '#ecfdf5' : isActive ? '#4f46e5' : '#f5f5f4',
                  color: isDone ? '#059669' : isActive ? 'white' : '#a8a29e',
                  border: isDone ? '1.5px solid #10b981' : isActive ? 'none' : '1.5px solid #e7e5e4',
                  flexShrink: 0,
                  transition: 'all 0.2s',
                }}>
                  {isDone ? (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span style={{
                  fontSize: 13, fontWeight: isActive ? 600 : 400,
                  color: isDone ? '#059669' : isActive ? '#4f46e5' : isLocked ? '#d6d3d1' : '#57534e',
                  whiteSpace: 'nowrap',
                }}>
                  {step}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: 1.5, backgroundColor: isDone ? '#10b981' : '#e7e5e4', margin: '0 10px', transition: 'background-color 0.3s' }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
