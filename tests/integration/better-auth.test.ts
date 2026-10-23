import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAccount,
  updateAccount,
  updatePassword,
} from '@/lib/auth/actions/account';
import { signIn, signOut, signUp } from '@/lib/auth/actions/session';
import { getSessionUser } from '@/lib/auth/context';
import { resetRateLimitStore } from '@/lib/auth/rate-limit';
import {
  ActivityType,
  activityLogs,
  invitations,
  organizations,
  orgMembers,
  sessions,
  users,
} from '@/lib/db/schema';
import {
  acceptInviteAction,
  createOrgAction,
  deleteOrgAction,
  inviteOrgMember,
  removeOrgMember,
  renameOrgAction,
  updateOrgMemberRole,
} from '@/lib/org/actions';
import { signSessionFor } from '../helpers/auth';
import { getTestDb, getTestSql } from '../helpers/db';
import {
  addMember,
  createInvitation,
  createOrganization,
  createUser,
  getPersonalOrg,
  TEST_PASSWORD,
} from '../helpers/factories';

const state = vi.hoisted(() => {
  class RedirectError extends Error {
    constructor(readonly path: string) {
      super(`NEXT_REDIRECT:${path}`);
    }
  }
  const cookies = new Map<string, string>();
  const cookieStore = async () => ({
    get: (name: string) => {
      const value = cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    has: (name: string) => cookies.has(name),
    set: (name: string, value: string) => {
      cookies.set(name, value);
    },
    delete: (name: string) => {
      cookies.delete(name);
    },
  });
  const headers = async () => {
    const result = new Headers({ 'x-forwarded-for': '127.0.0.1' });
    if (cookies.size > 0) {
      result.set(
        'cookie',
        [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
      );
    }
    return result;
  };
  return {
    RedirectError,
    cookies,
    cookieStore,
    headers,
    redirects: [] as string[],
    ids: [] as string[],
  };
});

vi.mock('next/headers', () => ({
  cookies: state.cookieStore,
  headers: state.headers,
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    state.redirects.push(path);
    throw new state.RedirectError(path);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

vi.mock('@/lib/ids', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ids')>();
  return {
    ...actual,
    generatePublicId: () => state.ids.shift() ?? actual.generatePublicId(),
  };
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

function applyCookie(cookie: string) {
  state.cookies.clear();
  const separator = cookie.indexOf('=');
  state.cookies.set(cookie.slice(0, separator), cookie.slice(separator + 1));
}

async function authenticate(email: string, password = TEST_PASSWORD) {
  applyCookie(await signSessionFor(email, password));
}

async function expectRedirect(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof state.RedirectError) {
      return error.path;
    }
    throw error;
  }
  throw new Error('expected a redirect');
}

async function countUsers(email: string) {
  const rows = await getTestSql()<
    { count: number }[]
  >`select count(*)::int as count from auth.users where email = ${email}`;
  return rows[0]?.count ?? 0;
}

async function clearSessions(userId: string) {
  await getTestDb().delete(sessions).where(eq(sessions.userId, userId));
}

async function membership(organizationId: string, userId: string) {
  const [row] = await getTestDb()
    .select()
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.organizationId, organizationId),
        eq(orgMembers.userId, userId)
      )
    );
  return row ?? null;
}

async function invitationRows(organizationId: string) {
  return getTestDb()
    .select()
    .from(invitations)
    .where(eq(invitations.organizationId, organizationId))
    .orderBy(invitations.createdAt);
}

beforeEach(() => {
  state.cookies.clear();
  state.redirects.length = 0;
  state.ids.length = 0;
  resetRateLimitStore();
});

describe('registration and session lifecycle', () => {
  it('creates the user, a personal organization and an owner membership', async () => {
    await expectRedirect(
      signUp(
        {},
        form({
          email: '  Alice@Example.COM ',
          password: 'sign-up-password',
        })
      )
    );

    const [user] = await getTestDb()
      .select()
      .from(users)
      .where(eq(users.email, 'alice@example.com'));
    expect(user).toBeDefined();
    expect(user.name).toBe('alice');

    const personal = await getPersonalOrg(user.id);
    expect(personal?.membership.role).toBe('owner');
    expect(personal?.organization.slug).toMatch(/^[a-z0-9]{20}$/);
    expect(personal?.organization.name).toBe('alice');

    expect(
      await getTestDb()
        .select()
        .from(sessions)
        .where(eq(sessions.userId, user.id))
    ).toHaveLength(1);
    const logs = await getTestDb()
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, user.id));
    expect(logs.map((log) => log.action)).toContain(ActivityType.SIGN_UP);

    await authenticate(user.email, 'sign-up-password');
    expect(await getSessionUser()).toEqual({
      id: user.id,
      name: 'alice',
      email: 'alice@example.com',
    });
  });

  it('rejects a duplicate email without creating a second account', async () => {
    await createUser({ email: 'taken@example.com' });

    const result = await signUp(
      {},
      form({ email: 'taken@example.com', password: 'sign-up-password' })
    );

    expect(result).toMatchObject({ error: '该邮箱已被注册，请直接登录。' });
    expect(await countUsers('taken@example.com')).toBe(1);
  });

  it('signs in, exposes only the SessionUser shape and redirects', async () => {
    const user = await createUser({
      email: 'signin@example.com',
      name: '陈实',
    });
    await clearSessions(user.id);

    const path = await expectRedirect(
      signIn({}, form({ email: 'signin@example.com', password: TEST_PASSWORD }))
    );

    expect(path).toBe('/dashboard');
    expect(
      await getTestDb()
        .select()
        .from(sessions)
        .where(eq(sessions.userId, user.id))
    ).toHaveLength(1);

    await authenticate(user.email);
    const sessionUser = await getSessionUser();
    expect(sessionUser).toEqual({
      id: user.id,
      name: '陈实',
      email: 'signin@example.com',
    });
    expect(Object.keys(sessionUser ?? {}).sort()).toEqual([
      'email',
      'id',
      'name',
    ]);

    const logs = await getTestDb()
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, user.id));
    expect(logs.map((log) => log.action)).toContain(ActivityType.SIGN_IN);
  });

  it('returns the Chinese error for a wrong password', async () => {
    await createUser({ email: 'wrong@example.com' });

    const result = await signIn(
      {},
      form({ email: 'wrong@example.com', password: 'not-the-password' })
    );

    expect(result).toMatchObject({ error: '邮箱或密码不正确，请重试。' });
    expect(await getSessionUser()).toBeNull();
  });

  it('sends a signed-in invitee to the join page', async () => {
    const user = await createUser({ email: 'invited-signin@example.com' });
    const invitationId = '0199c0de-0000-7000-8000-000000000001';

    const path = await expectRedirect(
      signIn(
        {},
        form({
          email: user.email,
          password: TEST_PASSWORD,
          invite: invitationId,
        })
      )
    );

    expect(path).toBe(`/dashboard/join?invite=${invitationId}`);
  });

  it('treats the session row as authoritative', async () => {
    const user = await createUser({ email: 'revoked@example.com' });
    await authenticate(user.email);
    expect(await getSessionUser()).not.toBeNull();

    await getTestDb().delete(sessions).where(eq(sessions.userId, user.id));

    expect(await getSessionUser()).toBeNull();
  });

  it('signs out by deleting the server session and logging the action', async () => {
    const user = await createUser({ email: 'bye@example.com' });
    await clearSessions(user.id);
    await authenticate(user.email);

    await signOut();

    expect(await getSessionUser()).toBeNull();
    const rows = await getTestDb()
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(0);

    const logs = await getTestDb()
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, user.id));
    expect(logs.map((log) => log.action)).toEqual([ActivityType.SIGN_OUT]);

    await expect(signOut()).resolves.toBeUndefined();
  });
});

