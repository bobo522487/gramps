import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = {
  POSTGRES_URL: process.env.POSTGRES_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
  BASE_URL: process.env.BASE_URL,
};

// Vitest defines BASE_URL for its own base path; the app expects an absolute URL.
beforeEach(() => {
  delete process.env.BASE_URL;
});

async function loadConfig() {
  vi.resetModules();
  return await import('@/lib/config');
}

afterEach(() => {
  process.env.POSTGRES_URL = originalEnv.POSTGRES_URL;
  process.env.AUTH_SECRET = originalEnv.AUTH_SECRET;
  process.env.BASE_URL = originalEnv.BASE_URL;
  vi.resetModules();
});

describe('server environment validation', () => {
  it('accepts a valid environment', async () => {
    process.env.POSTGRES_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.AUTH_SECRET = 'a'.repeat(32);

    const { getServerConfig } = await loadConfig();

    expect(getServerConfig()).toMatchObject({
      POSTGRES_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: 'a'.repeat(32),
    });
  });

  it('rejects an AUTH_SECRET shorter than 32 characters', async () => {
    process.env.POSTGRES_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.AUTH_SECRET = 'too-short';

    const { getServerConfig } = await loadConfig();

    expect(() => getServerConfig()).toThrow(/AUTH_SECRET/);
  });

  it('rejects a non-postgres POSTGRES_URL', async () => {
    process.env.POSTGRES_URL = 'mysql://user:pass@localhost/db';
    process.env.AUTH_SECRET = 'a'.repeat(32);

    const { getServerConfig } = await loadConfig();

    expect(() => getServerConfig()).toThrow(/POSTGRES_URL/);
  });

  it('validates only once and returns the cached config', async () => {
    process.env.POSTGRES_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.AUTH_SECRET = 'a'.repeat(32);

    const { getServerConfig } = await loadConfig();
    const first = getServerConfig();

    process.env.AUTH_SECRET = 'b'.repeat(32);

    expect(getServerConfig()).toBe(first);
  });
});
