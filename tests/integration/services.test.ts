import { hashSync } from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { hashInviteToken } from '@/lib/auth/invite-token';
import {
  ActivityType,
  activityLogs,
  invitations,
  organizations,
  orgMembers,
  users,
} from '@/lib/db/schema';
import {
  acceptInvite,
  archiveOrganization,
  createOrganizationForOwner,
  deleteUserAccount,
  inviteOrgMember,
  registerAccount,
  removeOrgMemberInTransaction,
  updateOrgMemberRoleInTransaction,
} from '@/lib/db/services';
import { getTestDb, getTestSql } from '../helpers/db';
import {
  addMember,
  createInvitation,
  createOrganization,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

const PASSWORD_HASH = hashSync('service-test-password', 4);

async function countUsers() {
  const rows = await getTestSql()<{ count: number }[]>`
    SELECT count(*)::int AS count FROM auth.users
  `;
  return rows[0]?.count ?? 0;
}

async function countOrganizations() {
  const rows = await getTestSql()<{ count: number }[]>`
    SELECT count(*)::int AS count FROM organization
  `;
  return rows[0]?.count ?? 0;
}

describe('registerAccount transaction', () => {
  it('creates user, personal organization, owner membership and logs atomically', async () => {
    const result = await registerAccount({
      email: 'New-Owner@example.com',
      name: '',
      passwordHash: PASSWORD_HASH,
      ipAddress: '203.0.113.7',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.user.email).toBe('new-owner@example.com');

    const db = getTestDb();
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, result.user.id));

    expect(membership?.role).toBe('owner');
    expect(membership?.orgId).toBe(result.user.defaultOrganizationId);

    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, membership.orgId));
    expect(organization?.name).toBe('new-owner');

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

  it('joins the invited organization but keeps the personal organization', async () => {
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
      role: 'editor',
    });

    const result = await registerAccount({
      email: 'invited@example.com',
      name: '',
      passwordHash: PASSWORD_HASH,
      inviteToken: invitation.token,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const db = getTestDb();
    const memberships = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, result.user.id));

    expect(memberships).toHaveLength(2);
    expect(memberships.find((row) => row.orgId === organization.id)?.role).toBe(
      'editor'
    );
    expect(memberships.filter((row) => row.role === 'owner')).toHaveLength(1);

    const [updatedInvitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(updatedInvitation?.acceptedAt).not.toBeNull();
    expect(updatedInvitation?.acceptedBy).toBe(result.user.id);

    const logs = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, result.user.id));
    expect(logs.map((log) => log.action).sort()).toEqual([
      ActivityType.ACCEPT_INVITATION,
      ActivityType.SIGN_UP,
    ]);
  });

  it('leaves no user or organization behind when the invitation is invalid', async () => {
    const result = await registerAccount({
      email: 'no-invite@example.com',
      name: '',
      passwordHash: PASSWORD_HASH,
      inviteToken: 'unknown-token',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_invitation' });
    expect(await countUsers()).toBe(0);
    expect(await countOrganizations()).toBe(0);
  });

  it('rejects an expired invitation without writing anything', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);
    const invitation = await createInvitation({
      orgId: personal?.organization.id as string,
      invitedBy: owner.id,
      email: 'late@example.com',
      expiresAt: new Date(Date.now() - 1_000),
    });

    const result = await registerAccount({
      email: 'late@example.com',
      name: '',
      passwordHash: PASSWORD_HASH,
      inviteToken: invitation.token,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_invitation' });
    expect(
      await getTestDb()
        .select()
        .from(users)
        .where(eq(users.email, 'late@example.com'))
    ).toHaveLength(0);
  });

  it('rejects an invitation issued for another email', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);
    const invitation = await createInvitation({
      orgId: personal?.organization.id as string,
      invitedBy: owner.id,
      email: 'someone-else@example.com',
    });

    const result = await registerAccount({
      email: 'mismatch@example.com',
      name: '',
      passwordHash: PASSWORD_HASH,
      inviteToken: invitation.token,
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
    expect(unchanged?.acceptedAt).toBeNull();
  });

  it('rejects a duplicate email without writing anything else', async () => {
    await createUser({ email: 'taken@example.com' });
    const organizationsBefore = await countOrganizations();

    const result = await registerAccount({
      email: 'TAKEN@example.com',
      name: '',
      passwordHash: PASSWORD_HASH,
    });

    expect(result).toEqual({ ok: false, reason: 'email_taken' });
    expect(await countUsers()).toBe(1);
    expect(await countOrganizations()).toBe(organizationsBefore);
  });
});

