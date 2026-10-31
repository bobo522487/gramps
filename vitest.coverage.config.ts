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
      // Floors, not targets (docs/guides/testing.md §5): each sits ~2 points
      // under the measured baseline, so a regression fails and ordinary work
      // does not. Raise them when the baseline rises; never lower them to pass.
      thresholds: {
        lines: 76,
        statements: 76,
        functions: 84,
        branches: 65,
        'lib/db/queries/**': { lines: 98, functions: 98 },
        'lib/project/services.ts': { lines: 92, functions: 98 },
        'lib/lineage/node-services.ts': { lines: 84, functions: 94 },
      },
    },
  },
});
