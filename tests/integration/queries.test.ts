import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getActivityLogs, logActivity } from '@/lib/db/queries/activity';
import { getFolders } from '@/lib/db/queries/folders';
import { getLineageById, getLineages } from '@/lib/db/queries/lineages';
import {
  getOrgById,
  getOrgsForUser,
  getOrgWithRoleBySlug,
} from '@/lib/db/queries/organizations';
import {
  countProjects,
  getProjectById,
  getProjectScopeByRef,
  getProjects,
} from '@/lib/db/queries/projects';
import {
  ActivityType,
  folders,
  lineages,
  organizations,
  projects,
} from '@/lib/db/schema';
import { getTestDb } from '../helpers/db';
import {
  addMember,
  createFolder,
  createLineage,
  createOrganization,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

async function personalOrgFor(userId: string) {
  const personal = await getPersonalOrg(userId);
  if (!personal) {
    throw new Error('expected signup trigger to create a personal org');
  }
  return personal.organization;
}

describe('folder queries', () => {
  it('filters by kind, orders by sort and hides soft-deleted rows', async () => {
    const user = await createUser();
    const org = await personalOrgFor(user.id);
    const project = await createProject({ orgId: org.id, createdBy: user.id });
    const otherKind = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 1,
      sort: 0,
    });
    const later = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 0,
      sort: 2,
    });
    const earlier = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 0,
      sort: 1,
    });
    const deleted = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 0,
      sort: 0,
    });
    await getTestDb()
      .update(folders)
      .set({ deletedAt: new Date() })
      .where(eq(folders.id, deleted.id));

    const list = await getFolders(user.id, org.id, project.id, 0);

    expect(list.map((folder) => folder.id)).toEqual([earlier.id, later.id]);
    expect(list.map((folder) => folder.id)).not.toContain(otherKind.id);
    expect(list.map((folder) => folder.id)).not.toContain(deleted.id);

    // Cross-org and stranger isolation is covered by the list call above plus
    // tests/integration/org-scope.test.ts; the single-row helper was removed.
  });
});

describe('lineage queries', () => {
  it('scopes lists to the project and hides soft-deleted lineages', async () => {
    const user = await createUser();
    const org = await personalOrgFor(user.id);
    const project = await createProject({ orgId: org.id, createdBy: user.id });
    const otherProject = await createProject({
      orgId: org.id,
      createdBy: user.id,
    });
    const lineage = await createLineage({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      name: '颍川陈氏',
    });
    const deleted = await createLineage({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
    });
    const foreign = await createLineage({
      orgId: org.id,
      projectId: otherProject.id,
      createdBy: user.id,
    });
    await getTestDb()
      .update(lineages)
      .set({ deletedAt: new Date() })
      .where(eq(lineages.id, deleted.id));

    const list = await getLineages(user.id, org.id, project.id);

    expect(list.map((row) => row.id)).toEqual([lineage.id]);
    expect(list.map((row) => row.id)).not.toContain(foreign.id);

    expect(await getLineageById(user.id, org.id, lineage.id)).toMatchObject({
      name: '颍川陈氏',
    });
    expect(await getLineageById(user.id, org.id, deleted.id)).toBeNull();

    const stranger = await createUser();
    expect(await getLineageById(stranger.id, org.id, lineage.id)).toBeNull();
  });
});

describe('organization queries', () => {
  it('reads memberships and hides archived organizations', async () => {
    const owner = await createUser();
    const org = await personalOrgFor(owner.id);
    const member = await createUser();
    await addMember({
      userId: member.id,
      organizationId: org.id,
      role: 'editor',
    });

    expect(await getOrgById(owner.id, org.id)).toMatchObject({ id: org.id });
    expect(await getOrgById(member.id, org.id)).toMatchObject({ id: org.id });
    expect(
      await getOrgById(member.id, '00000000-0000-7000-8000-000000000000')
    ).toBeNull();

    const stranger = await createUser();
    expect(await getOrgById(stranger.id, org.id)).toBeNull();

    const listed = await getOrgsForUser(member.id);
    expect(listed.map((row) => row.organization.id)).toContain(org.id);
    expect(listed.find((row) => row.organization.id === org.id)?.role).toBe(
      'editor'
    );

    expect(await getOrgWithRoleBySlug(owner.id, org.slug)).toMatchObject({
      role: 'owner',
    });
    expect(await getOrgWithRoleBySlug(stranger.id, org.slug)).toBeNull();

    await getTestDb()
      .update(organizations)
      .set({ status: 'closed', deletedAt: new Date() })
      .where(eq(organizations.id, org.id));
    expect(await getOrgById(owner.id, org.id)).toBeNull();
    expect(await getOrgWithRoleBySlug(owner.id, org.slug)).toBeNull();
    expect(await getOrgsForUser(owner.id)).toEqual([]);
  });
});

describe('project queries', () => {
  it('lists, counts and scopes projects by org', async () => {
    const user = await createUser();
    const org = await personalOrgFor(user.id);
    const otherOrg = await createOrganization();
    const first = await createProject({
      orgId: org.id,
      createdBy: user.id,
      name: '甲谱',
    });
    const second = await createProject({
      orgId: org.id,
      createdBy: user.id,
      name: '乙谱',
    });
    const foreign = await createProject({
      orgId: otherOrg.id,
      createdBy: user.id,
    });

    const list = await getProjects(user.id, org.id);
    expect(list.map((row) => row.id).sort()).toEqual(
      [first.id, second.id].sort()
    );
    expect(await countProjects(user.id, org.id)).toBe(2);

    expect(await getProjectById(user.id, first.id, org.id)).toMatchObject({
      name: '甲谱',
    });
    expect(await getProjectById(user.id, foreign.id, org.id)).toBeNull();

    const scope = await getProjectScopeByRef(user.id, second.ref);
    expect(scope?.project.id).toBe(second.id);
    expect(scope?.role).toBe('owner');

    await getTestDb()
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(eq(projects.id, first.id));
    expect(await getProjectById(user.id, first.id, org.id)).toBeNull();
    expect(await countProjects(user.id, org.id)).toBe(1);
  });
});

describe('activity queries', () => {
  it('appends account-level events and returns the ten most recent', async () => {
    const user = await createUser();
    const org = await personalOrgFor(user.id);

    await logActivity(user.id, null, ActivityType.SIGN_IN, '127.0.0.1');
    for (let index = 0; index < 11; index += 1) {
      await logActivity(user.id, org.id, ActivityType.UPDATE_NODE);
    }

    const logs = await getActivityLogs(user.id);
    expect(logs).toHaveLength(10);
    expect(logs[0].action).toBe(ActivityType.UPDATE_NODE);

    const other = await createUser();
    expect(await getActivityLogs(other.id)).toEqual([]);
  });
});
