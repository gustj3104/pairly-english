import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['node_modules/**', 'tests/integration/**'],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    testTimeout: 20000,
  },
});
