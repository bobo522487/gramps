import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAccount,
  updateAccount,
  updatePassword,
} from '@/lib/auth/actions/account';
import { signOut, signUp } from '@/lib/auth/actions/session';
import { resetRateLimitStore } from '@/lib/auth/rate-limit';
import {
  ActivityType,
  activityLogs,
  invitations,
  orgMembers,
  users,
} from '@/lib/db/schema';
import { archiveOrganization } from '@/lib/db/services';
import { createOrgAction, removeOrgMember } from '@/lib/org/actions';
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

const sessionStore = vi.hoisted(() => ({
  values: new Map<string, string>(),
  deletes: [] as string[],
  redirects: [] as string[],
  sets: 0,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = sessionStore.values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      sessionStore.values.set(name, value);
      sessionStore.sets += 1;
    },
    delete: (name: string) => {
      sessionStore.values.delete(name);
      sessionStore.deletes.push(name);
    },
  }),
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    sessionStore.redirects.push(path);
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

async function authenticate(user: { id: string; tokenVersion: number }) {
  sessionStore.values.set(
    'session',
    await signSessionFor(user.id, user.tokenVersion)
  );
}

async function countUsers() {
  const rows = await getTestSql()<{ count: number }[]>`
    SELECT count(*)::int AS count FROM auth.users
  `;
  return rows[0]?.count ?? 0;
}

beforeEach(() => {
  sessionStore.values.clear();
  sessionStore.deletes.length = 0;
  sessionStore.redirects.length = 0;
  sessionStore.sets = 0;
  resetRateLimitStore();
});

describe('signUp action', () => {
  it('creates a personal organization and session', async () => {
    const result = await signUp(
      {},
      form({ email: '  Alice@Example.COM ', password: 'sign-up-password' })
    );

    expect(result).toBeUndefined();
    expect(sessionStore.redirects).toEqual(['/dashboard']);
    expect(sessionStore.sets).toBe(1);

    const db = getTestDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'alice@example.com'));

    expect(user).toBeDefined();

    const memberships = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, user.id));
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('owner');
  });

  it('leaves no user when the invitation token is invalid', async () => {
    const result = await signUp(
      {},
      form({
        email: 'ghost@example.com',
        password: 'sign-up-password',
        invite: 'not-a-real-token',
      })
    );

    expect(result).toMatchObject({ error: '邀请无效或已过期。' });
    expect(await countUsers()).toBe(0);
  });

  it('joins the invited organization and accepts the invitation', async () => {
    const owner = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });
    const invitation = await createInvitation({
      orgId: organization.id,
      invitedBy: owner.id,
      email: 'invitee@example.com',
      role: 'editor',
    });

    await signUp(
      {},
      form({
        email: 'invitee@example.com',
        password: 'sign-up-password',
        invite: invitation.token,
      })
    );

    const db = getTestDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'invitee@example.com'));
    const memberships = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, user.id));

    expect(memberships).toHaveLength(2);
    expect(memberships.find((row) => row.orgId === organization.id)?.role).toBe(
      'editor'
    );

    const [accepted] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(accepted.acceptedAt).not.toBeNull();
  });

  it('rejects a duplicate email without creating a second account', async () => {
    await createUser({ email: 'taken@example.com' });

    const result = await signUp(
      {},
      form({ email: 'taken@example.com', password: 'sign-up-password' })
    );

    expect(result).toMatchObject({
      error: '该邮箱已被注册，请直接登录。',
    });
    expect(await countUsers()).toBe(1);
  });
});

describe('signOut action', () => {
  it('clears the cookie even when the session is already invalid', async () => {
    await expect(signOut()).resolves.toBeUndefined();
    expect(sessionStore.deletes).toContain('session');
  });

  it('logs the sign-out for a valid user without org attribution', async () => {
    const user = await createUser();
    await authenticate(user);

    await signOut();

    const logs = await getTestDb()
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, user.id));

    expect(logs.map((log) => log.action)).toEqual([ActivityType.SIGN_OUT]);
    expect(logs[0].orgId).toBeNull();
    expect(sessionStore.deletes).toContain('session');
  });
});