describe('account actions', () => {
  it('updates the display name without touching the email', async () => {
    const user = await createUser({ email: 'rename@example.com' });
    await authenticate(user.email);

    const result = await updateAccount(
      {},
      form({ name: '新名字', email: 'ignored@example.com' })
    );

    expect(result).toMatchObject({ success: '账号信息已更新。' });
    const [updated] = await getTestDb()
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(updated.name).toBe('新名字');
    expect(updated.email).toBe('rename@example.com');

    const logs = await getTestDb()
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, user.id));
    expect(logs.map((log) => log.action)).toContain(
      ActivityType.UPDATE_ACCOUNT
    );
  });

  it('requires an authenticated caller', async () => {
    const result = await updateAccount({}, form({ name: '新名字' }));

    expect(result).toEqual({
      error: '登录已失效，请重新登录。',
      code: 'UNAUTHORIZED',
    });
  });

  it('rotates the current session and revokes the others on password change', async () => {
    const user = await createUser({ email: 'password@example.com' });
    await clearSessions(user.id);
    const first = await signSessionFor(user.email);
    const second = await signSessionFor(user.email);
    const before = await getTestDb()
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    expect(before).toHaveLength(2);

    applyCookie(first);
    const result = await updatePassword(
      {},
      form({
        currentPassword: TEST_PASSWORD,
        newPassword: 'a-brand-new-password',
        confirmPassword: 'a-brand-new-password',
      })
    );
    expect(result).toMatchObject({ success: '密码已更新。' });

    // Better Auth revokes every session and issues a replacement for the
    // device that changed the password; the browser receives it through the
    // session cookie, which E2E covers.
    const after = await getTestDb()
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    expect(after).toHaveLength(1);
    expect(before.map((row) => row.token)).not.toContain(after[0].token);

    applyCookie(first);
    expect(await getSessionUser()).toBeNull();
    applyCookie(second);
    expect(await getSessionUser()).toBeNull();

    await expect(signSessionFor(user.email, TEST_PASSWORD)).rejects.toThrow();
    applyCookie(await signSessionFor(user.email, 'a-brand-new-password'));
    expect(await getSessionUser()).not.toBeNull();

    const logs = await getTestDb()
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, user.id));
    expect(logs.map((log) => log.action)).toContain(
      ActivityType.UPDATE_PASSWORD
    );
  });

  it('rejects a wrong current password without touching sessions', async () => {
    const user = await createUser({ email: 'wrong-password@example.com' });
    await authenticate(user.email);

    const result = await updatePassword(
      {},
      form({
        currentPassword: 'wrong-password',
        newPassword: 'a-brand-new-password',
        confirmPassword: 'a-brand-new-password',
      })
    );

    expect(result).toMatchObject({ error: '当前密码不正确。' });
    expect(await getSessionUser()).not.toBeNull();
  });

  it('refuses to delete a sole owner and succeeds after archiving', async () => {
    const user = await createUser({ email: 'delete@example.com' });
    const personal = await getPersonalOrg(user.id);
    await authenticate(user.email);

    const blocked = await deleteAccount({}, form({ password: TEST_PASSWORD }));
    expect(blocked).toMatchObject({
      error: expect.stringContaining('唯一所有者'),
    });
    expect(await countUsers('delete@example.com')).toBe(1);

    const archived = await deleteOrgAction(
      {},
      form({ orgId: personal?.organization.id as string })
    );
    expect(archived).toMatchObject({ success: '组织已归档' });

    const path = await expectRedirect(
      deleteAccount({}, form({ password: TEST_PASSWORD }))
    );
    expect(path).toBe('/sign-in');
    expect(await countUsers('delete@example.com')).toBe(0);
    expect(
      await membership(personal?.organization.id as string, user.id)
    ).toBeNull();
    expect(await getSessionUser()).toBeNull();

    const login = await signIn(
      {},
      form({ email: 'delete@example.com', password: TEST_PASSWORD })
    );
    expect(login).toMatchObject({ error: '邮箱或密码不正确，请重试。' });
  });

  it('rejects a wrong password when deleting the account', async () => {
    const user = await createUser({ email: 'delete-wrong@example.com' });
    const personal = await getPersonalOrg(user.id);
    await authenticate(user.email);
    await deleteOrgAction(
      {},
      form({ orgId: personal?.organization.id as string })
    );

    const result = await deleteAccount(
      {},
      form({ password: 'wrong-password' })
    );

    expect(result).toMatchObject({
      error: '当前密码不正确。',
    });
    expect(await countUsers('delete-wrong@example.com')).toBe(1);
  });
});

