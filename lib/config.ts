import 'server-only';

import { z } from 'zod';

const postgresUrl = z
  .string()
  .min(1, 'must not be empty')
  .refine(
    (value) =>
      value.startsWith('postgres://') || value.startsWith('postgresql://'),
    'must be a postgres:// or postgresql:// URL'
  );

function isPooledEndpoint(value: string) {
  try {
    return new URL(value).hostname.includes('-pooler.');
  } catch {
    return false;
  }
}

const serverConfigSchema = z
  .object({
    POSTGRES_URL: postgresUrl,
    APP_POSTGRES_URL: postgresUrl.optional(),
    AUTH_POSTGRES_URL: postgresUrl.optional(),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters long'),
    BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be a valid URL'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  })
  .superRefine((config, ctx) => {
    // The auth connection pins `role=auth_service` through a startup
    // parameter, which PgBouncer (Neon's pooled endpoint) rejects. Builds
    // must not require a runtime database, so enforce this at start-up only.
    if (
      process.env.NEXT_PHASE !== 'phase-production-build' &&
      isPooledEndpoint(config.AUTH_POSTGRES_URL ?? config.POSTGRES_URL)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_POSTGRES_URL'],
        message:
          'must use the unpooled (direct) endpoint because the auth connection pins role=auth_service with a startup parameter',
      });
    }

    if (!process.env.VERCEL) {
      return;
    }

    for (const key of ['APP_POSTGRES_URL', 'AUTH_POSTGRES_URL'] as const) {
      if (!config[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required in production`,
        });
      }
    }
  });

export type ServerConfig = z.infer<typeof serverConfigSchema>;

let cached: ServerConfig | null = null;

/**
 * Validates the server environment once per process. Called by
 * `instrumentation.ts` at startup so a misconfigured deploy fails fast instead
 * of throwing on the first request.
 */
export function getServerConfig(): ServerConfig {
  if (cached) {
    return cached;
  }

  const result = serverConfigSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  cached = result.data;
  return cached;
}

/** Test hook: drop the cached config after changing process.env. */
export function resetServerConfig() {
  cached = null;
}
