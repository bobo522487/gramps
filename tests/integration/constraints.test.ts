import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deleteOrg } from '@/lib/db/queries';
import {
  ActivityType,
  activityLogs,
  invitations,
  orgMembers,
  projects,
} from '@/lib/db/schema';
import { getTestDb } from '../helpers/db';
import {
  addMember,
  createInvitation,
  createOrganization,
  createProject,
  createUser,
} from '../helpers/factories';

describe('database constraints', () => {
  it('rejects duplicate user emails', async () => {
    const user = await createUser();

    await expect(createUser({ email: user.email })).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('rejects duplicate organization slugs', async () => {
    const organization = await createOrganization();

    await expect(
      createOrganization({ slug: organization.slug })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects project refs shared across organizations', async () => {
    const firstOrg = await createOrganization();
    const secondOrg = await createOrganization();
    const project = await createProject({ orgId: firstOrg.id });

    await expect(
      createProject({ orgId: secondOrg.id, ref: project.ref })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects project slugs duplicated inside one organization', async () => {
    const organization = await createOrganization();
    const project = await createProject({ orgId: organization.id });

    await expect(
      createProject({ orgId: organization.id, slug: project.slug })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a project whose organization does not exist', async () => {
    await expect(createProject({ orgId: 999_999 })).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('cascades project deletion when the organization is deleted', async () => {
    const organization = await createOrganization();
    const project = await createProject({ orgId: organization.id });

    await deleteOrg(organization.id);

    const rows = await getTestDb()
      .select()
      .from(projects)
      .where(eq(projects.id, project.id));
    expect(rows).toHaveLength(0);
  });

  it('rejects duplicate memberships in one organization', async () => {
    const user = await createUser();
    const organization = await createOrganization();
    await addMember({ userId: user.id, orgId: organization.id });

    await expect(
      addMember({ userId: user.id, orgId: organization.id })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a role outside owner/member', async () => {
    const user = await createUser();
    const organization = await createOrganization();

    await expect(
      getTestDb()
        .insert(orgMembers)
        .values({ userId: user.id, orgId: organization.id, role: 'admin' })
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
      .set({ status: 'accepted' })
      .where(eq(invitations.id, first.id));

    await expect(
      createInvitation({
        orgId: organization.id,
        invitedBy: invitedBy.id,
        email: 'again@example.com',
      })
    ).resolves.toBeDefined();
  });

  it('rejects an unknown project status', async () => {
    const organization = await createOrganization();

    await expect(
      getTestDb().insert(projects).values({
        orgId: organization.id,
        name: '非法状态',
        slug: 'invalid-status',
        ref: 'invalidstatus0000001',
        status: 'BROKEN',
      })
    ).rejects.toMatchObject({ code: '23514' });
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
});