describe('organization actions', () => {
  it('creates an organization with a 20-char public slug', async () => {
    const user = await createUser();
    await authenticate(user.email);

    const result = await createOrgAction({}, form({ name: '颍川陈氏' }));

    expect(result).toMatchObject({
      success: '组织已创建',
      orgId: expect.any(String),
      orgSlug: expect.stringMatching(/^[a-z0-9]{20}$/),
    });
    if (!('orgId' in result) || !result.orgId) {
      throw new Error('organization was not returned');
    }
    const [organization] = await getTestDb()
      .select()
      .from(organizations)
      .where(eq(organizations.id, result.orgId));
    expect(organization.name).toBe('颍川陈氏');
    expect(organization.slug).toBe(result.orgSlug);
    expect((await membership(organization.id, user.id))?.role).toBe('owner');
  });

  it('retries when the generated slug collides', async () => {
    const user = await createUser();
    await authenticate(user.email);
    await createOrganization({
      name: '占位组织',
      slug: '0123456789abcdefghij',
    });
    state.ids.push('0123456789abcdefghij', 'zyxwvutsrqponmlkjihg');

    const result = await createOrgAction({}, form({ name: '重试成功' }));

    expect(result).toMatchObject({
      success: '组织已创建',
      orgSlug: 'zyxwvutsrqponmlkjihg',
    });
    expect(state.ids).toHaveLength(0);
  });

  it('renames an organization for owners only', async () => {
    const owner = await createUser();
    const admin = await createUser();
    const organization = await createOrganization({ name: '旧名称' });
    await addMember({
      userId: owner.id,
      organizationId: organization.id,
      role: 'owner',
    });
    await addMember({
      userId: admin.id,
      organizationId: organization.id,
      role: 'admin',
    });

    await authenticate(owner.email);
    const renamed = await renameOrgAction(
      {},
      form({ orgId: organization.id, name: '新名称' })
    );
    expect(renamed).toMatchObject({ success: '组织已重命名' });

    await authenticate(admin.email);
    const denied = await renameOrgAction(
      {},
      form({ orgId: organization.id, name: '管理员改名' })
    );
    expect(denied).toMatchObject({
      error: '只有所有者可以修改组织设置',
    });

    const [row] = await getTestDb()
      .select()
      .from(organizations)
      .where(eq(organizations.id, organization.id));
    expect(row.name).toBe('新名称');
  });

  it('blocks invitations and joins after the organization is archived', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const personal = await getPersonalOrg(owner.id);
    const organizationId = personal?.organization.id as string;
    const invitation = await createInvitation({
      organizationId,
      inviterId: owner.id,
      email: invitee.email,
      role: 'editor',
    });

    await authenticate(owner.email);
    const archived = await deleteOrgAction({}, form({ orgId: organizationId }));
    expect(archived).toMatchObject({ success: '组织已归档' });

    const invited = await inviteOrgMember(
      {},
      form({
        orgId: organizationId,
        email: 'later@example.com',
        role: 'viewer',
      })
    );
    expect(invited).toMatchObject({ error: '组织不存在或已归档' });

    await authenticate(invitee.email);
    const accepted = await acceptInviteAction(
      {},
      form({ invitationId: invitation.id })
    );
    expect(accepted).toMatchObject({ error: expect.any(String) });
    expect(await membership(organizationId, invitee.id)).toBeNull();
  });
});

