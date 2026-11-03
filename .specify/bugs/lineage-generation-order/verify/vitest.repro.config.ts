import { defineConfig } from 'vitest/config';

/**
 * Verification-only config for `/speckit-bug-test slug=lineage-generation-order`.
 *
 * It lives inside the bug directory on purpose: the bug-test command may not add
 * or change files under `tests/`, but the assessment's reproduction needs to run
 * against the real write path (nextSort), the real query (getNodes) and the real
 * index (buildLineageIndex) on a real PostgreSQL. Same shape as
 * `vitest.integration.config.ts`, only the `include` points here.
 */
const root = new URL('../../../..', import.meta.url).pathname;

export default defineConfig({
  test: {
    root,
    environment: 'node',
    env: {
      LOG_LEVEL: 'error',
      BETTER_AUTH_URL: 'http://localhost:3000',
    },
    include: [
      '.specify/bugs/lineage-generation-order/verify/*.repro.test.ts',
    ],
    globalSetup: ['tests/integration/global-setup.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': root,
      'server-only': `${root}tests/server-only.stub.ts`,
    },
  },
});
