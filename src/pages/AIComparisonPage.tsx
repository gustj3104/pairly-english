import { useCallback, useEffect, useRef, useState } from 'react'
import type { Page } from '../App'
import { useLearning, getInitials } from '../state/LearningContext'
import { aiService, newsService } from '../services'
import { ApiError, type ApiErrorKind } from '../services/api/errors'
import type { ComparisonResult } from '../services/api/schemas'

interface Props { setPage: (p: Page) => void }

type ComparisonStatus =
  | 'loading'
  | 'success'
  | 'session_expired'
  | 'credit_limit_exceeded'
  | 'reconciliation_pending'
  | 'rate_limited'
  | 'backend_unavailable'
  | 'invalid_response'
  | 'error'

function statusFromErrorKind(kind: ApiErrorKind): ComparisonStatus {
  if (kind === 'validation' || kind === 'unknown') return 'error'
  if (kind === 'unauthorized') return 'session_expired'
  return kind
}

const STATUS_COPY: Record<
  Exclude<ComparisonStatus, 'loading' | 'success'>,
  { title: string; icon: string; action: 'retry' | 'login' | 'none' }
> = {
  session_expired: { title: '세션이 만료되었습니다', icon: '🔒', action: 'login' },
  credit_limit_exceeded: { title: '이번 달 AI 학습 한도를 모두 사용했습니다', icon: '📊', action: 'none' },
  reconciliation_pending: { title: '이전 요청을 확인하는 중입니다', icon: '⏳', action: 'none' },
  rate_limited: { title: '요청이 너무 많습니다', icon: '🐢', action: 'retry' },
  backend_unavailable: { title: '서버에 연결할 수 없습니다', icon: '🔌', action: 'retry' },
  invalid_response: { title: '서버 응답을 처리할 수 없습니다', icon: '⚠️', action: 'retry' },
  error: { title: '문제가 발생했습니다', icon: '❗', action: 'retry' },
}

