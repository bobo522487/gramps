import { signToken } from '@/lib/auth/session';

export const TEST_AUTH_SECRET =
  'integration-test-secret-value-long-enough-for-hs256';

export async function signSessionFor(userId: number, tokenVersion?: number) {
  return signToken({
    user: { id: userId },
    ...(tokenVersion === undefined ? {} : { tv: tokenVersion }),
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  });
}