describe('createOrganizationForOwner transaction', () => {
  it('creates the organization with its owner membership and log', async () => {
    const user = await createUser();

    const organization = await createOrganizationForOwner({
      userId: user.id,
      name: '测试新组织',
    });

    expect(organization).not.toBeNull();
    if (!organization) return;

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
    expect(await countOrganizations()).toBe(2);
  });
});

describe('archiveOrganization', () => {
  it('soft-deletes the org and revokes pending invitations', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);
    const orgId = personal?.organization.id as string;
    const invitation = await createInvitation({
      orgId,
      invitedBy: owner.id,
      email: 'pending@example.com',
    });

    const result = await archiveOrganization({ userId: owner.id, orgId });

    expect(result).toEqual({ ok: true });

    const db = getTestDb();
    const [archived] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId));
    expect(archived?.deletedAt).not.toBeNull();
    expect(archived?.status).toBe('closed');

    const [revoked] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(revoked?.deletedAt).not.toBeNull();

    expect(
      await acceptInvite({
        userId: (await createUser({ email: 'pending@example.com' })).id,
        token: invitation.token,
      })
    ).toEqual({ ok: false, reason: 'invalid_invitation' });
  });

  it('rejects an admin because archiving is an owner setting', async () => {
    const admin = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: admin.id,
      orgId: organization.id,
      role: 'admin',
    });

    expect(
      await archiveOrganization({ userId: admin.id, orgId: organization.id })
    ).toEqual({ ok: false, reason: 'forbidden' });
  });
});

describe('inviteOrgMember', () => {
  it('stores only the token hash and returns a seven-day invite link', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);
    const orgId = personal?.organization.id as string;

    const result = await inviteOrgMember({
      userId: owner.id,
      orgId,
      email: 'friend@example.com',
      role: 'viewer',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const url = new URL(result.inviteUrl, 'http://localhost');
    const token = url.searchParams.get('invite');
    expect(url.pathname).toBe('/sign-up');
    expect(token).toBeTruthy();

    const [row] = await getTestDb()
      .select()
      .from(invitations)
      .where(eq(invitations.orgId, orgId));
    expect(row?.tokenHash).toBe(hashInviteToken(token as string));
    expect(row?.tokenHash).not.toContain(token as string);
    expect(row?.email).toBe('friend@example.com');
    expect(row?.role).toBe('viewer');

    const ttl = (row?.expiresAt.getTime() ?? 0) - Date.now();
    expect(ttl).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);

    const logs = await getTestDb()
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.orgId, orgId));
    expect(logs.map((log) => log.action)).toContain(
      ActivityType.INVITE_ORG_MEMBER
    );
  });

  it('allows an admin but not editors or viewers to invite', async () => {
    const organization = await createOrganization();
    const admin = await createUser();
    const editor = await createUser();
    const viewer = await createUser();
    await addMember({
      userId: admin.id,
      orgId: organization.id,
      role: 'admin',
    });
    await addMember({
      userId: editor.id,
      orgId: organization.id,
      role: 'editor',
    });
    await addMember({ userId: viewer.id, orgId: organization.id });

    expect(
      await inviteOrgMember({
        userId: admin.id,
        orgId: organization.id,
        email: 'via-admin@example.com',
        role: 'viewer',
      })
    ).toMatchObject({ ok: true });

    for (const actor of [editor, viewer]) {
      expect(
        await inviteOrgMember({
          userId: actor.id,
          orgId: organization.id,
          email: `via-${actor.id}@example.com`,
          role: 'viewer',
        })
      ).toEqual({ ok: false, reason: 'forbidden' });
    }
  });

  it('rejects an email that is already a member', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);

    expect(
      await inviteOrgMember({
        userId: owner.id,
        orgId: personal?.organization.id as string,
        email: owner.email,
        role: 'viewer',
      })
    ).toEqual({ ok: false, reason: 'already_member' });
  });

  it('rejects a duplicate pending invitation', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);
    const orgId = personal?.organization.id as string;
    await createInvitation({
      orgId,
      invitedBy: owner.id,
      email: 'pending@example.com',
    });

    expect(
      await inviteOrgMember({
        userId: owner.id,
        orgId,
        email: 'Pending@Example.com',
        role: 'viewer',
      })
    ).toEqual({ ok: false, reason: 'pending_exists' });
  });

  it('replaces an expired pending invitation instead of blocking it', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);
    const orgId = personal?.organization.id as string;
    const expired = await createInvitation({
      orgId,
      invitedBy: owner.id,
      email: 'expired@example.com',
      expiresAt: new Date(Date.now() - 1_000),
    });

    const result = await inviteOrgMember({
      userId: owner.id,
      orgId,
      email: 'expired@example.com',
      role: 'editor',
    });

    expect(result.ok).toBe(true);

    const [oldRow] = await getTestDb()
      .select()
      .from(invitations)
      .where(eq(invitations.id, expired.id));
    expect(oldRow?.deletedAt).not.toBeNull();

    const active = await getTestDb()
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.orgId, orgId),
          eq(invitations.email, 'expired@example.com'),
          isNull(invitations.deletedAt),
          isNull(invitations.acceptedAt)
        )
      );
    expect(active).toHaveLength(1);
    expect(active[0].role).toBe('editor');
  });

  it('rejects an archived organization', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);
    await archiveOrganization({
      userId: owner.id,
      orgId: personal?.organization.id as string,
    });

    expect(
      await inviteOrgMember({
        userId: owner.id,
        orgId: personal?.organization.id as string,
        email: 'after-archive@example.com',
        role: 'viewer',
      })
    ).toEqual({ ok: false, reason: 'org_not_found' });
  });
});

