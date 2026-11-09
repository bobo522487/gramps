import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withOrg } from '@/lib/db/drizzle';
import {
  getOrgsForUser,
  getOrgWithRoleBySlug,
} from '@/lib/db/queries/organizations';
import {
  getProjectById,
  getProjectScopeByRef,
  getProjects,
} from '@/lib/db/queries/projects';
import { organizations, projects } from '@/lib/db/schema';
import {
  createProjectInTransaction,
  deleteProjectInTransaction,
  updateProjectInTransaction,
} from '@/lib/project/services';
import {
  getTestDb,
  getTestSql,
  pgErrorCode,
  pgErrorMessages,
} from '../helpers/db';
import {
  addMember,
  createOrganization,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

const projectInput = {
  name: '颍川陈氏云谱',
  surname: '陈',
  themeName: '陈实',
  countriesRegions: '中国福建',
  status: 'in_progress' as const,
  importance: 1,
};

describe('organization and project scope', () => {
  it('resolves an organization slug only for its members', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const organization = await createOrganization({ name: '陈氏族谱' });
    await addMember({
      userId: alice.id,
      organizationId: organization.id,
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

  it('does not resolve a closed organization', async () => {
    const alice = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: alice.id,
      organizationId: organization.id,
      role: 'owner',
    });

    // 目标态没有 `deleted_at`（附录 A.1），关停只剩 `status = 'closed'` 这一个信号，
    // 查询层靠它把组织挡在外面。
    await getTestDb()
      .update(organizations)
      .set({ status: 'closed' })
      .where(eq(organizations.id, organization.id));

    expect(await getOrgWithRoleBySlug(alice.id, organization.slug)).toBeNull();
  });

  it('lists only organizations the user belongs to', async () => {
    const alice = await createUser();
    const personal = await getPersonalOrg(alice.id);
    const organization = await createOrganization();
    const foreignOrganization = await createOrganization();
    await addMember({ userId: alice.id, organizationId: organization.id });

    const rows = await getOrgsForUser(alice.id);
    const ids = rows.map((row) => row.organization.id);

    expect(personal).not.toBeNull();
    expect(ids).toEqual([personal?.organization.id, organization.id]);
    expect(ids).not.toContain(foreignOrganization.id);
  });

  it('resolves a project ref only for members of its organization', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const aliceOrg = await createOrganization();
    const bobOrg = await createOrganization();
    await addMember({
      userId: alice.id,
      organizationId: aliceOrg.id,
      role: 'owner',
    });
    await addMember({
      userId: bob.id,
      organizationId: bobOrg.id,
      role: 'owner',
    });
    const aliceProject = await createProject({
      orgId: aliceOrg.id,
      createdBy: alice.id,
      name: '颍川陈氏',
    });
    const bobProject = await createProject({
      orgId: bobOrg.id,
      createdBy: bob.id,
    });

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
    await addMember({
      userId: alice.id,
      organizationId: aliceOrg.id,
      role: 'owner',
    });
    const project = await createProject({
      orgId: aliceOrg.id,
      createdBy: alice.id,
      name: '原始名称',
    });
    const foreignProject = await createProject({
      orgId: otherOrg.id,
      createdBy: alice.id,
    });

    expect(await getProjectById(alice.id, project.id, otherOrg.id)).toBeNull();
    expect(
      await updateProjectInTransaction({
        userId: alice.id,
        orgId: otherOrg.id,
        projectId: project.id,
        updates: { name: '越权修改' },
      })
    ).toEqual({ ok: false, reason: 'forbidden' });
    expect(
      await deleteProjectInTransaction({
        userId: alice.id,
        orgId: otherOrg.id,
        projectId: project.id,
      })
    ).toEqual({ ok: false, reason: 'forbidden' });

    // Member of the org, but the project belongs to another organization.
    expect(
      await updateProjectInTransaction({
        userId: alice.id,
        orgId: aliceOrg.id,
        projectId: foreignProject.id,
        updates: { name: '越权修改' },
      })
    ).toEqual({ ok: false, reason: 'not_found' });

    expect(
      (await getProjectById(alice.id, project.id, aliceOrg.id))?.name
    ).toBe('原始名称');
  });

  it('updates and soft-deletes a project inside its own organization', async () => {
    const alice = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: alice.id,
      organizationId: organization.id,
      role: 'owner',
    });
    const project = await createProject({
      orgId: organization.id,
      createdBy: alice.id,
    });

    const updated = await updateProjectInTransaction({
      userId: alice.id,
      orgId: organization.id,
      projectId: project.id,
      updates: { name: '新名称' },
    });

    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.project.name).toBe('新名称');
    }

    expect(
      await deleteProjectInTransaction({
        userId: alice.id,
        orgId: organization.id,
        projectId: project.id,
      })
    ).toEqual({ ok: true });
    expect(
      await getProjectById(alice.id, project.id, organization.id)
    ).toBeNull();
    expect(
      (await getProjects(alice.id, organization.id)).map((row) => row.id)
    ).not.toContain(project.id);
  });
});

describe('role permissions for project.write', () => {
  it('lets only owners and admins create projects', async () => {
    const viewer = await createUser();
    const editor = await createUser();
    const admin = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: viewer.id,
      organizationId: organization.id,
    });
    await addMember({
      userId: editor.id,
      organizationId: organization.id,
      role: 'editor',
    });
    await addMember({
      userId: admin.id,
      organizationId: organization.id,
      role: 'admin',
    });

    for (const actor of [viewer, editor]) {
      expect(
        await createProjectInTransaction({
          userId: actor.id,
          orgId: organization.id,
          input: projectInput,
        })
      ).toEqual({ ok: false, reason: 'forbidden' });
    }

    const created = await createProjectInTransaction({
      userId: admin.id,
      orgId: organization.id,
      input: projectInput,
    });
    expect(created.ok).toBe(true);
  });
});

