import { hashSync } from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  ActivityType,
  activityLogs,
  invitations,
  organizations,
  orgMembers,
  users,
} from '@/lib/db/schema';
import {
  createOrganizationForOwner,
  deleteUserAccount,
  registerAccount,
  removeOrgMemberInTransaction,
} from '@/lib/db/services';
import { getTestDb, getTestSql } from '../helpers/db';
import {
  addMember,
  createInvitation,
  createOrganization,
  createUser,
} from '../helpers/factories';

const PASSWORD_HASH = hashSync('service-test-password', 4);

async function countRows(table: 'users' | 'organizations') {
  const rows = await getTestSql()<{ count: number }[]>`
    SELECT count(*)::int AS count FROM ${getTestSql()(table)}
  `;
  return rows[0]?.count ?? 0;
}

describe('registerAccount transaction', () => {
  it('creates user, organization, owner membership and logs atomically', async () => {
    const result = await registerAccount({
      email: 'new-owner@example.com',
      passwordHash: PASSWORD_HASH,
      ipAddress: '203.0.113.7',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const db = getTestDb();
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, result.user.id));

    expect(membership?.role).toBe('owner');

    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, membership.orgId));
    expect(organization?.name).toBe('new-owner 的组织');

    const logs = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, result.user.id));

    expect(logs.map((log) => log.action).sort()).toEqual([
      ActivityType.CREATE_ORG,
      ActivityType.SIGN_UP,
    ]);
    expect(
      logs.find((log) => log.action === ActivityType.SIGN_UP)?.orgId
    ).toBeNull();
    expect(
      logs.find((log) => log.action === ActivityType.CREATE_ORG)?.orgId
    ).toBe(organization?.id);
    expect(logs.every((log) => log.ipAddress === '203.0.113.7')).toBe(true);
  });

  it('joins the invited organization instead of creating one', async () => {
    const owner = await createUser();
    const organization = await createOrganization({ name: '颍川陈氏' });
    await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });
    const invitation = await createInvitation({
      orgId: organization.id,
      invitedBy: owner.id,
      email: 'invited@example.com',
      role: 'member',
    });

    const result = await registerAccount({
      email: 'invited@example.com',
      passwordHash: PASSWORD_HASH,
      inviteId: String(invitation.id),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const db = getTestDb();
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, result.user.id));

    expect(membership?.orgId).toBe(organization.id);
    expect(membership?.role).toBe('member');

    const [updatedInvitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(updatedInvitation?.status).toBe('accepted');

    expect(await countRows('organizations')).toBe(1);

    const logs = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, result.user.id));
    expect(logs.map((log) => log.action).sort()).toEqual([
      ActivityType.ACCEPT_INVITATION,
      ActivityType.SIGN_UP,
    ]);
  });

  it('leaves no user behind when the invitation is invalid', async () => {
    const result = await registerAccount({
      email: 'no-invite@example.com',
      passwordHash: PASSWORD_HASH,
      inviteId: '999999',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_invitation' });
    expect(await countRows('users')).toBe(0);
    expect(await countRows('organizations')).toBe(0);
  });

  it('rejects an invitation issued for another email', async () => {
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
      email: 'someone-else@example.com',
    });

    const result = await registerAccount({
      email: 'mismatch@example.com',
      passwordHash: PASSWORD_HASH,
      inviteId: String(invitation.id),
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_invitation' });

    const [ghost] = await getTestDb()
      .select()
      .from(users)
      .where(eq(users.email, 'mismatch@example.com'));
    expect(ghost).toBeUndefined();

    const [unchanged] = await getTestDb()
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(unchanged?.status).toBe('pending');
  });

  it('rejects a duplicate email without writing anything else', async () => {
    await createUser({ email: 'taken@example.com' });

    const result = await registerAccount({
      email: 'taken@example.com',
      passwordHash: PASSWORD_HASH,
    });

    expect(result).toEqual({ ok: false, reason: 'email_taken' });
    expect(await countRows('users')).toBe(1);
    expect(await countRows('organizations')).toBe(0);
  });
});

describe('createOrganizationForOwner transaction', () => {
  it('creates the organization with its owner membership and log', async () => {
    const user = await createUser();

    const organization = await createOrganizationForOwner({
      userId: user.id,
      name: '测试新组织',
    });

    const db = getTestDb();
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.orgId, organization.id));

    expect(membership?.userId).toBe(user.id);
    expect(membership?.role).toBe('owner');

    const logs = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.orgId, organization.id));
    expect(logs.map((log) => log.action)).toEqual([ActivityType.CREATE_ORG]);
  });
});

