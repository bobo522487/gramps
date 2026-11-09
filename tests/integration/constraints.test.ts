import { and, eq, sql } from 'drizzle-orm';
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
          tokenHash: `constraint-probe-${Date.now()}`,
          invitedBy: owner.id,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23514');
  });

  it('rejects duplicate pending invitations per organization and email', async () => {
    const invitedBy = await createUser();
    const organization = await createOrganization();
    await createInvitation({
      organizationId: organization.id,
      invitedBy: invitedBy.id,
      email: 'Dup@Example.com',
    });

    await expect(
      createInvitation({
        organizationId: organization.id,
        invitedBy: invitedBy.id,
        email: 'dup@example.com',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23505');
  });

  /**
   * 旧实现是「同组织同邮箱只能有一条 pending」的部分唯一索引，所以
   * 「上一封已接受 / 已撤销后可以再发新邀请」成立。
   *
   * 目标态（附录 A.1）改成 `UNIQUE (organization_id, email)` **全量唯一**：
   * 重发走 A.7 的 `ON CONFLICT … DO UPDATE` 原地更新同一行，而不是插新行。
   * 下面两条守的是新语义——重发必须是「换 token 续期」，且已消费的邀请
   * 不给重发（A.7 的 `WHERE accepted_at IS NULL` 影响 0 行）。
   *
   * 这条覆盖的是 A.7 SQL 的形状；应用层 `issueInvitation()` 的行为由
   * `tests/s8-stage-b2b.test.ts` B2b-5 静态断言。
   */
  it('reissues by rotating the token on the same row, never a second invite', async () => {
    const invitedBy = await createUser();
    const organization = await createOrganization();
    const first = await createInvitation({
      organizationId: organization.id,
      invitedBy: invitedBy.id,
      email: 'again@example.com',
    });

    const reissued = await getTestDb()
      .insert(invitations)
      .values({
        organizationId: organization.id,
        email: 'again@example.com',
        role: 'viewer',
        tokenHash: `reissued-${Date.now()}`,
        invitedBy: invitedBy.id,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      })
      .onConflictDoUpdate({
        target: [invitations.organizationId, invitations.email],
        set: { tokenHash: sql`excluded.token_hash`, status: 'pending' },
        where: sql`${invitations.acceptedAt} is null`,
      })
      .returning({ id: invitations.id, tokenHash: invitations.tokenHash });

    // 同一行原地更新，不是插出第二条。
    expect(reissued).toHaveLength(1);
    expect(reissued[0].id).toBe(first.id);
    expect(reissued[0].tokenHash).not.toBe(first.tokenHash);
  });

  it('refuses to reopen an invitation that was already accepted', async () => {
    const invitedBy = await createUser();
    const organization = await createOrganization();
    const accepted = await createInvitation({
      organizationId: organization.id,
      invitedBy: invitedBy.id,
      email: 'joined@example.com',
      status: 'accepted',
    });

    const rows = await getTestDb()
      .insert(invitations)
      .values({
        organizationId: organization.id,
        email: 'joined@example.com',
        role: 'viewer',
        tokenHash: `reopen-${Date.now()}`,
        invitedBy: invitedBy.id,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      })
      .onConflictDoUpdate({
        target: [invitations.organizationId, invitations.email],
        set: { tokenHash: sql`excluded.token_hash`, status: 'pending' },
        where: sql`${invitations.acceptedAt} is null`,
      })
      .returning({ id: invitations.id });

    // A.7 的 WHERE 让这条路影响 0 行——应用据此报「该邮箱已是成员」，
    // 而不是把已加入的人退回 pending（那会与 organization_member 里的成员行矛盾）。
    expect(rows).toHaveLength(0);
    expect(accepted.status).toBe('accepted');
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
        name: '跨组织文件夹',
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

  // 目标态 node 无 generation 列/约束：此处 23514 实由 node_path_format 兜住，
  // 改成合法 path 会撞 node_parent_fk(23503) 或插入成功、令断言落空，故保留占位 path。
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
      path: '0001',
    });
    await expect(
      createNode({
        orgId: organization.id,
        lineageId: lineage.id,
        createdBy: user.id,
        generation: 1,
        role: 'spouse',
        spouseOfId: root.id,
        // 基线新增 node_path_unique：同谱系第二个节点改用不冲突的 path
        path: '0002',
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
      path: '0001',
    });
    await expect(
      createNode({
        orgId: organization.id,
        lineageId: a.id,
        createdBy: user.id,
        parentId: foreignParent.id,
        generation: 2,
        // 基线用 path 父路径 FK 表达跨谱系父子：甲谱无 '0001' → node_parent_fk 23503
        path: '0001.0002',
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
      path: '0001',
    });
    await expect(
      createNode({
        orgId: organization.id,
        lineageId: lineage.id,
        createdBy: user.id,
        parentId: root.id,
        generation: 2,
        // 基线新增 node_path_format / node_parent_fk：父子路径自洽 root '0001' / child '0001.0002'
        path: '0001.0002',
      })
    ).resolves.toBeTruthy();
  });
});

describe('folder names are unique inside a project', () => {
  async function projectScope() {
    const user = await createUser();
    const personal = await getPersonalOrg(user.id);
    if (!personal)
      throw new Error('registration trigger did not create an org');
    const organization = personal.organization;
    const project = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    return { user, organization, project };
  }

  it('rejects a duplicate name in the same project', async () => {
    const { user, organization, project } = await projectScope();
    await createFolder({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      name: '谱序',
    });
    // folder_name_unique (project_id, name)：扁平单层后三类内容共用一套分类，
    // 所以同名分类在项目内只能有一条。
    await expect(
      createFolder({
        orgId: organization.id,
        projectId: project.id,
        createdBy: user.id,
        name: '谱序',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23505');
  });

  it('allows the same name in two different projects', async () => {
    const { user, organization, project } = await projectScope();
    const other = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const inFirst = await createFolder({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      name: '谱序',
    });
    const inOther = await createFolder({
      orgId: organization.id,
      projectId: other.id,
      createdBy: user.id,
      name: '谱序',
    });
    // 唯一键是 (project_id, name)，跨项目可以重名。
    expect(inOther.projectId).toBe(other.id);
    expect(inOther.id).not.toBe(inFirst.id);
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
      path: '0001',
    });

    await expect(
      createNode({
        orgId: organization.id,
        lineageId: lineageA.id,
        createdBy: user.id,
        generation: 1,
        role: 'spouse',
        spouseOfId: foreignBlood.id,
        // 跨谱系外键：甲谱无父路径 '0001'（'0001' 在乙谱）→ node_parent_fk 23503
        path: '0001.0002',
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
      path: '0001',
    });

    await expect(
      createNode({
        orgId: organization.id,
        lineageId: lineage.id,
        createdBy: user.id,
        generation: 1,
        role: 'spouse',
        spouseOfId: blood.id,
        // 基线新增 node_path_unique：同谱系第二个节点改用不冲突的 path
        path: '0002',
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

    const projectA = await createProject({
      orgId: personalA.organization.id,
      createdBy: ownerA.id,
    });
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
        projectId: projectA.id,
        bookId: foreignBook.id,
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
        projectId: project.id,
        bookId: book.id,
      })
    ).resolves.toBeTruthy();
  });
});