describe('invitations', () => {
  async function setUpOwner() {
    const owner = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: owner.id,
      organizationId: organization.id,
      role: 'owner',
    });
    await authenticate(owner.email);
    return { owner, organization };
  }

  it('creates an invitation and lets the matching account join', async () => {
    const { owner, organization } = await setUpOwner();
    const invitee = await createUser({ email: 'invitee@example.com' });

    const created = await inviteOrgMember(
      {},
      form({
        orgId: organization.id,
        email: 'Invitee@Example.com',
        role: 'editor',
      })
    );
    expect(created).toMatchObject({
      success: '邀请已创建，请把链接发送给对方。',
    });

    const rows = await invitationRows(organization.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'invitee@example.com',
      role: 'editor',
      status: 'pending',
      inviterId: owner.id,
    });
    const inviteUrl = (created as { inviteUrl?: string }).inviteUrl;
    expect(inviteUrl).toBe(
      `http://localhost:3000/sign-up?invite=${rows[0].id}`
    );

    await authenticate(invitee.email);
    const accepted = await acceptInviteAction(
      {},
      form({ invitationId: rows[0].id })
    );
    expect(accepted).toMatchObject({ success: '已加入组织' });
    expect((await membership(organization.id, invitee.id))?.role).toBe(
      'editor'
    );

    const [updated] = await invitationRows(organization.id);
    expect(updated.status).toBe('accepted');
  });

  it('rejects an invitation addressed to another email', async () => {
    const { owner, organization } = await setUpOwner();
    const other = await createUser({ email: 'other@example.com' });
    const invitation = await createInvitation({
      organizationId: organization.id,
      inviterId: owner.id,
      email: 'intended@example.com',
    });

    await authenticate(other.email);
    const result = await acceptInviteAction(
      {},
      form({ invitationId: invitation.id })
    );

    expect(result).toMatchObject({
      error: '该邀请不属于当前登录账号。',
    });
    expect(await membership(organization.id, other.id)).toBeNull();
    expect((await invitationRows(organization.id))[0].status).toBe('pending');
  });

  it('rejects an expired invitation', async () => {
    const { owner, organization } = await setUpOwner();
    const invitee = await createUser({ email: 'late@example.com' });
    const invitation = await createInvitation({
      organizationId: organization.id,
      inviterId: owner.id,
      email: invitee.email,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await authenticate(invitee.email);
    const result = await acceptInviteAction(
      {},
      form({ invitationId: invitation.id })
    );

    expect(result).toMatchObject({ error: '邀请无效或已过期。' });
    expect(await membership(organization.id, invitee.id)).toBeNull();
  });

  it('cancels the previous pending invitation when reinvited', async () => {
    const { organization } = await setUpOwner();

    await inviteOrgMember(
      {},
      form({
        orgId: organization.id,
        email: 'again@example.com',
        role: 'viewer',
      })
    );
    await inviteOrgMember(
      {},
      form({
        orgId: organization.id,
        email: 'again@example.com',
        role: 'editor',
      })
    );

    const rows = await invitationRows(organization.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status)).toEqual(['canceled', 'pending']);
    expect(rows[1].role).toBe('editor');
  });

  it('cancels an expired invitation before issuing a new one', async () => {
    const { owner, organization } = await setUpOwner();
    const expired = await createInvitation({
      organizationId: organization.id,
      inviterId: owner.id,
      email: 'refresh@example.com',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await inviteOrgMember(
      {},
      form({
        orgId: organization.id,
        email: 'refresh@example.com',
        role: 'viewer',
      })
    );
    expect(result).toMatchObject({
      success: '邀请已创建，请把链接发送给对方。',
    });

    const rows = await invitationRows(organization.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === expired.id)?.status).toBe('canceled');
    expect(rows.filter((row) => row.status === 'pending')).toHaveLength(1);
  });
});

