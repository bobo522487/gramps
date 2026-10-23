import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getActivityLogs, logActivity } from '@/lib/db/queries/activity';
import { getFolderById, getFolders } from '@/lib/db/queries/folders';
import { getLineageById, getLineages } from '@/lib/db/queries/lineages';
import {
  countNodes,
  getNodeById,
  getNodes,
  searchNodes,
} from '@/lib/db/queries/nodes';
import {
  archiveOrg,
  getOrgById,
  getOrgsForUser,
  getOrgWithMembersById,
  getOrgWithRoleBySlug,
  isUserInOrgByEmail,
  renameOrg,
} from '@/lib/db/queries/organizations';
import {
  countProjects,
  getProjectById,
  getProjectScopeByRef,
  getProjects,
} from '@/lib/db/queries/projects';
import {
  findUserByEmail,
  getSessionUserById,
  softDeleteUser,
  updateUserPassword,
  updateUserProfile,
} from '@/lib/db/queries/users';
import {
  ActivityType,
  folders,
  lineages,
  nodes,
  projects,
} from '@/lib/db/schema';
import { getTestDb } from '../helpers/db';
import {
  addMember,
  createFolder,
  createLineage,
  createNode,
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

    expect(await getFolderById(user.id, org.id, earlier.id)).toMatchObject({
      id: earlier.id,
      name: '测试分类',
    });
    expect(await getFolderById(user.id, org.id, deleted.id)).toBeNull();

    const otherOrg = await createOrganization();
    expect(await getFolderById(user.id, otherOrg.id, earlier.id)).toBeNull();

    const stranger = await createUser();
    expect(await getFolderById(stranger.id, org.id, earlier.id)).toBeNull();
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

describe('node queries', () => {
  it('lists, searches, counts and scopes nodes by lineage and org', async () => {
    const user = await createUser();
    const org = await personalOrgFor(user.id);
    const project = await createProject({ orgId: org.id, createdBy: user.id });
    const lineage = await createLineage({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
    });
    const root = await createNode({
      orgId: org.id,
      lineageId: lineage.id,
      createdBy: user.id,
      generation: 1,
      name: '太公',
      sort: 0,
    });
    const child = await createNode({
      orgId: org.id,
      lineageId: lineage.id,
      createdBy: user.id,
      parentId: root.id,
      generation: 2,
      name: '二世',
      depth: 1,
      sort: 0,
    });
    const spouse = await createNode({
      orgId: org.id,
      lineageId: lineage.id,
      createdBy: user.id,
      spouseOfId: root.id,
      role: 'spouse',
      generation: 1,
      name: '太婆',
      sort: 1,
      sex: 1,
    });
    const percent = await createNode({
      orgId: org.id,
      lineageId: lineage.id,
      createdBy: user.id,
      generation: 2,
      name: '百%成',
      depth: 1,
      sort: 1,
    });
    const deleted = await createNode({
      orgId: org.id,
      lineageId: lineage.id,
      createdBy: user.id,
      generation: 3,
      name: '删丁',
      depth: 2,
    });
    await getTestDb()
      .update(nodes)
      .set({ deletedAt: new Date() })
      .where(eq(nodes.id, deleted.id));

    const list = await getNodes(user.id, org.id, lineage.id);
    expect(list.map((node) => node.id)).toEqual(
      expect.arrayContaining([root.id, child.id, spouse.id, percent.id])
    );
    expect(list.map((node) => node.id)).not.toContain(deleted.id);
    expect(list[0].generation).toBe(1);

    expect(
      (await searchNodes(user.id, org.id, lineage.id, '二世')).map((n) => n.id)
    ).toEqual([child.id]);
    expect(
      (await searchNodes(user.id, org.id, lineage.id, '%')).map((n) => n.id)
    ).toEqual([percent.id]);
    expect(
      await searchNodes(user.id, org.id, lineage.id, '陈', 2)
    ).toHaveLength(2);

    expect(
      await getNodeById(user.id, org.id, lineage.id, child.id)
    ).toMatchObject({ fullName: '陈二世' });
    expect(
      await getNodeById(user.id, org.id, lineage.id, deleted.id)
    ).toBeNull();
    expect(await countNodes(user.id, org.id, lineage.id)).toBe(4);

    const stranger = await createUser();
    expect(await getNodes(stranger.id, org.id, lineage.id)).toEqual([]);
    expect(await countNodes(stranger.id, org.id, lineage.id)).toBe(0);
  });
});

describe('organization queries', () => {
  it('reads, renames, archives and membership-checks an organization', async () => {
    const owner = await createUser();
    const org = await personalOrgFor(owner.id);
    const member = await createUser();
    await addMember({ userId: member.id, orgId: org.id, role: 'editor' });

    expect(await getOrgById(owner.id, org.id)).toMatchObject({ id: org.id });
    expect(await getOrgById(member.id, org.id)).toMatchObject({ id: org.id });
    expect(
      await getOrgById(member.id, '00000000-0000-7000-8000-000000000000')
    ).toBeNull();

    const stranger = await createUser();
    expect(await getOrgById(stranger.id, org.id)).toBeNull();

    const withMembers = await getOrgWithMembersById(owner.id, org.id);
    expect(withMembers?.members.map((row) => row.email).sort()).toEqual(
      [owner.email, member.email].sort()
    );
    expect(await getOrgWithMembersById(stranger.id, org.id)).toBeNull();

    expect(await isUserInOrgByEmail(owner.id, member.email, org.id)).toBe(true);
    expect(
      await isUserInOrgByEmail(owner.id, 'nobody@example.com', org.id)
    ).toBe(false);

    expect(await renameOrg(owner.id, org.id, '颍川陈氏')).toMatchObject({
      name: '颍川陈氏',
    });
    expect((await getOrgsForUser(owner.id))[0].organization.name).toBe(
      '颍川陈氏'
    );

    expect(await archiveOrg(owner.id, org.id)).toMatchObject({
      status: 'closed',
    });
    expect(await getOrgById(owner.id, org.id)).toBeNull();
    expect(await getOrgWithRoleBySlug(owner.id, org.slug)).toBeNull();

    const archived = await createOrganization({ deletedAt: new Date() });
    await addMember({ userId: owner.id, orgId: archived.id, role: 'owner' });
    expect(await getOrgById(owner.id, archived.id)).toBeNull();
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

describe('user queries', () => {
  it('finds credentials case-insensitively and ignores deleted accounts', async () => {
    const user = await createUser();
    const found = await findUserByEmail(user.email.toUpperCase());

    expect(found?.id).toBe(user.id);
    expect(found?.passwordHash).toBe(user.passwordHash);
    expect(await findUserByEmail('missing@example.com')).toBeNull();

    const deleted = await createUser({ deletedAt: new Date() });
    expect(await findUserByEmail(deleted.email)).toBeNull();
  });

  it('reads the session user, updates credentials and soft-deletes', async () => {
    const user = await createUser();
    const sessionUser = await getSessionUserById(user.id);
    expect(sessionUser?.email).toBe(user.email);

    const tokenVersion = await updateUserPassword(user.id, 'new-hash');
    expect(tokenVersion).toBeGreaterThan(user.tokenVersion);

    const newEmail = `updated-${user.id}@example.com`;
    expect(
      await updateUserProfile({
        userId: user.id,
        name: '新名字',
        email: newEmail,
      })
    ).toMatchObject({ name: '新名字', email: newEmail });
    expect((await findUserByEmail(newEmail))?.id).toBe(user.id);

    await softDeleteUser(user.id);
    // get_session_user() exposes the row; the auth layer rejects deletedAt.
    expect((await getSessionUserById(user.id))?.deletedAt).not.toBeNull();
    expect(await findUserByEmail(newEmail)).toBeNull();
  });
});
