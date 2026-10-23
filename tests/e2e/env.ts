import { resolveTestDatabaseUrl } from '../helpers/db-url';

export const E2E_PORT = 3100;
export const E2E_AUTH_SECRET = 'e2e-test-auth-secret-0123456789abcdef';

export function isExternalMode(): boolean {
  return process.env.E2E_EXTERNAL_SERVER === '1';
}

export function assertExternalModeAllowed(): void {
  if (isExternalMode() && process.env.E2E_ALLOW_EXTERNAL !== '1') {
    throw new Error(
      'Refusing to run E2E against an external server without E2E_ALLOW_EXTERNAL=1.'
    );
  }
}

export function resolveE2EBaseUrl(): string {
  return process.env.E2E_BASE_URL ?? `http://127.0.0.1:${E2E_PORT}`;
}

export function resolveE2ETestDatabaseUrl(): string {
  return resolveTestDatabaseUrl(process.env);
}