describe('member management', () => {
  async function setUpMembers() {
    const owner = await createUser();
    const admin = await createUser();
    const peerAdmin = await createUser();
    const editor = await createUser();
    const viewer = await createUser();
    const organization = await createOrganization();

    const ownerMember = await addMember({
      userId: owner.id,
      organizationId: organization.id,
      role: 'owner',
    });
    const adminMember = await addMember({
      userId: admin.id,
      organizationId: organization.id,
      role: 'admin',
    });
    const peerAdminMember = await addMember({
      userId: peerAdmin.id,
      organizationId: organization.id,
      role: 'admin',
    });
    const editorMember = await addMember({
      userId: editor.id,
      organizationId: organization.id,
      role: 'editor',
    });
    const viewerMember = await addMember({
      userId: viewer.id,
      organizationId: organization.id,
    });

    await authenticate(owner.email);
    return {
      owner,
      admin,
      editor,
      viewer,
      organization,
      ownerMember,
      adminMember,
      peerAdminMember,
      editorMember,
      viewerMember,
    };
  }

  it('removes a member and promotes another one', async () => {
    const context = await setUpMembers();

    const removed = await removeOrgMember(
      {},
      form({
        orgId: context.organization.id,
        memberId: context.viewerMember.id,
      })
    );
    expect(removed).toMatchObject({ success: '已移除组织成员' });
    expect(
      await membership(context.organization.id, context.viewer.id)
    ).toBeNull();

    const promoted = await updateOrgMemberRole(
      {},
      form({
        orgId: context.organization.id,
        memberId: context.editorMember.id,
        role: 'admin',
      })
    );
    expect(promoted).toMatchObject({ success: '成员角色已更新' });
    expect(
      (await membership(context.organization.id, context.editor.id))?.role
    ).toBe('admin');
  });

  it('protects owners and prevents self-removal', async () => {
    const context = await setUpMembers();

    const self = await removeOrgMember(
      {},
      form({
        orgId: context.organization.id,
        memberId: context.ownerMember.id,
      })
    );
    expect(self).toMatchObject({
      error: '不能移除自己，请先转让所有权',
    });

    const ownerRole = await updateOrgMemberRole(
      {},
      form({
        orgId: context.organization.id,
        memberId: context.ownerMember.id,
        role: 'admin',
      })
    );
    expect(ownerRole).toMatchObject({
      error: '不能修改所有者的角色',
    });

    await authenticate(context.admin.email);
    const lastOwner = await removeOrgMember(
      {},
      form({
        orgId: context.organization.id,
        memberId: context.ownerMember.id,
      })
    );
    expect(lastOwner).toMatchObject({
      error: '不能移除最后一个所有者',
    });
  });

  it('does not let admins manage other admins', async () => {
    const context = await setUpMembers();
    await authenticate(context.admin.email);

    const role = await updateOrgMemberRole(
      {},
      form({
        orgId: context.organization.id,
        memberId: context.peerAdminMember.id,
        role: 'viewer',
      })
    );
    expect(role).toMatchObject({
      error: '管理员不能管理其他管理员',
    });

    const removed = await removeOrgMember(
      {},
      form({
        orgId: context.organization.id,
        memberId: context.peerAdminMember.id,
      })
    );
    expect(removed).toMatchObject({
      error: '管理员不能管理其他管理员',
    });
  });

  it('rejects member management without the permission', async () => {
    const context = await setUpMembers();
    await authenticate(context.viewer.email);

    const removed = await removeOrgMember(
      {},
      form({
        orgId: context.organization.id,
        memberId: context.editorMember.id,
      })
    );
    expect(removed).toMatchObject({
      error: '只有所有者或管理员可以移除成员',
    });

    const role = await updateOrgMemberRole(
      {},
      form({
        orgId: context.organization.id,
        memberId: context.editorMember.id,
        role: 'admin',
      })
    );
    expect(role).toMatchObject({
      error: '你没有调整该成员角色的权限',
    });
  });
});

describe('auth routing surface', () => {
  it('does not expose any /api/auth route handler', () => {
    expect(existsSync(join(process.cwd(), 'app/api/auth'))).toBe(false);
  });
});