describe('acceptInvite', () => {
  it('adds the existing user and consumes the token once', async () => {
    const owner = await createUser();
    const invitee = await createUser({ email: 'invitee@example.com' });
    const organization = await createOrganization();
    await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });
    const invitation = await createInvitation({
      orgId: organization.id,
      invitedBy: owner.id,
      email: invitee.email,
      role: 'admin',
    });

    const result = await acceptInvite({
      userId: invitee.id,
      token: invitation.token,
    });

    expect(result).toEqual({
      ok: true,
      organizationId: organization.id,
      role: 'admin',
    });

    const [membership] = await getTestDb()
      .select()
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, organization.id),
          eq(orgMembers.userId, invitee.id)
        )
      );
    expect(membership?.role).toBe('admin');

    expect(
      await acceptInvite({ userId: invitee.id, token: invitation.token })
    ).toEqual({ ok: false, reason: 'invalid_invitation' });
  });

  it('rejects a token issued for another email', async () => {
    const owner = await createUser();
    const invitee = await createUser({ email: 'invitee@example.com' });
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

    expect(
      await acceptInvite({ userId: invitee.id, token: invitation.token })
    ).toEqual({ ok: false, reason: 'invalid_invitation' });
  });

  it('rejects an expired token', async () => {
    const owner = await createUser();
    const invitee = await createUser({ email: 'invitee@example.com' });
    const organization = await createOrganization();
    await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });
    const invitation = await createInvitation({
      orgId: organization.id,
      invitedBy: owner.id,
      email: invitee.email,
      expiresAt: new Date(Date.now() - 1_000),
    });

    expect(
      await acceptInvite({ userId: invitee.id, token: invitation.token })
    ).toEqual({ ok: false, reason: 'invalid_invitation' });
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
      role: 'editor',
    });

    const result = await removeOrgMemberInTransaction({
      orgId: organization.id,
      memberId: membership.id,
      actorId: owner.id,
    });

    expect(result).toEqual({ ok: true });

    const db = getTestDb();
    const [removed] = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.id, membership.id));
    expect(removed?.deletedAt).not.toBeNull();

    const logs = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.orgId, organization.id));
    expect(logs.map((log) => log.action)).toContain(
      ActivityType.REMOVE_ORG_MEMBER
    );
  });

  it('lets an admin remove an editor but not another admin', async () => {
    const admin = await createUser();
    const editor = await createUser();
    const otherAdmin = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: admin.id,
      orgId: organization.id,
      role: 'admin',
    });
    const editorMembership = await addMember({
      userId: editor.id,
      orgId: organization.id,
      role: 'editor',
    });
    const adminMembership = await addMember({
      userId: otherAdmin.id,
      orgId: organization.id,
      role: 'admin',
    });

    expect(
      await removeOrgMemberInTransaction({
        orgId: organization.id,
        memberId: editorMembership.id,
        actorId: admin.id,
      })
    ).toEqual({ ok: true });

    expect(
      await removeOrgMemberInTransaction({
        orgId: organization.id,
        memberId: adminMembership.id,
        actorId: admin.id,
      })
    ).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('rejects editors and viewers', async () => {
    const organization = await createOrganization();
    const editor = await createUser();
    const viewer = await createUser();
    await addMember({
      userId: editor.id,
      orgId: organization.id,
      role: 'editor',
    });
    await addMember({ userId: viewer.id, orgId: organization.id });

    for (const actor of [editor, viewer]) {
      expect(
        await removeOrgMemberInTransaction({
          orgId: organization.id,
          memberId: (
            await addMember({
              userId: (await createUser()).id,
              orgId: organization.id,
            })
          ).id,
          actorId: actor.id,
        })
      ).toEqual({ ok: false, reason: 'forbidden' });
    }
  });

  it('rejects removing yourself', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);

    expect(
      await removeOrgMemberInTransaction({
        orgId: personal?.organization.id as string,
        memberId: personal?.membership.id as string,
        actorId: owner.id,
      })
    ).toEqual({ ok: false, reason: 'self_removal' });
  });

  it('rejects a membership from another organization', async () => {
    const owner = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: owner.id,
      orgId: organization.id,
      role: 'owner',
    });
    const foreignUser = await createUser();
    const foreignPersonal = await getPersonalOrg(foreignUser.id);
    if (!foreignPersonal) {
      throw new Error('expected a personal organization for the foreign user');
    }
    const foreignMembership = foreignPersonal.membership;

    expect(
      await removeOrgMemberInTransaction({
        orgId: organization.id,
        memberId: foreignMembership.id,
        actorId: owner.id,
      })
    ).toEqual({ ok: false, reason: 'member_not_found' });
  });
});

