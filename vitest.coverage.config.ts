import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Root-level only in Vitest 5: project-level `fileParallelism` is ignored,
    // and concurrent integration files would truncate each other's data.
    fileParallelism: false,
    projects: [
      { extends: './vitest.config.ts', test: { name: 'unit' } },
      {
        extends: './vitest.integration.config.ts',
        test: { name: 'integration' },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'lib/**/*.ts',
        'app/api/**/route.ts',
        'components/lineage/derived.ts',
        'components/lineage/lineage-tree.ts',
        'components/lineage/lineage-store.ts',
        'components/lineage/canvas/layout/**/*.ts',
      ],
      exclude: [
        'lib/db/schema/**',
        'lib/db/migrations/**',
        'lib/db/seed.ts',
        'lib/db/drizzle.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 55,
        branches: 50,
        'lib/db/queries/**': { lines: 70, functions: 60 },
        'lib/db/services.ts': { lines: 70, functions: 60 },
        'lib/lineage/node-services.ts': { lines: 70, functions: 60 },
      },
    },
  },
});
