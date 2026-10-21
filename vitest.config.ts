import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/*.test.ts', 'tests/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': new URL('./', import.meta.url).pathname,
      'server-only': new URL('./tests/server-only.stub.ts', import.meta.url)
        .pathname,
    },
  },
});
