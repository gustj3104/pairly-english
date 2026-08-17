import * as mockNewsService from './mockNewsService'
import * as mockAIService from './mockAIService'
import * as mockPartnerService from './mockPartnerService'
import * as reflectionService from './api/reflectionService'
import type { NewsService, AIService, PartnerService } from './types'

/**
 * Mock AI is opt-in only, via an explicit env var — never a silent
 * fallback. Unset (the default) always means "call the real backend";
 * only the literal string `'true'` switches to `mockAIService`.
 */
const useMockAI = import.meta.env.VITE_USE_MOCK_AI === 'true'

const realAIService: AIService = {
  compareReflections: reflectionService.compareReflections,
  // The audio-analysis backend doesn't exist yet — unrelated to this task.
  analyzeAudio: mockAIService.analyzeAudio,
}

/**
 * Single access point for every backend-shaped call. Pages import
 * `newsService` / `aiService` / `partnerService` from here rather than
 * reaching into a specific mock module — swapping to Mindlogic later is
 * a matter of pointing these three exports at real implementations of
 * the same interfaces, without touching any page.
 */
export const newsService: NewsService = mockNewsService
export const aiService: AIService = useMockAI ? mockAIService : realAIService
export const partnerService: PartnerService = mockPartnerService

export type { NewsService, AIService, PartnerService } from './types'
