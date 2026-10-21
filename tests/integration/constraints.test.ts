import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deleteOrg } from '@/lib/db/queries';
import { projects } from '@/lib/db/schema';
import { getTestDb } from '../helpers/db';
import {
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
});
