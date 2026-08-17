import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `services/index.ts` reads `import.meta.env.VITE_USE_MOCK_AI` at module
 * load time, so each case needs a fresh module graph — `vi.resetModules()`
 * plus a dynamic `import()` after stubbing the env var.
 */
describe('aiService selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses the mock AI service when VITE_USE_MOCK_AI is exactly "true"', async () => {
    vi.stubEnv('VITE_USE_MOCK_AI', 'true')
    const mockAIService = await import('./mockAIService')
    const { aiService } = await import('./index')
    expect(aiService.compareReflections).toBe(mockAIService.compareReflections)
  })

  it('uses the real backend-backed service when VITE_USE_MOCK_AI is unset', async () => {
    vi.stubEnv('VITE_USE_MOCK_AI', undefined)
    const mockAIService = await import('./mockAIService')
    const { aiService } = await import('./index')
    expect(aiService.compareReflections).not.toBe(mockAIService.compareReflections)
  })

  it('uses the real backend-backed service for any non-"true" value (no silent fallback)', async () => {
    vi.stubEnv('VITE_USE_MOCK_AI', 'false')
    const mockAIService = await import('./mockAIService')
    const { aiService } = await import('./index')
    expect(aiService.compareReflections).not.toBe(mockAIService.compareReflections)
  })
})
