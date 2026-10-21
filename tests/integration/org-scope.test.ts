import { describe, expect, it } from 'vitest';
import {
  deleteProject,
  getOrgsForUser,
  getOrgWithRoleBySlug,
  getProjectById,
  getProjectScopeByRef,
  updateProject,
} from '@/lib/db/queries';
import {
  addMember,
  createOrganization,
  createProject,
  createUser,
} from '../helpers/factories';

describe('organization and project scope', () => {
  it('resolves an organization slug only for its members', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const organization = await createOrganization({ name: '陈氏族谱' });
    await addMember({
      userId: alice.id,
      orgId: organization.id,
      role: 'owner',
    });

    const ownScope = await getOrgWithRoleBySlug(alice.id, organization.slug);

    expect(ownScope?.organization.id).toBe(organization.id);
    expect(ownScope?.role).toBe('owner');
    expect(await getOrgWithRoleBySlug(bob.id, organization.slug)).toBeNull();
    expect(
      await getOrgWithRoleBySlug(alice.id, '00000000000000000000')
    ).toBeNull();
  });

  it('lists only organizations the user belongs to', async () => {
    const alice = await createUser();
    const organization = await createOrganization();
    const foreignOrganization = await createOrganization();
    await addMember({ userId: alice.id, orgId: organization.id });

    const rows = await getOrgsForUser(alice.id);

    expect(rows.map((row) => row.organization.id)).toEqual([organization.id]);
    expect(rows.map((row) => row.organization.id)).not.toContain(
      foreignOrganization.id
    );
  });

  it('resolves a project ref only for members of its organization', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const aliceOrg = await createOrganization();
    const bobOrg = await createOrganization();
    await addMember({ userId: alice.id, orgId: aliceOrg.id, role: 'owner' });
    await addMember({ userId: bob.id, orgId: bobOrg.id, role: 'owner' });
    const aliceProject = await createProject({
      orgId: aliceOrg.id,
      name: '颍川陈氏',
    });
    const bobProject = await createProject({ orgId: bobOrg.id });

    const scope = await getProjectScopeByRef(alice.id, aliceProject.ref);

    expect(scope?.project.id).toBe(aliceProject.id);
    expect(scope?.organization.id).toBe(aliceOrg.id);
    expect(scope?.role).toBe('owner');
    expect(await getProjectScopeByRef(bob.id, aliceProject.ref)).toBeNull();
    expect(await getProjectScopeByRef(alice.id, bobProject.ref)).toBeNull();
  });

  it('rejects cross-organization reads and writes by project id', async () => {
    const alice = await createUser();
    const aliceOrg = await createOrganization();
    const otherOrg = await createOrganization();
    await addMember({ userId: alice.id, orgId: aliceOrg.id, role: 'owner' });
    const project = await createProject({
      orgId: aliceOrg.id,
      name: '原始名称',
    });

    expect(await getProjectById(project.id, otherOrg.id)).toBeNull();
    expect(
      await updateProject(project.id, otherOrg.id, { name: '越权修改' })
    ).toBeNull();
    expect(await deleteProject(project.id, otherOrg.id)).toBe(false);
    expect((await getProjectById(project.id, aliceOrg.id))?.name).toBe(
      '原始名称'
    );
  });

  it('updates and deletes a project inside its own organization', async () => {
    const alice = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: alice.id,
      orgId: organization.id,
      role: 'owner',
    });
    const project = await createProject({ orgId: organization.id });

    const updated = await updateProject(project.id, organization.id, {
      name: '新名称',
    });

    expect(updated?.name).toBe('新名称');
    expect(await deleteProject(project.id, organization.id)).toBe(true);
    expect(await getProjectById(project.id, organization.id)).toBeNull();
  });
});
