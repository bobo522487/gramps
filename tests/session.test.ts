import { beforeAll, describe, expect, it, vi } from 'vitest';

let signToken: typeof import('@/lib/auth/session').signToken;
let verifyToken: typeof import('@/lib/auth/session').verifyToken;
let getSessionUser: typeof import('@/lib/auth/context').getSessionUser;
let sessionCookieValue: string | null = null;
let dbRows: unknown[] = [];

beforeAll(async () => {
  process.env.AUTH_SECRET = 'test-secret-value-long-enough-for-hs256-abcd';

  vi.doMock('next/headers', () => ({
    cookies: async () => ({
      get: () =>
        sessionCookieValue ? { value: sessionCookieValue } : undefined,
    }),
  }));
  vi.doMock('next/navigation', () => ({
    redirect: (path: string) => {
      throw new Error(`REDIRECT ${path}`);
    },
    notFound: () => {
      throw new Error('NOT_FOUND');
    },
  }));
  vi.doMock('@/lib/db/drizzle', () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => dbRows,
          }),
        }),
      }),
    },
  }));

  ({ signToken, verifyToken } = await import('@/lib/auth/session'));
  ({ getSessionUser } = await import('@/lib/auth/context'));
});

describe('session token', () => {
  it('round-trips the tokenVersion (tv) claim', async () => {
    const token = await signToken({
      user: { id: 1 },
      tv: 3,
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const payload = await verifyToken(token);
    expect(payload.user.id).toBe(1);
    expect(payload.tv).toBe(3);
  });

  it('rejects tokens with a bad signature', async () => {
    const token = await signToken({
      user: { id: 1 },
      tv: 0,
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const [header, payload] = token.split('.');
    const forged = `${header}.${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    await expect(verifyToken(forged)).rejects.toThrow();
  });

  it('rejects expired tokens', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({
      user: { id: 1 },
      tv: 0,
      expires: new Date(Date.now() - 1000).toISOString(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('-1s')
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    await expect(verifyToken(token)).rejects.toThrow();
  });
});

describe('getSessionUser authoritative checks', () => {
  const userRow = {
    user: { id: 1, email: 'a@b.c', passwordHash: 'x', role: 'owner' },
    tokenVersion: 2,
  };

  async function tokenWith(tv: number | undefined) {
    return signToken({
      user: { id: 1 },
      ...(tv === undefined ? {} : { tv }),
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    });
  }

  it('returns the user when tokenVersion matches', async () => {
    sessionCookieValue = await tokenWith(2);
    dbRows = [userRow];
    const user = await getSessionUser();
    expect(user?.id).toBe(1);
  });

  it('rejects cookies issued before a tokenVersion bump (revocation)', async () => {
    sessionCookieValue = await tokenWith(1);
    dbRows = [userRow];
    expect(await getSessionUser()).toBeNull();
  });

  it('treats legacy tokens without tv as version 0', async () => {
    sessionCookieValue = await tokenWith(undefined);
    dbRows = [{ ...userRow, tokenVersion: 0 }];
    expect((await getSessionUser())?.id).toBe(1);

    dbRows = [userRow]; // DB is at version 2
    expect(await getSessionUser()).toBeNull();
  });

  it('rejects soft-deleted users (no row matches deletedAt IS NULL)', async () => {
    sessionCookieValue = await tokenWith(2);
    dbRows = [];
    expect(await getSessionUser()).toBeNull();
  });

  it('rejects absent session cookie', async () => {
    sessionCookieValue = null;
    expect(await getSessionUser()).toBeNull();
  });
});
