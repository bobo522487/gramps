import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  addLogContext: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT ${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));

vi.mock('@/lib/auth/better-auth', () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } }),
}));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ cookie: 'better-auth.session_token=test-token' }),
}));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));
vi.mock('@/lib/server/request-context', () => ({
  addLogContext: mocks.addLogContext,
}));
vi.mock('@/lib/db/queries/organizations', () => ({
  getOrgWithRoleBySlug: vi.fn(),
}));
vi.mock('@/lib/db/queries/projects', () => ({
  getProjectScopeByRef: vi.fn(),
}));

import { getSessionUser, requireUser } from '@/lib/auth/context';

beforeEach(() => {
  mocks.getSession.mockReset();
  mocks.addLogContext.mockReset();
  mocks.redirect.mockClear();
});

describe('getSessionUser', () => {
  it('reads the Better Auth session from request headers', async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        id: '0190a5b0-0000-7000-8000-000000000001',
        name: '张三',
        email: 'zhang@example.com',
      },
    });

    await getSessionUser();

    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    const headers = mocks.getSession.mock.calls[0][0].headers;
    expect(headers).toBeInstanceOf(Headers);
    expect(headers.get('cookie')).toContain('better-auth.session_token');
  });

  it('returns only the three serializable user fields', async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        id: '0190a5b0-0000-7000-8000-000000000001',
        name: '张三',
        email: 'zhang@example.com',
        emailVerified: true,
        image: 'https://example.com/a.png',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: { token: 'secret-session-token' },
    });

    const user = await getSessionUser();

    expect(user).toEqual({
      id: '0190a5b0-0000-7000-8000-000000000001',
      name: '张三',
      email: 'zhang@example.com',
    });
    expect(Object.keys(user ?? {})).toHaveLength(3);
    expect(mocks.addLogContext).toHaveBeenCalledWith({
      user_id: '0190a5b0-0000-7000-8000-000000000001',
    });
  });

  it('returns null and logs nothing without a session', async () => {
    mocks.getSession.mockResolvedValue(null);

    expect(await getSessionUser()).toBeNull();
    expect(mocks.addLogContext).not.toHaveBeenCalled();
  });
});

describe('requireUser', () => {
  it('redirects to sign-in when no session exists', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow('REDIRECT /sign-in');
    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
  });
});
