import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { signToken, verifySessionToken } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

const protectedRoutes = '/dashboard';
const RENEW_THRESHOLD_MS = 6 * 60 * 60 * 1000;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get('session');
  const isProtectedRoute = pathname.startsWith(protectedRoutes);

  if (isProtectedRoute && !sessionCookie) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(signInUrl);
  }

  const res = NextResponse.next();

  if (sessionCookie && request.method === 'GET') {
    try {
      const { payload: parsed } = await verifySessionToken(sessionCookie.value);

      // Sliding renewal only near expiry: blanket re-signing would let a
      // revoked-but-copied JWT live forever at the edge gate.
      const remainingMs = ((parsed.exp ?? 0) - Date.now() / 1000) * 1000;
      if (remainingMs < RENEW_THRESHOLD_MS) {
        const expiresInOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
        res.cookies.set({
          name: 'session',
          value: await signToken({
            user: parsed.user as { id: number },
            tv: parsed.tv as number | undefined,
            expires: expiresInOneDay.toISOString(),
          }),
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          expires: expiresInOneDay,
        });
      }
    } catch (error) {
      logger.error('Error updating session', error);
      res.cookies.delete('session');
      if (isProtectedRoute) {
        return NextResponse.redirect(new URL('/sign-in', request.url));
      }
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
