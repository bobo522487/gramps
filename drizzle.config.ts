import type { Config } from 'drizzle-kit';

export default {
  schema: './lib/db/schema/index.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Prefer the direct (non-pooled) URL for migrations; pooled connections
    // cannot run some DDL reliably. Vercel's native Neon integration names the
    // direct URL POSTGRES_URL_NON_POOLING.
    url:
      process.env.POSTGRES_URL_DIRECT ??
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.POSTGRES_URL!,
  },
} satisfies Config;
