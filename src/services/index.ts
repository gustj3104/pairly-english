import * as mockNewsService from './mockNewsService'
import * as mockAIService from './mockAIService'
import * as mockPartnerService from './mockPartnerService'
import type { NewsService, AIService, PartnerService } from './types'

/**
 * Single access point for every backend-shaped call. Pages import
 * `newsService` / `aiService` / `partnerService` from here rather than
 * reaching into a specific mock module — swapping to Mindlogic later is
 * a matter of pointing these three exports at real implementations of
 * the same interfaces, without touching any page.
 */
export const newsService: NewsService = mockNewsService
export const aiService: AIService = mockAIService
export const partnerService: PartnerService = mockPartnerService

export type { NewsService, AIService, PartnerService } from './types'