export default function AIComparisonPage({ setPage }: Props) {
  const { state, update } = useLearning()
  const myName = state.partner.myName || 'Hyunji'
  const partnerName = state.partner.partnerName || 'Jisoo'
  const [status, setStatus] = useState<ComparisonStatus>('loading')
  const [result, setResult] = useState<ComparisonResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedTopic, setSelectedTopic] = useState<number | null>(state.discussion.selectedTopicIndex)
  const attemptRef = useRef(0)

  const runComparison = useCallback(async () => {
    setStatus('loading')
    setErrorMessage(null)
    const requestToken = ++attemptRef.current

    try {
      const article = await newsService.getTodayArticle()
      const response = await aiService.compareReflections({
        article: { title: article.title, summary: article.summary, sourceUrl: article.sourceUrl },
        mine: { displayName: myName, reflection: state.reflection.body },
        partner: { displayName: partnerName, reflection: state.partner.reflection },
      })
      if (requestToken !== attemptRef.current) return // superseded by a later attempt
      setResult(response)
      setStatus('success')
    } catch (error) {
      if (requestToken !== attemptRef.current) return
      if (error instanceof ApiError) {
        setStatus(statusFromErrorKind(error.kind))
        setErrorMessage(error.message)
      } else {
        setStatus('error')
        setErrorMessage('알 수 없는 오류가 발생했습니다.')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myName, partnerName, state.reflection.body, state.partner.reflection])

  useEffect(() => {
    if (!state.partner.reflection.trim()) {
      // Nothing to compare yet — send the learner back rather than calling the API with an empty side.
      setPage('waiting')
      return
    }
    runComparison()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSelectTopic = (i: number) => {
    const next = selectedTopic === i ? null : i
    setSelectedTopic(next)
    update({ discussion: { ...state.discussion, selectedTopicIndex: next, selectedTopicText: next === null ? null : (result?.topics[i]?.question ?? null) } })
  }

  const handleStartDiscussion = () => {
    if (selectedTopic === null) return
    setPage('discussion')
  }

  if (status === 'loading') {
    return (
      <div style={{ paddingTop: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #e7e5e4', borderTopColor: '#4f46e5', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: '#78716c', fontSize: 14 }}>AI is comparing both reflections...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (status !== 'success' || !result) {
    // `status === 'success'` with a null `result` shouldn't happen — they're set together —
    // but fall back to the generic error copy rather than indexing STATUS_COPY with 'success'.
    const copy = status === 'success' ? STATUS_COPY.error : STATUS_COPY[status]
    return (
      <div style={{ paddingTop: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 12, textAlign: 'center' }}>
        <div style={{ fontSize: 36 }}>{copy.icon}</div>
        <h2 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 22, color: '#1c1917', margin: 0 }}>{copy.title}</h2>
        {errorMessage && <p style={{ color: '#78716c', fontSize: 14, maxWidth: 420, margin: 0 }}>{errorMessage}</p>}
        {copy.action === 'retry' && (
          <button
            onClick={runComparison}
            style={{ marginTop: 12, padding: '11px 28px', borderRadius: 12, backgroundColor: '#4f46e5', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}
          >
            Retry
          </button>
        )}
        {copy.action === 'login' && (
          <button
            onClick={() => setPage('landing')}
            style={{ marginTop: 12, padding: '11px 28px', borderRadius: 12, backgroundColor: '#4f46e5', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}
          >
            Log in again
          </button>
        )}
      </div>
    )
  }

  const { commonGround, differences, topics } = result

  return (
    <div style={{ paddingTop: 28 }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 14px', borderRadius: 20, backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', marginBottom: 16 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981' }} />
          <span style={{ fontSize: 12, color: '#059669', fontWeight: 500 }}>AI Analysis Complete</span>
        </div>
        <h1 style={{ fontFamily: 'DM Serif Display, Georgia, serif', fontSize: 34, color: '#1c1917', margin: '0 0 10px' }}>
          You read the same story differently.
        </h1>
        <p style={{ color: '#78716c', fontSize: 15, margin: '0 0 20px' }}>
          AI compared both reflections to find common ground and diverging perspectives.
        </p>

        {/* Pair display */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 16, padding: '14px 24px', backgroundColor: 'white', borderRadius: 20, border: '1px solid #e7e5e4' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700 }}>{getInitials(myName)}</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1917' }}>{myName}</div>
              <div style={{ fontSize: 11, color: '#4f46e5' }}>Me · {state.reflection.body.trim() ? state.reflection.body.trim().split(/\s+/).length : 0} words</div>
            </div>
          </div>
          <span style={{ fontSize: 18, color: '#d6d3d1' }}>vs</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700 }}>{getInitials(partnerName)}</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1917' }}>{partnerName}</div>
              <div style={{ fontSize: 11, color: '#10b981' }}>Partner · {state.partner.reflection.trim() ? state.partner.reflection.trim().split(/\s+/).length : 0} words</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: '#a8a29e' }}>
          ℹ️ AI analysis compares perspectives in the texts — not a factual verdict on either view.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        {/* Common Ground */}
        <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '24px', border: '1px solid #e7e5e4', gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🤝</div>
            <div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1c1917', margin: 0 }}>Common Ground</h3>
              <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>Points both reflections agreed on</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {commonGround.map((item, i) => (
              <div key={i} style={{ padding: '16px', backgroundColor: '#f0fdf4', borderRadius: 14, border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#166534', lineHeight: 1.5, marginBottom: 14 }}>{item.point}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ padding: '10px 12px', backgroundColor: 'rgba(79,70,229,0.08)', borderRadius: 10, borderLeft: '3px solid #4f46e5' }}>
                    <div style={{ fontSize: 10, color: '#4f46e5', fontWeight: 600, marginBottom: 4 }}>{myName.toUpperCase()}</div>
                    <div style={{ fontSize: 12, color: '#44403c', fontStyle: 'italic', lineHeight: 1.5 }}>{item.mine}</div>
                  </div>
                  <div style={{ padding: '10px 12px', backgroundColor: 'rgba(16,185,129,0.08)', borderRadius: 10, borderLeft: '3px solid #10b981' }}>
                    <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600, marginBottom: 4 }}>{partnerName.toUpperCase()}</div>
                    <div style={{ fontSize: 12, color: '#44403c', fontStyle: 'italic', lineHeight: 1.5 }}>{item.partner}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Different Perspectives */}
        <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '24px', border: '1px solid #e7e5e4', gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>⚡</div>
            <div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1c1917', margin: 0 }}>Different Perspectives</h3>
              <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>Where your views diverged</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {differences.map((item, i) => (
              <div key={i} style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid #e7e5e4' }}>
                <div style={{ padding: '12px 16px', backgroundColor: '#f5f5f4', borderBottom: '1px solid #e7e5e4' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1917' }}>{item.topic}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <div style={{ padding: '14px', borderRight: '1px solid #f5f5f4' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#4f46e5', marginTop: 3 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5' }}>{myName.toUpperCase()} · {item.mine.stance}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#57534e', fontStyle: 'italic', lineHeight: 1.6 }}>{item.mine.quote}</div>
                  </div>
                  <div style={{ padding: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981', marginTop: 3 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981' }}>{partnerName.toUpperCase()} · {item.partner.stance}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#57534e', fontStyle: 'italic', lineHeight: 1.6 }}>{item.partner.quote}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Discussion Topics */}
      <div style={{ backgroundColor: 'white', borderRadius: 20, padding: '24px 28px', border: '1px solid #e7e5e4' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>💬</div>
          <div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1c1917', margin: 0 }}>Questions Worth Discussing</h3>
            <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>Choose one topic to discuss in English</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {topics.map((t, i) => (
            <div key={i} onClick={() => handleSelectTopic(i)} style={{ borderRadius: 14, border: `2px solid ${selectedTopic === i ? '#4f46e5' : '#e7e5e4'}`, backgroundColor: selectedTopic === i ? '#f5f3ff' : 'white', cursor: 'pointer', overflow: 'hidden', transition: 'all 0.2s' }}>
              <div style={{ padding: '18px 20px', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: selectedTopic === i ? '#4f46e5' : '#f5f5f4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: selectedTopic === i ? 'white' : '#78716c', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#1c1917', lineHeight: 1.5, marginBottom: 8 }}>{t.question}</div>
                  <div style={{ fontSize: 12, color: '#78716c', lineHeight: 1.5, marginBottom: 10 }}>{t.reason}</div>
                  <span style={{ fontSize: 11, backgroundColor: t.difficulty === 'Advanced' ? '#fef3c7' : '#dbeafe', color: t.difficulty === 'Advanced' ? '#92400e' : '#1e40af', padding: '3px 10px', borderRadius: 20, fontWeight: 500 }}>
                    {t.difficulty}
                  </span>
                </div>
                {selectedTopic === i && (
                  <div style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleStartDiscussion} disabled={selectedTopic === null} style={{ padding: '13px 32px', borderRadius: 12, backgroundColor: selectedTopic !== null ? '#4f46e5' : '#e7e5e4', color: selectedTopic !== null ? 'white' : '#a8a29e', fontSize: 14, fontWeight: 600, border: 'none', cursor: selectedTopic !== null ? 'pointer' : 'not-allowed' }}>
            Start Discussion →
          </button>
        </div>
      </div>
    </div>
  )
}
