import { getSessionCookie } from 'better-auth/cookies';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const protectedRoutes = '/dashboard';

/**
 * Optimistic gate only: it checks that a session cookie exists. The database
 * check stays in `getSessionUser()` on every page, action and route.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = getSessionCookie(request, {
    cookiePrefix: 'better-auth',
  });
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();

  if (pathname.startsWith(protectedRoutes) && !hasSession) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(signInUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('x-request-id', requestId);
  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
