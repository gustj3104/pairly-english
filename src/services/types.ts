import type { Article } from './mockNewsService'
import type { FeedbackResult } from './mockAIService'
import type { CompareReflectionsRequest, ComparisonResult } from './api/schemas'

export interface NewsService {
  getTodayArticle(): Promise<Article>
}

export interface AIService {
  compareReflections(input: CompareReflectionsRequest): Promise<ComparisonResult>
  /** Real implementation will multipart/form-data upload `file`; the interface is already shaped for that. */
  analyzeAudio(file: File): Promise<FeedbackResult>
}

export interface PartnerService {
  connectPartner(inviteCode: string): Promise<{ partnerName: string }>
  waitForPartnerSubmission(): Promise<void>
  /** The partner's submitted reflection text, once available. */
  getPartnerReflection(): Promise<string>
}
