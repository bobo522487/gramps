import { defineConfig } from 'vitest/config';

// `.mts` 而不是 `.ts`：Vite 8 的 `configLoader: 'native'` 会把 `.ts` 当 CommonJS
// 加载，遇到 ESM 语法时报 `code.charCodeAt is not a function`——错误还被
// source-map 解析吞掉，表面症状是「No test files found」。`.mts` 强制按 ESM 加载。
export default defineConfig({
  test: {
    environment: 'node',
    env: {
      LOG_LEVEL: 'error',
      BETTER_AUTH_URL: 'http://localhost:3000',
    },
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
