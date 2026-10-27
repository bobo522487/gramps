import { loadEnv } from '@/scripts/load-env.mjs';

loadEnv();

export type DatabaseEnv = Record<string, string | undefined>;

function requireTestDatabase(url: string | undefined, label: string): string {
  if (!url) {
    throw new Error(
      `${label} (or TEST_POSTGRES_URL) must point to a dedicated test database.`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} is not a valid PostgreSQL URL.`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against "${database}": database name must end with "_test". Set ${label} to a dedicated test database.`
    );
  }

  return url;
}

/** Shared fixture database: migrations, factories and raw assertions. */
export function resolveTestDatabaseUrl(env: DatabaseEnv = process.env): string {
  return requireTestDatabase(
    env.TEST_POSTGRES_URL ?? env.POSTGRES_URL,
    'TEST_POSTGRES_URL'
  );
}

/** Application pool; falls back to the shared test database locally. */
export function resolveAppTestDatabaseUrl(
  env: DatabaseEnv = process.env
): string {
  return requireTestDatabase(
    env.APP_TEST_POSTGRES_URL ??
      env.TEST_POSTGRES_URL ??
      env.APP_POSTGRES_URL ??
      env.POSTGRES_URL,
    'APP_TEST_POSTGRES_URL'
  );
}

/** Auth pool; falls back to the shared test database locally. */
export function resolveAuthTestDatabaseUrl(
  env: DatabaseEnv = process.env
): string {
  return requireTestDatabase(
    env.AUTH_TEST_POSTGRES_URL ??
      env.TEST_POSTGRES_URL ??
      env.AUTH_POSTGRES_URL ??
      env.POSTGRES_URL,
    'AUTH_TEST_POSTGRES_URL'
  );
}
