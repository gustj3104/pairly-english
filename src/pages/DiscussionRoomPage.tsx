import { useEffect, useRef, useState } from 'react'
import type { Page } from '../App'
import { useLearning } from '../state/LearningContext'
import { validateAudioFile, SUPPORTED_AUDIO_EXTENSIONS } from '../services/mockAIService'

interface Props { setPage: (p: Page) => void }

export default function DiscussionRoomPage({ setPage }: Props) {
  const { state, update, audioFile, setAudioFile } = useLearning()
  const myName = state.partner.myName || 'Hyunji'
  const partnerName = state.partner.partnerName || 'Jisoo'
  const [seconds, setSeconds] = useState(0)
  const [running, setRunning] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // A File can't be persisted to localStorage; if a filename survived a
  // refresh but the File object didn't, the learner needs to reselect it.
  const needsReselect = !audioFile && !!state.discussion.audioFileName

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }
  }, [audioUrl])

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const formatSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const validation = validateAudioFile(file)
    if (!validation.valid) {
      setError(validation.error ?? 'This file could not be used.')
      setAudioFile(null)
      update({ discussion: { ...state.discussion, audioFileName: null } })
      return
    }

    setError(null)
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioFile(file)
    setAudioUrl(URL.createObjectURL(file))
    update({ discussion: { ...state.discussion, audioFileName: file.name } })
  }

  const topicQuestion = state.discussion.selectedTopicText
    ?? "Is K-culture's global rise a result of genuine artistic quality, or primarily effective marketing strategy?"

  return (
    <div style={{ paddingTop: 28 }}>
      {/* Topic header */}
      <div style={{ backgroundColor: '#1e1b4b', borderRadius: 20, padding: '28px 32px', marginBottom: 24, color: 'white' }}>
        <div style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Discussion Topic</div>
        <h2 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 26, color: 'white', margin: '0 0 12px', lineHeight: 1.3 }}>
          {topicQuestion}
        </h2>
        <div style={{ display: 'flex', gap: 14 }}>
          <span style={{ fontSize: 12, color: '#c7d2fe' }}>📰 The Quiet Revolution: K-Culture & Hollywood</span>
          <span style={{ fontSize: 12, color: '#c7d2fe' }}>🎯 Goal: 15 minutes</span>
        </div>

        {/* Timer */}
        <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 40, fontWeight: 600, color: running ? '#34d399' : '#e0e7ff', letterSpacing: 2 }}>
            {formatTime(seconds)}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setRunning(!running)} style={{ padding: '10px 20px', borderRadius: 10, backgroundColor: running ? 'rgba(255,255,255,0.1)' : '#4f46e5', color: 'white', fontSize: 13, fontWeight: 600, border: running ? '1px solid rgba(255,255,255,0.2)' : 'none', cursor: 'pointer' }}>
              {running ? '⏸ Pause' : '▶ Start Timer'}
            </button>
            <button onClick={() => { setSeconds(0); setRunning(false) }} style={{ padding: '10px 14px', borderRadius: 10, backgroundColor: 'transparent', color: '#a5b4fc', fontSize: 13, border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}>
              Reset
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'start' }}>
        {/* Left: Discussion support */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Discussion Guide */}
          <div style={{ backgroundColor: 'white', borderRadius: 18, padding: '22px 24px', border: '1px solid #e7e5e4' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', margin: '0 0 18px' }}>Discussion Guide</h3>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: '#4f46e5', fontWeight: 600, marginBottom: 10 }}>Opening Question</div>
              <div style={{ padding: '12px 16px', backgroundColor: '#eef2ff', borderRadius: 10, fontSize: 14, color: '#1c1917', lineHeight: 1.6 }}>
                "{partnerName}, from your reading, what was the single most compelling piece of evidence that K-culture's success was intentionally engineered rather than organically grown?"
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#4f46e5', fontWeight: 600, marginBottom: 10 }}>Follow-up Questions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  'Can a government-backed cultural movement still produce authentic art?',
                  'What would you say to someone who claims K-pop is "manufactured" and therefore less valuable?',
                  'How does this compare to how other countries have used culture as soft power?',
                ].map((q, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', backgroundColor: '#f5f5f4', borderRadius: 8, fontSize: 13, color: '#44403c', lineHeight: 1.5 }}>
                    <span style={{ color: '#a8a29e', flexShrink: 0 }}>{i + 1}.</span>
                    {q}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Useful Expressions */}
          <div style={{ backgroundColor: 'white', borderRadius: 18, padding: '22px 24px', border: '1px solid #e7e5e4' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', margin: '0 0 16px' }}>Useful Expressions</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[
                { label: 'Agreeing', color: '#ecfdf5', accent: '#10b981', exprs: ['That\'s a great point.', 'I completely agree with you.', 'You\'ve touched on something important.'] },
                { label: 'Disagreeing Politely', color: '#fff7ed', accent: '#f59e0b', exprs: ['I see your point, but...', 'That\'s interesting — I actually think...', 'With all due respect, I\'d argue...'] },
                { label: 'Asking for Clarification', color: '#eef2ff', accent: '#4f46e5', exprs: ['Could you elaborate on that?', 'What do you mean exactly by...?', 'I\'m not sure I follow — could you give an example?'] },
                { label: 'Giving Examples', color: '#faf5ff', accent: '#7c3aed', exprs: ['For instance, if we look at...', 'A good example of this would be...', 'This is similar to the case of...'] },
              ].map(group => (
                <div key={group.label} style={{ backgroundColor: group.color, borderRadius: 12, padding: '14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: group.accent, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{group.label}</div>
                  {group.exprs.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#44403c', lineHeight: 1.6, padding: '4px 0', borderBottom: i < group.exprs.length - 1 ? `1px solid ${group.accent}20` : 'none' }}>
                      "{e}"
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Key opinions recap */}
          <div style={{ backgroundColor: 'white', borderRadius: 18, padding: '22px 24px', border: '1px solid #e7e5e4' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', margin: '0 0 16px' }}>Your Key Positions</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ padding: '14px', backgroundColor: '#eef2ff', borderRadius: 12, borderLeft: '3px solid #4f46e5' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', marginBottom: 6 }}>{myName.toUpperCase()}</div>
                <p style={{ fontSize: 13, color: '#1c1917', lineHeight: 1.6, margin: 0 }}>"Artistic quality and commercial strategy are not mutually exclusive — Korean creators proved both can coexist."</p>
              </div>
              <div style={{ padding: '14px', backgroundColor: '#ecfdf5', borderRadius: 12, borderLeft: '3px solid #10b981' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981', marginBottom: 6 }}>{partnerName.toUpperCase()}</div>
                <p style={{ fontSize: 13, color: '#1c1917', lineHeight: 1.6, margin: 0 }}>"The systematic government investment raises questions about whether culture can retain authenticity when designed for export."</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Audio Upload */}
        <div style={{ position: 'sticky', top: 130 }}>
          <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '24px', border: '1px solid #e7e5e4' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', margin: '0 0 6px' }}>Upload Discussion Audio</h3>
            <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 20px', lineHeight: 1.5 }}>
              Record your conversation offline, then select the audio file to preview it here. The file stays in your browser — nothing is uploaded.
            </p>

            {needsReselect && (
              <div style={{ padding: '12px 14px', backgroundColor: '#fffbeb', borderRadius: 10, marginBottom: 16, fontSize: 12, color: '#92400e', lineHeight: 1.5, border: '1px solid #fde68a' }}>
                ⚠️ "{state.discussion.audioFileName}" was selected before the page refreshed. Browsers don't keep file contents across a reload — please choose it again.
              </div>
            )}

            {error && (
              <div style={{ padding: '12px 14px', backgroundColor: '#fef2f2', borderRadius: 10, marginBottom: 16, fontSize: 12, color: '#991b1b', lineHeight: 1.5, border: '1px solid #fca5a5' }}>
                ⚠️ {error}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
              aria-label="Select discussion audio file"
            />

            {!audioFile ? (
              <div onClick={() => fileInputRef.current?.click()} style={{ border: '2px dashed #c7d2fe', borderRadius: 14, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', backgroundColor: '#f5f3ff', transition: 'border-color 0.2s' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🎙️</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#4f46e5', marginBottom: 6 }}>Choose audio file</div>
                <div style={{ fontSize: 12, color: '#78716c', marginBottom: 14 }}>Click to browse your device</div>
                <div style={{ fontSize: 11, color: '#a8a29e' }}>{SUPPORTED_AUDIO_EXTENSIONS.join(', ').toUpperCase()}</div>
              </div>
            ) : (
              <>
                {/* Selected state */}
                <div style={{ border: '1.5px solid #a7f3d0', borderRadius: 14, padding: '16px', backgroundColor: '#ecfdf5', marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 16 }}>🎵</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1917' }}>{audioFile.name}</div>
                        <div style={{ fontSize: 11, color: '#78716c' }}>{formatSize(audioFile.size)}</div>
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>✓ Selected</span>
                  </div>
                  {audioUrl && (
                    <audio controls src={audioUrl} style={{ width: '100%', height: 32 }} />
                  )}
                </div>
                <button onClick={() => fileInputRef.current?.click()} style={{ width: '100%', padding: '10px', borderRadius: 10, border: '1.5px solid #e7e5e4', backgroundColor: 'white', fontSize: 13, cursor: 'pointer', color: '#57534e', marginBottom: 10 }}>
                  Choose a different file
                </button>
                <button onClick={() => setPage('feedback')} style={{ width: '100%', padding: '13px', borderRadius: 12, backgroundColor: '#4f46e5', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                  Analyze Conversation →
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
