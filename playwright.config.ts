import { defineConfig, devices } from '@playwright/test';
import {
  E2E_BETTER_AUTH_SECRET,
  E2E_PORT,
  isExternalMode,
  resolveE2EAppDatabaseUrl,
  resolveE2EAuthDatabaseUrl,
  resolveE2EBaseUrl,
  resolveE2ETestDatabaseUrl,
} from './tests/e2e/env';

const baseURL = resolveE2EBaseUrl();
const external = isExternalMode();

const webServer = external
  ? undefined
  : {
      command: process.env.CI
        ? `pnpm start -p ${E2E_PORT}`
        : `pnpm dev --turbopack --port ${E2E_PORT}`,
      url: `${baseURL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        ...(process.env as Record<string, string>),
        POSTGRES_URL: resolveE2ETestDatabaseUrl(),
        APP_POSTGRES_URL: resolveE2EAppDatabaseUrl(),
        AUTH_POSTGRES_URL: resolveE2EAuthDatabaseUrl(),
        BETTER_AUTH_SECRET: E2E_BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: baseURL,
        LOG_LEVEL: 'error',
      },
    };

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer,
});
