import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAccount, updateAccount } from '@/lib/auth/actions/account';
import { signOut, signUp } from '@/lib/auth/actions/session';
import { resetRateLimitStore } from '@/lib/auth/rate-limit';
import {
  ActivityType,
  activityLogs,
  invitations,
  orgMembers,
  users,
} from '@/lib/db/schema';
import { removeOrgMember } from '@/lib/org/actions';
import { signSessionFor } from '../helpers/auth';
import { getTestDb } from '../helpers/db';
import {
  addMember,
  createInvitation,
  createOrganization,
  createUser,
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

async function authenticate(user: { id: number; tokenVersion: number }) {
  sessionStore.values.set(
    'session',
    await signSessionFor(user.id, user.tokenVersion)
  );
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

  it('leaves no user when the invitation id is invalid', async () => {
    const result = await signUp(
      {},
      form({
        email: 'ghost@example.com',
        password: 'sign-up-password',
        inviteId: '999999',
      })
    );

    expect(result).toMatchObject({ error: '邀请无效或已过期。' });
    expect(await getTestDb().select().from(users)).toHaveLength(0);
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
      role: 'member',
    });

    await signUp(
      {},
      form({
        email: 'invitee@example.com',
        password: 'sign-up-password',
        inviteId: String(invitation.id),
      })
    );

    const db = getTestDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'invitee@example.com'));
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, user.id));

    expect(membership.orgId).toBe(organization.id);
    expect(membership.role).toBe('member');

    const [accepted] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(accepted.status).toBe('accepted');
  });

  it('rejects a duplicate email without creating a second account', async () => {
    await createUser({ email: 'taken@example.com' });

    const result = await signUp(
      {},
      form({ email: 'taken@example.com', password: 'sign-up-password' })
    );

    expect(result).toMatchObject({ error: '创建账号失败，请重试。' });
    expect(await getTestDb().select().from(users)).toHaveLength(1);
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

    expect(result).toEqual({ error: '登录已失效，请重新登录。' });
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

    const [updated] = await getTestDb()
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(updated.email).toBe('new@example.com');
    expect(updated.name).toBe('新名字');
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

describe('deleteAccount action', () => {
  it('refuses to delete the only owner of an organization', async () => {
    const user = await createUser();
    const organization = await createOrganization({ name: '陈家宗族' });
    await addMember({ userId: user.id, orgId: organization.id, role: 'owner' });
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
  });

  it('removes every membership and revokes the session on success', async () => {
    const user = await createUser();
    const firstOrg = await createOrganization();
    const secondOrg = await createOrganization();
    await addMember({ userId: user.id, orgId: firstOrg.id, role: 'member' });
    await addMember({ userId: user.id, orgId: secondOrg.id, role: 'member' });
    await authenticate(user);

    const result = await deleteAccount({}, form({ password: TEST_PASSWORD }));

    expect(result).toBeUndefined();
    expect(sessionStore.deletes).toContain('session');
    expect(sessionStore.redirects).toContain('/sign-in');

    const db = getTestDb();
    expect(
      await db.select().from(orgMembers).where(eq(orgMembers.userId, user.id))
    ).toHaveLength(0);

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
});

describe('removeOrgMember action', () => {
  it('rejects an actor who is not an owner', async () => {
    const actor = await createUser();
    const target = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: actor.id,
      orgId: organization.id,
      role: 'member',
    });
    const targetMembership = await addMember({
      userId: target.id,
      orgId: organization.id,
    });
    await authenticate(actor);

    const result = await removeOrgMember(
      {},
      form({
        orgId: String(organization.id),
        memberId: String(targetMembership.id),
      })
    );

    expect(result).toMatchObject({ error: '只有所有者可以移除组织成员' });
  });

  it('rejects self-removal by an owner', async () => {
    const owner = await createUser();
    const organization = await createOrganization();
    const membership = await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });
    await authenticate(owner);

    const result = await removeOrgMember(
      {},
      form({
        orgId: String(organization.id),
        memberId: String(membership.id),
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
    });
    await authenticate(owner);

    const result = await removeOrgMember(
      {},
      form({
        orgId: String(organization.id),
        memberId: String(targetMembership.id),
      })
    );

    expect(result).toMatchObject({ success: '已移除组织成员' });

    const remaining = await getTestDb()
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.orgId, organization.id));
    expect(remaining.map((row) => row.id)).not.toContain(targetMembership.id);
  });
});
