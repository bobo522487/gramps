import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  ActivityType,
  activityLogs,
  folders,
  invitations,
  orgMembers,
} from '@/lib/db/schema';
import { getTestDb, getTestSql, pgErrorCode } from '../helpers/db';
import {
  addMember,
  createInvitation,
  createLineage,
  createNode,
  createOrganization,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

describe('database constraints', () => {
  it('rejects duplicate user emails case-insensitively', async () => {
    const user = await createUser();

    await expect(
      createUser({ email: user.email.toUpperCase() })
    ).rejects.toMatchObject({
      status: 'UNPROCESSABLE_ENTITY',
      body: { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' },
    });
  });

  it('rejects duplicate organization slugs', async () => {
    const organization = await createOrganization();

    await expect(
      createOrganization({ slug: organization.slug })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23505');
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
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23505');
  });

  it('rejects a project whose organization does not exist', async () => {
    const owner = await createUser();

    await expect(
      createProject({
        orgId: '00000000-0000-0000-0000-000000000000',
        createdBy: owner.id,
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');
  });

  it('rejects duplicate active memberships', async () => {
    const user = await createUser();
    const organization = await createOrganization();
    await addMember({ userId: user.id, organizationId: organization.id });

    await expect(
      addMember({
        userId: user.id,
        organizationId: organization.id,
        role: 'editor',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23505');
  });

  it('allows re-adding a member after the previous membership is removed', async () => {
    const user = await createUser();
    const organization = await createOrganization();
    const membership = await addMember({
      userId: user.id,
      organizationId: organization.id,
    });

    await getTestDb()
      .delete(orgMembers)
      .where(eq(orgMembers.id, membership.id));

    await expect(
      addMember({
        userId: user.id,
        organizationId: organization.id,
        role: 'editor',
      })
    ).resolves.toBeDefined();
  });

  it('rejects a role outside owner/admin/editor/viewer', async () => {
    const user = await createUser();
    const organization = await createOrganization();

    await expect(
      getTestDb().insert(orgMembers).values({
        userId: user.id,
        organizationId: organization.id,
        role: 'member',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23514');
  });

  it('allows only one active owner per organization', async () => {
    const first = await createUser();
    const second = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: first.id,
      organizationId: organization.id,
      role: 'owner',
    });

    await expect(
      addMember({
        userId: second.id,
        organizationId: organization.id,
        role: 'owner',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23505');
  });

  it('rejects an owner-role invitation', async () => {
    const owner = await createUser();
    const organization = await createOrganization();

    await expect(
      getTestDb()
        .insert(invitations)
        .values({
          organizationId: organization.id,
          email: 'owner@example.com',
          role: 'owner',
          inviterId: owner.id,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23514');
  });

  it('rejects duplicate pending invitations per organization and email', async () => {
    const invitedBy = await createUser();
    const organization = await createOrganization();
    await createInvitation({
      organizationId: organization.id,
      inviterId: invitedBy.id,
      email: 'Dup@Example.com',
    });

    await expect(
      createInvitation({
        organizationId: organization.id,
        inviterId: invitedBy.id,
        email: 'dup@example.com',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23505');
  });

  it('allows a new invitation after the previous one is accepted', async () => {
    const invitedBy = await createUser();
    const organization = await createOrganization();
    const first = await createInvitation({
      organizationId: organization.id,
      inviterId: invitedBy.id,
      email: 'again@example.com',
    });

    await getTestDb()
      .update(invitations)
      .set({ status: 'accepted' })
      .where(eq(invitations.id, first.id));

    await expect(
      createInvitation({
        organizationId: organization.id,
        inviterId: invitedBy.id,
        email: 'again@example.com',
      })
    ).resolves.toBeDefined();
  });

  it('allows a new invitation after the previous one is canceled', async () => {
    const invitedBy = await createUser();
    const organization = await createOrganization();
    const first = await createInvitation({
      organizationId: organization.id,
      inviterId: invitedBy.id,
      email: 'revoked@example.com',
    });

    await getTestDb()
      .update(invitations)
      .set({ status: 'canceled' })
      .where(eq(invitations.id, first.id));

    await expect(
      createInvitation({
        organizationId: organization.id,
        inviterId: invitedBy.id,
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
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');
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

  it('enforces the project status and importance ranges', async () => {
    const owner = await createUser();
    const organization = await createOrganization();

    await expect(
      getTestSql()`
        insert into project (organization_id, name, created_by, status)
        values (${organization.id}::uuid, '非法状态', ${owner.id}::uuid, 'archived')
      `
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23514');

    await expect(
      getTestSql()`
        insert into project (organization_id, name, created_by, importance)
        values (${organization.id}::uuid, '非法等级', ${owner.id}::uuid, 9)
      `
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23514');
  });
});

describe('node tree invariants enforced by the database', () => {
  async function lineageScope() {
    const user = await createUser();
    const personal = await getPersonalOrg(user.id);
    if (!personal)
      throw new Error('registration trigger did not create an org');
    const organization = personal.organization;
    const project = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const lineage = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    return { user, organization, project, lineage };
  }

  it('derives level from the ltree path instead of trusting the writer', async () => {
    const { user, organization, lineage } = await lineageScope();
    const root = await createNode({
      orgId: organization.id,
      lineageId: lineage.id,
      createdBy: user.id,
      generation: 1,
      path: 'aaaa',
    });
    const child = await createNode({
      orgId: organization.id,
      lineageId: lineage.id,
      createdBy: user.id,
      generation: 2,
      path: 'aaaa.bbbb',
      parentId: root.id,
    });
    const rows = await getTestSql()<{ id: string; level: number }[]>`
      select id, level from node
      where id in (${root.id}, ${child.id})
      order by level`;
    expect(rows.map((row) => row.level)).toEqual([0, 1]);
  });

  it('rejects a generation below the path-derived level', async () => {
    const { user, organization, lineage } = await lineageScope();
    await expect(
      createNode({
        orgId: organization.id,
        lineageId: lineage.id,
        createdBy: user.id,
        generation: 0,
        path: 'aaaa.bbbb',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23514');
  });

  it('accepts a spouse node with no path at the minimum generation', async () => {
    const { user, organization, lineage } = await lineageScope();
    const root = await createNode({
      orgId: organization.id,
      lineageId: lineage.id,
      createdBy: user.id,
      generation: 1,
      path: 'aaaa',
    });
    await expect(
      createNode({
        orgId: organization.id,
        lineageId: lineage.id,
        createdBy: user.id,
        generation: 1,
        role: 'spouse',
        spouseOfId: root.id,
      })
    ).resolves.toBeTruthy();
  });
});
