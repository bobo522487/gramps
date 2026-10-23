import dotenv from 'dotenv';

dotenv.config();

export type DatabaseEnv = Record<string, string | undefined>;

export function resolveTestDatabaseUrl(env: DatabaseEnv = process.env): string {
  const url = env.TEST_POSTGRES_URL ?? env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      'Tests need TEST_POSTGRES_URL (or POSTGRES_URL) pointing to a dedicated test database.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TEST_POSTGRES_URL is not a valid PostgreSQL URL.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against "${database}": database name must end with "_test". Set TEST_POSTGRES_URL to a dedicated test database.`
    );
  }

  return url;
}
