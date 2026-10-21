import 'server-only';

import { z } from 'zod';

const serverConfigSchema = z.object({
  POSTGRES_URL: z
    .string()
    .min(1, 'POSTGRES_URL is required')
    .refine(
      (value) =>
        value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'POSTGRES_URL must be a postgres:// or postgresql:// URL'
    ),
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters long'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  BASE_URL: z.string().url('BASE_URL must be a valid URL').optional(),
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
