import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { folders, invitations, orgMembers } from '@/lib/db/schema';
import { getTestDb, getTestSql, pgErrorCode } from '../helpers/db';
import {
  addMember,
  createBook,
  createCatalogItem,
  createFolder,
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
      .where(
        and(
          eq(orgMembers.organizationId, membership.organizationId),
          eq(orgMembers.userId, membership.userId)
        )
      );

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

  // 目标态：R31 幂等键随 request_id 退役。闭包外键的目标是
  // node_path_unique (project_id, lineage_id, path)，同一棵树里不允许两行
  // 占同一个位置；这取代了旧的部分唯一索引成为直测对象。
  it('keeps one node per (project, lineage, path)', async () => {
    const { organization, project, lineage } = await lineageScope();

    await expect(
      getTestSql()`
        insert into node (organization_id, project_id, lineage_id, path, kind)
        values (${organization.id}, ${project.id}, ${lineage.id}, '0001', 'annotation')`
    ).resolves.toBeDefined();

    await expect(
      getTestSql()`
        insert into node (organization_id, project_id, lineage_id, path, kind)
        values (${organization.id}, ${project.id}, ${lineage.id}, '0001', 'annotation')`
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23505');
  });
});

describe('tree edges belong to exactly one parent scope', () => {
  async function orgScope() {
    const user = await createUser();
    const personal = await getPersonalOrg(user.id);
    if (!personal)
      throw new Error('registration trigger did not create an org');
    return { user, organization: personal.organization };
  }

  it('rejects a node whose parent lives in another lineage', async () => {
    const { user, organization } = await orgScope();
    const project = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const a = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      name: '甲谱',
    });
    const b = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      name: '乙谱',
    });
    const foreignParent = await createNode({
      orgId: organization.id,
      lineageId: b.id,
      createdBy: user.id,
      generation: 1,
      path: 'aaaa',
    });
    await expect(
      createNode({
        orgId: organization.id,
        lineageId: a.id,
        createdBy: user.id,
        parentId: foreignParent.id,
        generation: 2,
        path: 'bbbb',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');
  });

  it('still allows a null parent and a same-lineage parent', async () => {
    const { user, organization } = await orgScope();
    const project = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const lineage = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
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
        parentId: root.id,
        generation: 2,
        path: 'aaaa.cccc',
      })
    ).resolves.toBeTruthy();
  });

  it('rejects a folder whose parent belongs to another project', async () => {
    const { user, organization } = await orgScope();
    const projectA = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const projectB = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const folderInA = await createFolder({
      orgId: organization.id,
      projectId: projectA.id,
      createdBy: user.id,
      kind: 0,
      name: '甲',
    });
    await expect(
      createFolder({
        orgId: organization.id,
        projectId: projectB.id,
        createdBy: user.id,
        parentId: folderInA.id,
        kind: 0,
        name: '乙',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');
  });

  it('rejects a dangling folder parent that names no folder at all', async () => {
    const { user, organization } = await orgScope();
    const project = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    await expect(
      createFolder({
        orgId: organization.id,
        projectId: project.id,
        createdBy: user.id,
        parentId: randomUUID(),
        kind: 0,
        name: '丙',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');
  });
});

describe('spouse edges belong to exactly one lineage', () => {
  it('rejects a spouse whose spouse_of_id lives in another lineage', async () => {
    const user = await createUser();
    const personal = await getPersonalOrg(user.id);
    if (!personal)
      throw new Error('registration trigger did not create an org');
    const organization = personal.organization;
    const project = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const lineageA = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      name: '甲谱',
    });
    const lineageB = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      name: '乙谱',
    });
    const foreignBlood = await createNode({
      orgId: organization.id,
      lineageId: lineageB.id,
      createdBy: user.id,
      generation: 1,
      path: 'aaaa',
    });

    await expect(
      createNode({
        orgId: organization.id,
        lineageId: lineageA.id,
        createdBy: user.id,
        generation: 1,
        role: 'spouse',
        spouseOfId: foreignBlood.id,
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');
  });

  it('still allows a spouse attached inside the same lineage', async () => {
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
    const blood = await createNode({
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
        spouseOfId: blood.id,
      })
    ).resolves.toBeTruthy();
  });
});

describe('book_catalog book edges belong to exactly one organization', () => {
  it('rejects a catalog whose book_id lives in another organization', async () => {
    const ownerA = await createUser();
    const ownerB = await createUser();
    const personalA = await getPersonalOrg(ownerA.id);
    const personalB = await getPersonalOrg(ownerB.id);
    if (!personalA || !personalB) {
      throw new Error('registration trigger did not create an org');
    }

    const projectB = await createProject({
      orgId: personalB.organization.id,
      createdBy: ownerB.id,
    });
    const foreignBook = await createBook({
      orgId: personalB.organization.id,
      projectId: projectB.id,
      createdBy: ownerB.id,
    });

    await expect(
      createCatalogItem({
        orgId: personalA.organization.id,
        bookId: foreignBook.id,
        createdBy: ownerA.id,
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');
  });

  it('still allows a catalog attached to a book in the same organization', async () => {
    const user = await createUser();
    const personal = await getPersonalOrg(user.id);
    if (!personal) {
      throw new Error('registration trigger did not create an org');
    }
    const project = await createProject({
      orgId: personal.organization.id,
      createdBy: user.id,
    });
    const book = await createBook({
      orgId: personal.organization.id,
      projectId: project.id,
      createdBy: user.id,
    });

    await expect(
      createCatalogItem({
        orgId: personal.organization.id,
        bookId: book.id,
        createdBy: user.id,
      })
    ).resolves.toBeTruthy();
  });
});
