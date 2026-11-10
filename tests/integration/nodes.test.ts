import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { nodes } from '@/lib/db/schema';
import { getTestDb, getTestSql, pgErrorCode } from '../helpers/db';
import {
  addMember,
  createLineage,
  createNode,
  createOrganization,
  createPerson,
  createProject,
  createUser,
} from '../helpers/factories';

/**
 * 直测数据库约束：直接对 `node` 发 INSERT / SELECT，验证附录 A.4 的稀疏
 * 编号 ltree、parent_path 生成列、自引用闭包外键与 annotation 约束落在库里。
 *
 * S8 阶段 A′ 把旧「node 即人丁主体」的写入层集成测试整体退役：目标态 `node`
 * 只是一条位置引用，身份在 `person`、姓名在 `person_name`。配偶 / 移动 / 重排
 * 的应用集成测试留到阶段 C 恢复功能后重建，登记见实施计划 §3.3。
 * DDL 基线尚未落库，本文件只保证结构与列形状按目标态写对。
 */
async function scope() {
  const user = await createUser();
  const organization = await createOrganization();
  await addMember({
    userId: user.id,
    organizationId: organization.id,
    role: 'owner',
  });
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

async function sqlState(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return pgErrorCode(error);
  }
}

async function insertNode(
  organizationId: string,
  projectId: string,
  lineageId: string,
  path: string,
  kind = 'annotation',
  personId: string | null = null
) {
  return getTestSql()`
    insert into node (organization_id, project_id, lineage_id, path, kind, person_id)
    values (${organizationId}, ${projectId}, ${lineageId}, ${path}, ${kind}, ${personId})`;
}

describe('node (target-model DDL constraints)', () => {
  it('exposes only position-reference columns', async () => {
    const { organization, project, user, lineage } = await scope();
    const node = await createNode({
      orgId: organization.id,
      projectId: project.id,
      lineageId: lineage.id,
      createdBy: user.id,
      path: '0001',
    });
    expect(node.path).toBe('0001');
    expect(node.kind).toBe('annotation');
    expect(node.parentPath).toBeNull();
    for (const retired of [
      'parentId',
      'spouseOfId',
      'role',
      'generation',
      'sort',
      'name',
      'surname',
      'fullName',
      'sex',
      'isAlive',
      'requestId',
      'createdBy',
      'updatedAt',
      'deletedAt',
    ]) {
      expect(node, retired).not.toHaveProperty(retired);
    }
  });

  it('rejects a path outside the four-digit sparse ltree format', async () => {
    const { organization, project, lineage } = await scope();
    expect(
      await sqlState(() =>
        insertNode(organization.id, project.id, lineage.id, 'abcd')
      )
    ).toBe('23514');
    expect(
      await sqlState(() =>
        insertNode(organization.id, project.id, lineage.id, '0001.a')
      )
    ).toBe('23514');
  });

  it('rejects two nodes at the same (project, lineage, path)', async () => {
    const { organization, project, lineage } = await scope();
    expect(
      await sqlState(() =>
        insertNode(organization.id, project.id, lineage.id, '0001')
      )
    ).toBeUndefined();
    expect(
      await sqlState(() =>
        insertNode(organization.id, project.id, lineage.id, '0001')
      )
    ).toBe('23505');
  });

  it('rejects a kind outside primary/repeat/annotation', async () => {
    const { organization, project, lineage } = await scope();
    expect(
      await sqlState(() =>
        insertNode(organization.id, project.id, lineage.id, '0001', 'bogus')
      )
    ).toBe('23514');
  });

  it('keeps annotation without a person and other kinds with one', async () => {
    const { organization, project, user, lineage } = await scope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    expect(
      await sqlState(() =>
        insertNode(
          organization.id,
          project.id,
          lineage.id,
          '0001',
          'annotation',
          person.id
        )
      )
    ).toBe('23514');
    expect(
      await sqlState(() =>
        insertNode(
          organization.id,
          project.id,
          lineage.id,
          '0001',
          'primary',
          null
        )
      )
    ).toBe('23514');
    expect(
      await sqlState(() =>
        insertNode(
          organization.id,
          project.id,
          lineage.id,
          '0001',
          'primary',
          person.id
        )
      )
    ).toBeUndefined();
  });

  it('derives parent_path from path and enforces the self-referencing parent FK', async () => {
    const { organization, project, lineage } = await scope();
    // 没有父行时，子路径的 parent_path 指向不存在的 '0001'。
    expect(
      await sqlState(() =>
        insertNode(organization.id, project.id, lineage.id, '0001.0010')
      )
    ).toBe('23503');

    expect(
      await sqlState(() =>
        insertNode(organization.id, project.id, lineage.id, '0001')
      )
    ).toBeUndefined();
    expect(
      await sqlState(() =>
        insertNode(organization.id, project.id, lineage.id, '0001.0010')
      )
    ).toBeUndefined();

    const child = await getTestDb()
      .select({ parentPath: nodes.parentPath })
      .from(nodes)
      .where(eq(nodes.path, '0001.0010'))
      .limit(1);
    expect(child[0]?.parentPath).toBe('0001');
  });

  it('allows at most one primary node per person', async () => {
    const { organization, project, user, lineage } = await scope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    expect(
      await sqlState(() =>
        insertNode(
          organization.id,
          project.id,
          lineage.id,
          '0001',
          'primary',
          person.id
        )
      )
    ).toBeUndefined();
    expect(
      await sqlState(() =>
        insertNode(
          organization.id,
          project.id,
          lineage.id,
          '0002',
          'repeat',
          person.id
        )
      )
    ).toBeUndefined();
    expect(
      await sqlState(() =>
        insertNode(
          organization.id,
          project.id,
          lineage.id,
          '0003',
          'primary',
          person.id
        )
      )
    ).toBe('23505');
  });

  it('rejects a node scoped to a project that does not exist', async () => {
    const { organization, lineage } = await scope();
    expect(
      await sqlState(() =>
        insertNode(
          organization.id,
          '00000000-0000-0000-0000-000000000000',
          lineage.id,
          '0001'
        )
      )
    ).toBe('23503');
  });

  it('rejects a duplicate composite primary key (project_id, id)', async () => {
    const { organization, project, user, lineage } = await scope();
    const node = await createNode({
      orgId: organization.id,
      projectId: project.id,
      lineageId: lineage.id,
      createdBy: user.id,
      path: '0001',
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into node (organization_id, project_id, id, lineage_id, path, kind)
        values (${organization.id}, ${project.id}, ${node.id}, ${lineage.id}, '0002', 'annotation')`
      )
    ).toBe('23505');
  });
});
