import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let signToken: typeof import('@/lib/auth/session').signToken;
let verifyToken: typeof import('@/lib/auth/session').verifyToken;
let getSessionUser: typeof import('@/lib/auth/context').getSessionUser;
let sessionCookieValue: string | null = null;
let dbUser: {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date | null;
  deletedAt: Date | null;
} | null = null;

const USER_ID = '0190a5b0-0000-7000-8000-000000000001';

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET =
    'test-secret-value-long-enough-for-hs256-abcd';

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
  vi.doMock('@/lib/db/queries/users', () => ({
    getSessionUserById: async (id: string) =>
      dbUser && dbUser.id === id ? dbUser : null,
  }));

  ({ signToken, verifyToken } = await import('@/lib/auth/session'));
  ({ getSessionUser } = await import('@/lib/auth/context'));
});

describe('session token', () => {
  it('round-trips the user id and tokenVersion (tv) claim', async () => {
    const token = await signToken({
      user: { id: USER_ID },
      tv: 3,
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const payload = await verifyToken(token);
    expect(payload.user.id).toBe(USER_ID);
    expect(payload.tv).toBe(3);
  });

  it('rejects tokens with a bad signature', async () => {
    const token = await signToken({
      user: { id: USER_ID },
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
      user: { id: USER_ID },
      tv: 0,
      expires: new Date(Date.now() - 1000).toISOString(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('-1s')
      .sign(new TextEncoder().encode(process.env.BETTER_AUTH_SECRET));
    await expect(verifyToken(token)).rejects.toThrow();
  });
});

describe('getSessionUser authoritative checks', () => {
  const userRow = {
    id: USER_ID,
    email: 'a@b.c',
    name: '测试用户',
    passwordHash: 'x',
    tokenVersion: 2,
    createdAt: new Date(),
    updatedAt: null,
    deletedAt: null,
  };

  async function tokenWith(tv: number | undefined) {
    return signToken({
      user: { id: USER_ID },
      ...(tv === undefined ? {} : { tv }),
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    });
  }

  it('returns the user when tokenVersion matches', async () => {
    sessionCookieValue = await tokenWith(2);
    dbUser = userRow;
    const user = await getSessionUser();
    expect(user?.id).toBe(USER_ID);
  });

  it('rejects cookies issued before a tokenVersion bump (revocation)', async () => {
    sessionCookieValue = await tokenWith(1);
    dbUser = userRow;
    expect(await getSessionUser()).toBeNull();
  });

  it('treats legacy tokens without tv as version 0', async () => {
    sessionCookieValue = await tokenWith(undefined);
    dbUser = { ...userRow, tokenVersion: 0 };
    expect((await getSessionUser())?.id).toBe(USER_ID);

    dbUser = userRow; // DB is at version 2
    expect(await getSessionUser()).toBeNull();
  });

  it('rejects soft-deleted users', async () => {
    sessionCookieValue = await tokenWith(2);
    dbUser = { ...userRow, deletedAt: new Date() };
    expect(await getSessionUser()).toBeNull();
  });

  it('rejects a non-UUID subject without querying the database', async () => {
    sessionCookieValue = await signToken({
      user: { id: '1' },
      tv: 0,
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    });
    dbUser = userRow;
    expect(await getSessionUser()).toBeNull();
  });

  it('rejects absent session cookie', async () => {
    sessionCookieValue = null;
    dbUser = userRow;
    expect(await getSessionUser()).toBeNull();
  });

  it('returns null for a session subject that no longer exists', async () => {
    sessionCookieValue = await signToken({
      user: { id: randomUUID() },
      tv: 0,
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    });
    dbUser = userRow;
    expect(await getSessionUser()).toBeNull();
  });
});
