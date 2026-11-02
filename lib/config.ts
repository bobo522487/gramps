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
    BETTER_AUTH_URL: z.url('BETTER_AUTH_URL must be a valid URL'),
    // 谱文图片的私有桶令牌（ADR 0019）。可选：本地与 CI 没有它，
    // getMediaMode() 据此退回文件系统驱动。
    BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
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
        code: 'custom',
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
          code: 'custom',
          path: [key],
          message: `${key} is required in production`,
        });
      }
    }
  });

/**
 * The one place allowed to read process.env (see F7 in
 * docs/architecture/08-非功能性设计.md). Everything else asks this module.
 */
export function isVercel(): boolean {
  return Boolean(process.env.VERCEL);
}

/** 谱文图片字节的落点（ADR 0019）。 */
export type MediaMode = 'blob' | 'fs';

/**
 * 只有「部署在 Vercel 且配了私有桶令牌」才走 Blob；其余一律文件系统驱动，
 * 这样本地与 CI 不需要任何凭证也能跑通整条图片链路。判定只写在这一处（F7：
 * 只有本模块读 `process.env`），业务代码只问 `getMediaMode()`。
 */
export function getMediaMode(): MediaMode {
  return isVercel() && process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'fs';
}

/** Current log level; unset in development means verbose. */
export function resolveLogLevel(): 'debug' | 'info' | 'warn' | 'error' {
  const configured = process.env.LOG_LEVEL;
  if (
    configured === 'debug' ||
    configured === 'info' ||
    configured === 'warn' ||
    configured === 'error'
  ) {
    return configured;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

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
