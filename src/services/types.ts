import type { Article } from './mockNewsService'
import type { ComparisonResult, FeedbackResult } from './mockAIService'

export interface NewsService {
  getTodayArticle(): Promise<Article>
}

export interface AIService {
  compareReflections(myReflection: string, partnerReflection: string): Promise<ComparisonResult>
  /** Real implementation will multipart/form-data upload `file`; the interface is already shaped for that. */
  analyzeAudio(file: File): Promise<FeedbackResult>
}

export interface PartnerService {
  connectPartner(inviteCode: string): Promise<{ partnerName: string }>
  waitForPartnerSubmission(): Promise<void>
}
