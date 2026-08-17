import { useState } from 'react'
import LandingPage from './pages/LandingPage'
import DashboardPage from './pages/DashboardPage'
import NewsReaderPage from './pages/NewsReaderPage'
import VocabularyPage from './pages/VocabularyPage'
import ReflectionPage from './pages/ReflectionPage'
import PartnerWaitingPage from './pages/PartnerWaitingPage'
import AIComparisonPage from './pages/AIComparisonPage'
import DiscussionRoomPage from './pages/DiscussionRoomPage'
import SpeakingFeedbackPage from './pages/SpeakingFeedbackPage'
import WeeklyPlanPage from './pages/WeeklyPlanPage'
import ReviewPage from './pages/ReviewPage'
import TopNav from './components/TopNav'
import StepProgressBar from './components/StepProgressBar'

export type Page =
  | 'landing'
  | 'dashboard'
  | 'news-reader'
  | 'vocabulary'
  | 'reflection'
  | 'waiting'
  | 'ai-comparison'
  | 'discussion'
  | 'feedback'
  | 'weekly'
  | 'review'

const LEARNING_PAGES: Page[] = [
  'news-reader',
  'vocabulary',
  'reflection',
  'waiting',
  'ai-comparison',
  'discussion',
  'feedback',
]

const STEP_MAP: Record<string, number> = {
  'news-reader': 0,
  vocabulary: 1,
  reflection: 2,
  waiting: 2,
  'ai-comparison': 3,
  discussion: 4,
  feedback: 5,
}

export default function App() {
  const [page, setPage] = useState<Page>('landing')

  const isLearning = LEARNING_PAGES.includes(page)
  const currentStep = STEP_MAP[page] ?? -1

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#fafaf9', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {page !== 'landing' && (
        <TopNav page={page} setPage={setPage} />
      )}
      {isLearning && (
        <StepProgressBar currentStep={currentStep} completedUpTo={currentStep} />
      )}
      <main style={{ maxWidth: page === 'landing' ? undefined : '1200px', margin: '0 auto', padding: page === 'landing' ? 0 : '0 24px 48px' }}>
        {page === 'landing' && <LandingPage setPage={setPage} />}
        {page === 'dashboard' && <DashboardPage setPage={setPage} />}
        {page === 'news-reader' && <NewsReaderPage setPage={setPage} />}
        {page === 'vocabulary' && <VocabularyPage setPage={setPage} />}
        {page === 'reflection' && <ReflectionPage setPage={setPage} />}
        {page === 'waiting' && <PartnerWaitingPage setPage={setPage} />}
        {page === 'ai-comparison' && <AIComparisonPage setPage={setPage} />}
        {page === 'discussion' && <DiscussionRoomPage setPage={setPage} />}
        {page === 'feedback' && <SpeakingFeedbackPage setPage={setPage} />}
        {page === 'weekly' && <WeeklyPlanPage setPage={setPage} />}
        {page === 'review' && <ReviewPage setPage={setPage} />}
      </main>
    </div>
  )
}