describe('updateAccount action', () => {
  it('rejects unauthenticated calls without throwing', async () => {
    const result = await updateAccount(
      {},
      form({ name: '新名字', email: 'new@example.com' })
    );

    expect(result).toEqual({
      error: '登录已失效，请重新登录。',
      code: 'UNAUTHORIZED',
    });
  });

  it('requires the current password when the email changes', async () => {
    const user = await createUser({ email: 'old@example.com' });
    await authenticate(user);

    const result = await updateAccount(
      {},
      form({ name: '新名字', email: 'new@example.com' })
    );

    expect(result).toMatchObject({
      error: '修改邮箱需要输入当前密码。',
      fieldErrors: { currentPassword: '请输入当前密码' },
    });
  });

  it('rejects a wrong current password', async () => {
    const user = await createUser({ email: 'old@example.com' });
    await authenticate(user);

    const result = await updateAccount(
      {},
      form({
        name: '新名字',
        email: 'new@example.com',
        currentPassword: 'wrong-password',
      })
    );

    expect(result).toMatchObject({ error: '当前密码不正确。' });
  });

  it('normalizes a new email after verifying the password', async () => {
    const user = await createUser({ email: 'old@example.com' });
    await authenticate(user);

    const result = await updateAccount(
      {},
      form({
        name: '新名字',
        email: 'New@Example.COM ',
        currentPassword: TEST_PASSWORD,
      })
    );

    expect(result).toMatchObject({
      success: '账号信息已更新。',
      email: 'new@example.com',
    });
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('currentPassword');

    const [updated] = await getTestDb()
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(updated.email).toBe('new@example.com');
    expect(updated.name).toBe('新名字');

    const logs = await getTestDb()
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, user.id));
    expect(logs.map((log) => log.action)).toContain(
      ActivityType.UPDATE_ACCOUNT
    );
  });

  it('returns a field error instead of throwing on a duplicate email', async () => {
    await createUser({ email: 'taken@example.com' });
    const user = await createUser({ email: 'old@example.com' });
    await authenticate(user);

    const result = await updateAccount(
      {},
      form({
        name: '新名字',
        email: 'taken@example.com',
        currentPassword: TEST_PASSWORD,
      })
    );

    expect(result).toMatchObject({
      error: '该邮箱已被使用。',
      fieldErrors: { email: '该邮箱已被使用' },
    });
  });

  it('updates the name without requiring a password', async () => {
    const user = await createUser({ email: 'old@example.com' });
    await authenticate(user);

    const result = await updateAccount(
      {},
      form({ name: '只改名字', email: 'old@example.com' })
    );

    expect(result).toMatchObject({ success: '账号信息已更新。' });

    const [updated] = await getTestDb()
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(updated.name).toBe('只改名字');
    expect(updated.email).toBe('old@example.com');
  });
});

describe('updatePassword action', () => {
  it('bumps the token version, re-signs the device and logs the change', async () => {
    const user = await createUser();
    await authenticate(user);

    const result = await updatePassword(
      {},
      form({
        currentPassword: TEST_PASSWORD,
        newPassword: 'a-brand-new-password',
        confirmPassword: 'a-brand-new-password',
      })
    );

    expect(result).toMatchObject({ success: '密码已更新。' });
    expect(sessionStore.sets).toBe(1);

    const [updated] = await getTestDb()
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(updated.tokenVersion).toBe(user.tokenVersion + 1);
    expect(updated.passwordHash).not.toBe(user.passwordHash);

    const logs = await getTestDb()
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, user.id));
    expect(logs.map((log) => log.action)).toContain(
      ActivityType.UPDATE_PASSWORD
    );
  });

  it('rejects a wrong current password without touching the session', async () => {
    const user = await createUser();
    await authenticate(user);

    const result = await updatePassword(
      {},
      form({
        currentPassword: 'wrong-password',
        newPassword: 'a-brand-new-password',
        confirmPassword: 'a-brand-new-password',
      })
    );

    expect(result).toMatchObject({ error: '当前密码不正确。' });
    expect(sessionStore.sets).toBe(0);
  });
});

