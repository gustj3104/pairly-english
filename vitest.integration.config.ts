import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    testTimeout: 60000,
    hookTimeout: 180000,
    // Each test file starts its own Postgres container; keep them from
    // running concurrently so we don't hammer the Docker daemon / CI
    // runner with many containers booting at once.
    fileParallelism: false,
  },
});
