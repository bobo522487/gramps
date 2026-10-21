import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  ActivityType,
  activityLogs,
  folders,
  invitations,
  orgMembers,
  users,
} from '@/lib/db/schema';
import { getTestDb, getTestSql } from '../helpers/db';
import {
  addMember,
  createInvitation,
  createOrganization,
  createProject,
  createUser,
} from '../helpers/factories';

describe('database constraints', () => {
  it('rejects duplicate user emails case-insensitively', async () => {
    const user = await createUser();

    await expect(
      createUser({ email: user.email.toUpperCase() })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('allows reusing an email after the account is soft-deleted', async () => {
    const user = await createUser({ email: 'reuse@example.com' });

    await getTestDb()
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, user.id));

    await expect(
      createUser({ email: 'reuse@example.com' })
    ).resolves.toBeDefined();
  });

  it('rejects duplicate organization slugs', async () => {
    const organization = await createOrganization();

    await expect(
      createOrganization({ slug: organization.slug })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects project refs shared across organizations', async () => {
    const owner = await createUser();
    const firstOrg = await createOrganization();
    const secondOrg = await createOrganization();
    const project = await createProject({
      orgId: firstOrg.id,
      createdBy: owner.id,
    });

    await expect(
      createProject({
        orgId: secondOrg.id,
        createdBy: owner.id,
        ref: project.ref,
      })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a project whose organization does not exist', async () => {
    const owner = await createUser();

    await expect(
      createProject({
        orgId: '00000000-0000-0000-0000-000000000000',
        createdBy: owner.id,
      })
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects duplicate active memberships', async () => {
    const user = await createUser();
    const organization = await createOrganization();
    await addMember({ userId: user.id, orgId: organization.id });

    await expect(
      addMember({ userId: user.id, orgId: organization.id, role: 'editor' })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('allows re-adding a member after the previous membership is removed', async () => {
    const user = await createUser();
    const organization = await createOrganization();
    const membership = await addMember({
      userId: user.id,
      orgId: organization.id,
    });

    await getTestDb()
      .update(orgMembers)
      .set({ deletedAt: new Date() })
      .where(eq(orgMembers.id, membership.id));

    await expect(
      addMember({ userId: user.id, orgId: organization.id, role: 'editor' })
    ).resolves.toBeDefined();
  });

  it('rejects a role outside owner/admin/editor/viewer', async () => {
    const user = await createUser();
    const organization = await createOrganization();

    await expect(
      getTestDb()
        .insert(orgMembers)
        .values({ userId: user.id, orgId: organization.id, role: 'member' })
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('allows only one active owner per organization', async () => {
    const first = await createUser();
    const second = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: first.id,
      orgId: organization.id,
      role: 'owner',
    });

    await expect(
      addMember({
        userId: second.id,
        orgId: organization.id,
        role: 'owner',
      })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects an owner-role invitation', async () => {
    const owner = await createUser();
    const organization = await createOrganization();

    await expect(
      getTestDb()
        .insert(invitations)
        .values({
          orgId: organization.id,
          email: 'owner@example.com',
          role: 'owner',
          tokenHash: 'f'.repeat(64),
          expiresAt: new Date(Date.now() + 86_400_000),
          createdBy: owner.id,
        })
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects duplicate pending invitations per organization and email', async () => {
    const invitedBy = await createUser();
    const organization = await createOrganization();
    await createInvitation({
      orgId: organization.id,
      invitedBy: invitedBy.id,
      email: 'Dup@Example.com',
    });

    await expect(
      createInvitation({
        orgId: organization.id,
        invitedBy: invitedBy.id,
        email: 'dup@example.com',
      })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('allows a new invitation after the previous one is accepted', async () => {
    const invitedBy = await createUser();
    const organization = await createOrganization();
    const first = await createInvitation({
      orgId: organization.id,
      invitedBy: invitedBy.id,
      email: 'again@example.com',
    });

    await getTestDb()
      .update(invitations)
      .set({ acceptedAt: new Date(), acceptedBy: invitedBy.id })
      .where(eq(invitations.id, first.id));

    await expect(
      createInvitation({
        orgId: organization.id,
        invitedBy: invitedBy.id,
        email: 'again@example.com',
      })
    ).resolves.toBeDefined();
  });

  it('allows a new invitation after the previous one is revoked', async () => {
    const invitedBy = await createUser();
    const organization = await createOrganization();
    const first = await createInvitation({
      orgId: organization.id,
      invitedBy: invitedBy.id,
      email: 'revoked@example.com',
    });

    await getTestDb()
      .update(invitations)
      .set({ deletedAt: new Date() })
      .where(eq(invitations.id, first.id));

    await expect(
      createInvitation({
        orgId: organization.id,
        invitedBy: invitedBy.id,
        email: 'revoked@example.com',
      })
    ).resolves.toBeDefined();
  });

  it('rejects cross-organization references through composite foreign keys', async () => {
    const owner = await createUser();
    const projectOrg = await createOrganization();
    const otherOrg = await createOrganization();
    const project = await createProject({
      orgId: projectOrg.id,
      createdBy: owner.id,
    });

    await expect(
      getTestDb().insert(folders).values({
        orgId: otherOrg.id,
        projectId: project.id,
        kind: 0,
        name: '跨组织文件夹',
        createdBy: owner.id,
      })
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('allows account-level activity rows without an organization', async () => {
    const user = await createUser();

    const [log] = await getTestDb()
      .insert(activityLogs)
      .values({
        orgId: null,
        userId: user.id,
        action: ActivityType.SIGN_IN,
      })
      .returning();

    expect(log.orgId).toBeNull();
    expect(log.userId).toBe(user.id);
  });

  it('requires project primary fields', async () => {
    const owner = await createUser();
    const organization = await createOrganization();

    await expect(
      getTestSql()`
        insert into project (organization_id, name, created_by)
        values (${organization.id}::uuid, '缺少主姓名', ${owner.id}::uuid)
      `
    ).rejects.toMatchObject({ code: '23502' });
  });
});
