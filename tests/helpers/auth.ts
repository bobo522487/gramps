import { getAuth } from '@/lib/auth/better-auth';
import { TEST_PASSWORD } from './factories';

export const TEST_BETTER_AUTH_SECRET =
  'integration-test-secret-value-long-enough-for-hs256';

/**
 * Signs in through Better Auth and returns the raw `Cookie` header. Loaded
 * lazily by each test file so per-file `next/headers` mocks are in place.
 */
export async function signSessionFor(
  email: string,
  password = TEST_PASSWORD
): Promise<string> {
  const response = await getAuth().api.signInEmail({
    body: { email, password },
    asResponse: true,
  });

  const setCookie = response.headers.get('set-cookie');
  const match = setCookie?.match(/better-auth\.session_token=([^;]+)/);
  if (!match) {
    throw new Error(`no session cookie returned for ${email}`);
  }

  return `better-auth.session_token=${match[1]}`;
}

export function headersWithCookie(cookie: string): Headers {
  return new Headers({ cookie });
}