describe('deleteAccount action', () => {
  it('refuses to delete the only owner of an active organization', async () => {
    const user = await createUser();
    const personal = await getPersonalOrg(user.id);
    await authenticate(user);

    const result = await deleteAccount({}, form({ password: TEST_PASSWORD }));

    expect(result).toMatchObject({
      error: expect.stringContaining('唯一所有者'),
    });
    expect(sessionStore.deletes).not.toContain('session');

    const [unchanged] = await getTestDb()
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(unchanged.deletedAt).toBeNull();
    expect(personal?.organization.name).toContain('test-');
  });

  it('removes every membership and revokes the session on success', async () => {
    const user = await createUser();
    const personal = await getPersonalOrg(user.id);
    await archiveOrganization({
      userId: user.id,
      orgId: personal?.organization.id as string,
    });
    const otherOwner = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: otherOwner.id,
      orgId: organization.id,
      role: 'owner',
    });
    await addMember({
      userId: user.id,
      orgId: organization.id,
      role: 'viewer',
    });
    await authenticate(user);

    const result = await deleteAccount({}, form({ password: TEST_PASSWORD }));

    expect(result).toBeUndefined();
    expect(sessionStore.deletes).toContain('session');
    expect(sessionStore.redirects).toContain('/sign-in');

    const db = getTestDb();
    const memberships = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, user.id));
    expect(memberships).toHaveLength(2);
    expect(memberships.every((row) => row.deletedAt !== null)).toBe(true);

    const [deleted] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.tokenVersion).toBe(user.tokenVersion + 1);

    const logs = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, user.id));
    expect(logs.some((log) => log.action === ActivityType.DELETE_ACCOUNT)).toBe(
      true
    );
  });

  it('rejects a wrong password', async () => {
    const user = await createUser();
    await authenticate(user);

    const result = await deleteAccount(
      {},
      form({ password: 'wrong-password' })
    );

    expect(result).toMatchObject({
      error: '密码不正确，账号删除失败。',
    });
    expect(sessionStore.deletes).not.toContain('session');
  });
});

describe('org actions', () => {
  it('creates an organization for the signed-in owner', async () => {
    const user = await createUser();
    await authenticate(user);

    const result = await createOrgAction({}, form({ name: '颍川陈氏' }));

    expect(result).toMatchObject({
      success: '组织已创建',
      orgSlug: expect.any(String),
    });
  });

  it('rejects an actor without member.manage', async () => {
    const actor = await createUser();
    const target = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: actor.id,
      orgId: organization.id,
      role: 'viewer',
    });
    const targetMembership = await addMember({
      userId: target.id,
      orgId: organization.id,
      role: 'editor',
    });
    await authenticate(actor);

    const result = await removeOrgMember(
      {},
      form({
        orgId: organization.id,
        memberId: targetMembership.id,
      })
    );

    expect(result).toMatchObject({
      error: '只有所有者或管理员可以移除成员',
    });
  });

  it('rejects self-removal by an owner', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);
    await authenticate(owner);

    const result = await removeOrgMember(
      {},
      form({
        orgId: personal?.organization.id as string,
        memberId: personal?.membership.id as string,
      })
    );

    expect(result).toMatchObject({
      error: '不能移除自己，请先转让所有权',
    });
  });

  it('removes a member for an owner', async () => {
    const owner = await createUser();
    const target = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });
    const targetMembership = await addMember({
      userId: target.id,
      orgId: organization.id,
      role: 'viewer',
    });
    await authenticate(owner);

    const result = await removeOrgMember(
      {},
      form({
        orgId: organization.id,
        memberId: targetMembership.id,
      })
    );

    expect(result).toMatchObject({ success: '已移除组织成员' });

    const [removed] = await getTestDb()
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.id, targetMembership.id));
    expect(removed.deletedAt).not.toBeNull();
  });
});