describe('updateOrgMemberRoleInTransaction', () => {
  it('lets an owner promote a viewer and records the activity', async () => {
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
    });

    expect(
      await updateOrgMemberRoleInTransaction({
        orgId: organization.id,
        memberId: membership.id,
        role: 'editor',
        actorId: owner.id,
      })
    ).toEqual({ ok: true });

    const [updated] = await getTestDb()
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.id, membership.id));
    expect(updated?.role).toBe('editor');

    const logs = await getTestDb()
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.orgId, organization.id));
    expect(logs.map((log) => log.action)).toContain(
      ActivityType.UPDATE_MEMBER_ROLE
    );
  });

  it('refuses to change the owner role', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);

    expect(
      await updateOrgMemberRoleInTransaction({
        orgId: personal?.organization.id as string,
        memberId: personal?.membership.id as string,
        role: 'viewer',
        actorId: owner.id,
      })
    ).toEqual({ ok: false, reason: 'owner_immutable' });
  });

  it('prevents admins from managing admins', async () => {
    const admin = await createUser();
    const otherAdmin = await createUser();
    const editor = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: admin.id,
      orgId: organization.id,
      role: 'admin',
    });
    const otherAdminMembership = await addMember({
      userId: otherAdmin.id,
      orgId: organization.id,
      role: 'admin',
    });
    const editorMembership = await addMember({
      userId: editor.id,
      orgId: organization.id,
      role: 'editor',
    });

    expect(
      await updateOrgMemberRoleInTransaction({
        orgId: organization.id,
        memberId: otherAdminMembership.id,
        role: 'viewer',
        actorId: admin.id,
      })
    ).toEqual({ ok: false, reason: 'forbidden' });

    expect(
      await updateOrgMemberRoleInTransaction({
        orgId: organization.id,
        memberId: editorMembership.id,
        role: 'admin',
        actorId: admin.id,
      })
    ).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('reports an unchanged role', async () => {
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
      role: 'viewer',
    });

    expect(
      await updateOrgMemberRoleInTransaction({
        orgId: organization.id,
        memberId: membership.id,
        role: 'viewer',
        actorId: owner.id,
      })
    ).toEqual({ ok: false, reason: 'same_role' });
  });
});

describe('deleteUserAccount transaction', () => {
  it('refuses to delete the only owner of an active organization', async () => {
    const owner = await createUser();
    const personal = await getPersonalOrg(owner.id);

    const result = await deleteUserAccount({ userId: owner.id });

    expect(result).toEqual({
      ok: false,
      reason: 'sole_owner',
      orgNames: [personal?.organization.name],
    });

    const [unchanged] = await getTestDb()
      .select()
      .from(users)
      .where(eq(users.id, owner.id));
    expect(unchanged?.deletedAt).toBeNull();
  });

  it('removes every membership and revokes the account once owned orgs are archived', async () => {
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

    const result = await deleteUserAccount({ userId: user.id });

    expect(result).toEqual({ ok: true });

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
});