describe('row level security', () => {
  it('returns no rows without JWT claims', async () => {
    const alice = await createUser();
    const organization = await createOrganization();
    await addMember({ userId: alice.id, organizationId: organization.id });
    await createProject({ orgId: organization.id, createdBy: alice.id });

    const counts = await getTestSql().begin(async (tx) => {
      await tx`set local role genealogy_app`;
      const [orgs] = await tx<
        { count: number }[]
      >`select count(*)::int as count from organization`;
      const [projects] = await tx<
        { count: number }[]
      >`select count(*)::int as count from project`;
      const [members] = await tx<
        { count: number }[]
      >`select count(*)::int as count from organization_member`;
      return {
        organizations: orgs.count,
        projects: projects.count,
        members: members.count,
      };
    });

    expect(counts).toEqual({ organizations: 0, projects: 0, members: 0 });
  });

  it('shows a signed-in user only their own organizations and projects', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const aliceOrg = await getPersonalOrg(alice.id);
    const bobOrg = await getPersonalOrg(bob.id);
    expect(aliceOrg).not.toBeNull();
    expect(bobOrg).not.toBeNull();

    const aliceProject = await createProject({
      orgId: aliceOrg?.organization.id as string,
      createdBy: alice.id,
    });
    await createProject({
      orgId: bobOrg?.organization.id as string,
      createdBy: bob.id,
    });

    const visible = await withOrg(alice.id, async (tx) => ({
      organizations: await tx
        .select({ id: organizations.id })
        .from(organizations),
      projects: await tx.select({ id: projects.id }).from(projects),
    }));

    expect(visible.organizations.map((row) => row.id)).toEqual([
      aliceOrg?.organization.id,
    ]);
    expect(visible.projects.map((row) => row.id)).toEqual([aliceProject.id]);
  });

  it('blocks cross-organization updates and inserts at the database layer', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobOrg = await getPersonalOrg(bob.id);

    // T32 修订后业务连接是 genealogy_app，基线给它 organization 的 UPDATE
    // （不再是只授 SELECT 的 app_rw）。所以越权 UPDATE 不再因表级权限报
    // 42501：RLS 的 USING 谓词把目标行过滤掉，RETURNING 返回空数组。
    // 权限矩阵变了，隔离保证不能变——断言「一行都没改到」而不是某个
    // 特定 SQLSTATE，再回查一次确认 bob 的组织名没被写坏。
    const updated = await withOrg(alice.id, (tx) =>
      tx
        .update(organizations)
        .set({ name: '越权修改' })
        .where(eq(organizations.id, bobOrg?.organization.id as string))
        .returning({ id: organizations.id })
    );
    expect(updated).toEqual([]);

    const [bobRow] = await getTestSql()<
      { name: string }[]
    >`select name from organization
      where id = ${bobOrg?.organization.id as string}`;
    expect(bobRow?.name).not.toBe('越权修改');

    await expect(
      withOrg(alice.id, (tx) =>
        tx.insert(projects).values({
          orgId: bobOrg?.organization.id as string,
          name: '越权项目',
          themeName: '陈实',
          surname: '陈',
          createdBy: alice.id,
        })
      )
    ).rejects.toSatisfy(
      (error) =>
        pgErrorCode(error) === '42501' &&
        pgErrorMessages(error).some((message) =>
          message.includes(
            'new row violates row-level security policy for table "project"'
          )
        )
    );
  });

  it('leaves role-based write refusal to the application layer, not RLS', async () => {
    // 目标态的分工写死在 docs/data-model.md §3 与 §9：
    // **RLS 只做可见性，owner / admin / editor / viewer 的读写授权由
    // 应用服务在单一写入路径判定**。viewer 是组织成员，visible_org_array()
    // 含这个组织，所以 DB 层放行 INSERT；拒绝 viewer 写入是 withOrgWrite 的
    // 职责（tests/integration/with-org-write.test.ts 的
    // "refuses before running the callback for a viewer"）。
    //
    // 这条用例守的正是**这个分工**：谁往 org_isolation 里加角色谓词，就会出现
    // 第二份「按角色授权」的 DDL 真相源，必须回来改这里并同步 §3/§9，
    // 而不是悄悄多一道没人知道的防线。
    const viewer = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: viewer.id,
      organizationId: organization.id,
      role: 'viewer',
    });

    const [row] = await withOrg(viewer.id, (tx) =>
      tx
        .insert(projects)
        .values({
          orgId: organization.id,
          name: '只读角色在 DB 层不被拦',
          themeName: '陈实',
          surname: '陈',
          createdBy: viewer.id,
        })
        .returning({ id: projects.id })
    );

    expect(row?.id).toBeTruthy();
  });

  it('keeps auth.user unreachable for the runtime role', async () => {
    const alice = await createUser();

    await expect(
      withOrg(alice.id, (tx) => tx.execute(sql`select * from auth.user`))
    ).rejects.toSatisfy(
      // 拦住的是 schema 而不是表：genealogy_app 连 USAGE ON SCHEMA auth 都没有
      // （基线只授 public / app），所以报 `permission denied for schema auth`。
      // auth.* 四表无 RLS，这层隔离是认证侧保留独立角色的理由，不能放开。
      // 以前断言的表级 `table users` 是旧复数表名时代的消息。
      (error) =>
        pgErrorCode(error) === '42501' &&
        pgErrorMessages(error).some((message) =>
          message.includes('permission denied for schema auth')
        )
    );
  });
});
