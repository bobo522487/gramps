import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MANAGED_KEYS = [
  'POSTGRES_URL',
  'APP_POSTGRES_URL',
  'AUTH_POSTGRES_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'VERCEL',
] as const;

const originalEnv = Object.fromEntries(
  MANAGED_KEYS.map((key) => [key, process.env[key]])
) as Record<(typeof MANAGED_KEYS)[number], string | undefined>;

const VALID_DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
const VALID_AUTH_URL = 'http://localhost:3000';
const VALID_SECRET = 'a'.repeat(32);

function setValidEnv() {
  process.env.POSTGRES_URL = VALID_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET = VALID_SECRET;
  process.env.BETTER_AUTH_URL = VALID_AUTH_URL;
}

async function loadConfig() {
  vi.resetModules();
  return await import('@/lib/config');
}

beforeEach(() => {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.resetModules();
});

describe('server environment validation', () => {
  it('accepts a valid environment', async () => {
    setValidEnv();

    const { getServerConfig } = await loadConfig();

    expect(getServerConfig()).toMatchObject({
      POSTGRES_URL: VALID_DATABASE_URL,
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: VALID_AUTH_URL,
    });
  });

  it('rejects a BETTER_AUTH_SECRET shorter than 32 characters', async () => {
    setValidEnv();
    process.env.BETTER_AUTH_SECRET = 'too-short';

    const { getServerConfig } = await loadConfig();

    expect(() => getServerConfig()).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('rejects a non-postgres POSTGRES_URL', async () => {
    setValidEnv();
    process.env.POSTGRES_URL = 'mysql://user:pass@localhost/db';

    const { getServerConfig } = await loadConfig();

    expect(() => getServerConfig()).toThrow(/POSTGRES_URL/);
  });

  it('rejects a non-absolute BETTER_AUTH_URL', async () => {
    setValidEnv();
    process.env.BETTER_AUTH_URL = '/dashboard';

    const { getServerConfig } = await loadConfig();

    expect(() => getServerConfig()).toThrow(/BETTER_AUTH_URL/);
  });

  it('requires APP_POSTGRES_URL in production', async () => {
    setValidEnv();
    process.env.VERCEL = '1';

    const { getServerConfig } = await loadConfig();

    expect(() => getServerConfig()).toThrow(/APP_POSTGRES_URL/);
  });

  it('requires AUTH_POSTGRES_URL in production', async () => {
    setValidEnv();
    process.env.VERCEL = '1';
    process.env.APP_POSTGRES_URL = VALID_DATABASE_URL;

    const { getServerConfig } = await loadConfig();

    expect(() => getServerConfig()).toThrow(/AUTH_POSTGRES_URL/);
  });

  it('accepts dedicated connections in production', async () => {
    setValidEnv();
    process.env.VERCEL = '1';
    process.env.APP_POSTGRES_URL = 'postgresql://app:pass@localhost:5432/db';
    process.env.AUTH_POSTGRES_URL =
      'postgresql://auth_runtime:pass@localhost:5432/db';

    const { getServerConfig } = await loadConfig();

    expect(getServerConfig()).toMatchObject({
      APP_POSTGRES_URL: 'postgresql://app:pass@localhost:5432/db',
      AUTH_POSTGRES_URL: 'postgresql://auth_runtime:pass@localhost:5432/db',
    });
  });

  it('validates only once and returns the cached config', async () => {
    setValidEnv();

    const { getServerConfig } = await loadConfig();
    const first = getServerConfig();

    process.env.BETTER_AUTH_SECRET = 'b'.repeat(32);

    expect(getServerConfig()).toBe(first);
  });
});