describe('removeOrgMemberInTransaction', () => {
  it('lets an owner remove a member and records the activity', async () => {
    const owner = await createUser();
    const member = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });
    const membership = await addMember({
      userId: member.id,
      orgId: organization.id,
      role: 'member',
    });

    const result = await removeOrgMemberInTransaction({
      orgId: organization.id,
      memberId: membership.id,
      actorId: owner.id,
    });

    expect(result).toEqual({ ok: true });

    const db = getTestDb();
    expect(
      await db.select().from(orgMembers).where(eq(orgMembers.id, membership.id))
    ).toHaveLength(0);

    const logs = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.orgId, organization.id));
    expect(logs.map((log) => log.action)).toEqual([
      ActivityType.REMOVE_ORG_MEMBER,
    ]);
  });

  it('rejects an actor who is only a member', async () => {
    const actor = await createUser();
    const member = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: actor.id,
      orgId: organization.id,
      role: 'member',
    });
    const membership = await addMember({
      userId: member.id,
      orgId: organization.id,
    });

    expect(
      await removeOrgMemberInTransaction({
        orgId: organization.id,
        memberId: membership.id,
        actorId: actor.id,
      })
    ).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('rejects removing yourself', async () => {
    const owner = await createUser();
    const organization = await createOrganization();
    const membership = await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });

    expect(
      await removeOrgMemberInTransaction({
        orgId: organization.id,
        memberId: membership.id,
        actorId: owner.id,
      })
    ).toEqual({ ok: false, reason: 'self_removal' });
  });

  it('rejects a membership from another organization', async () => {
    const owner = await createUser();
    const organization = await createOrganization();
    const otherOrganization = await createOrganization();
    await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });
    const foreignUser = await createUser();
    const foreignMembership = await addMember({
      userId: foreignUser.id,
      orgId: otherOrganization.id,
    });

    expect(
      await removeOrgMemberInTransaction({
        orgId: organization.id,
        memberId: foreignMembership.id,
        actorId: owner.id,
      })
    ).toEqual({ ok: false, reason: 'member_not_found' });
  });
});

describe('deleteUserAccount transaction', () => {
  it('removes every membership and revokes the account', async () => {
    const user = await createUser();
    const organizationA = await createOrganization();
    const organizationB = await createOrganization();
    await addMember({
      userId: user.id,
      orgId: organizationA.id,
      role: 'member',
    });
    await addMember({
      userId: user.id,
      orgId: organizationB.id,
      role: 'member',
    });
    const otherOwnerA = await createUser();
    await addMember({
      userId: otherOwnerA.id,
      orgId: organizationA.id,
      role: 'owner',
    });
    const otherOwnerB = await createUser();
    await addMember({
      userId: otherOwnerB.id,
      orgId: organizationB.id,
      role: 'owner',
    });

    const result = await deleteUserAccount({ userId: user.id });

    expect(result).toEqual({ ok: true });

    const db = getTestDb();
    expect(
      await db.select().from(orgMembers).where(eq(orgMembers.userId, user.id))
    ).toHaveLength(0);

    const [deleted] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));

    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.email).not.toBe(user.email);
    expect(deleted?.email.endsWith('-deleted')).toBe(true);
    expect(deleted?.tokenVersion).toBe(user.tokenVersion + 1);

    const logs = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, user.id));
    const deletionLog = logs.find(
      (log) => log.action === ActivityType.DELETE_ACCOUNT
    );
    expect(deletionLog?.orgId).toBeNull();
  });

  it('refuses to delete the only owner of an organization', async () => {
    const owner = await createUser();
    const organization = await createOrganization({ name: '唯一所有者的组织' });
    await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });

    const result = await deleteUserAccount({ userId: owner.id });

    expect(result).toEqual({
      ok: false,
      reason: 'sole_owner',
      orgNames: ['唯一所有者的组织'],
    });

    const db = getTestDb();
    const [unchanged] = await db
      .select()
      .from(users)
      .where(eq(users.id, owner.id));
    expect(unchanged?.deletedAt).toBeNull();
    expect(
      await db.select().from(orgMembers).where(eq(orgMembers.userId, owner.id))
    ).toHaveLength(1);
  });

  it('allows an owner to leave when another owner remains', async () => {
    const owner = await createUser();
    const coOwner = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });
    await addMember({
      userId: coOwner.id,
      orgId: organization.id,
      role: 'owner',
    });

    const result = await deleteUserAccount({ userId: owner.id });

    expect(result).toEqual({ ok: true });

    const remaining = await getTestDb()
      .select()
      .from(orgMembers)
      .where(
        and(eq(orgMembers.orgId, organization.id), eq(orgMembers.role, 'owner'))
      );
    expect(remaining.map((row) => row.userId)).toEqual([coOwner.id]);
  });
});
