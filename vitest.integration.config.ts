import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { LOG_LEVEL: 'error', BASE_URL: 'http://localhost:3000' },
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@': new URL('./', import.meta.url).pathname,
      'server-only': new URL('./tests/server-only.stub.ts', import.meta.url)
        .pathname,
    },
  },
});
