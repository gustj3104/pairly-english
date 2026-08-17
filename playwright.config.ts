import { defineConfig, devices } from '@playwright/test'

const port = process.env.PORT || '8443'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 30_000,
    // e2e must never depend on a real backend or hit the real Mindlogic API —
    // force mock AI regardless of .env.local's own VITE_USE_MOCK_AI setting.
    env: { VITE_USE_MOCK_AI: 'true' },
  },
})
