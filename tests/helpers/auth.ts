export const TEST_AUTH_SECRET =
  'integration-test-secret-value-long-enough-for-hs256';

export async function signSessionFor(userId: string, tokenVersion?: number) {
  // Loaded lazily: the setup file imports this module before per-file
  // `next/headers` mocks are registered.
  const { signToken } = await import('@/lib/auth/session');

  return signToken({
    user: { id: userId },
    ...(tokenVersion === undefined ? {} : { tv: tokenVersion }),
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  });
}
