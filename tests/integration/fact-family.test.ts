import { describe, expect, it } from 'vitest';
import { getTestSql, pgErrorCode } from '../helpers/db';
import {
  addMember,
  createFamily,
  createFamilyChild,
  createFamilyPartner,
  createOrganization,
  createPerson,
  createProject,
  createUser,
} from '../helpers/factories';

/**
 * 直测数据库约束：每个用例直接对 family / family_partner / family_child 发
 * INSERT，绕过应用服务，验证附录 A.3 的 CHECK / UNIQUE / FK 真的落在库里。
 *
 * S8 阶段 A′ 把旧「union_type / partner_order / parentage_type / 软删」快照
 * 直测整体退役：目标态是裸连接行 + role/rank + 四列母亲外键。DDL 基线尚未
 * 落库，本文件只保证结构与列形状按目标态写对；阶段 B 的 T38 按附录 B 场景
 * 扩充正反例。
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
  return { user, organization, project };
}

async function sqlState(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return pgErrorCode(error);
  }
}

async function subjects() {
  const { user, organization, project } = await scope();
  const person = await createPerson({
    orgId: organization.id,
    projectId: project.id,
    createdBy: user.id,
  });
  const family = await createFamily({
    orgId: organization.id,
    projectId: project.id,
    createdBy: user.id,
  });
  return { user, organization, project, person, family };
}

describe('family / family_partner / family_child (target-model DDL)', () => {
  it('exposes only the target-model columns on a bare join row', async () => {
    const { organization, project, user } = await scope();
    const family = await createFamily({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    expect(family.projectId).toBe(project.id);
    for (const retired of [
      'unionType',
      'sort',
      'notes',
      'createdBy',
      'updatedAt',
      'deletedAt',
    ]) {
      expect(family, retired).not.toHaveProperty(retired);
    }
  });

  it('rejects a duplicate composite primary key (project_id, id)', async () => {
    const { organization, project, family } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into family (organization_id, project_id, id)
        values (${organization.id}, ${project.id}, ${family.id})`
      )
    ).toBe('23505');
  });

  it('rejects a family scoped to a project that does not exist', async () => {
    const { organization } = await scope();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into family (organization_id, project_id)
        values (${organization.id}, ${'00000000-0000-0000-0000-000000000000'})`
      )
    ).toBe('23503');
  });

  it('rejects a partner role outside the five-value domain', async () => {
    const { organization, project, person, family } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into family_partner (organization_id, project_id, family_id, person_id, role)
        values (${organization.id}, ${project.id}, ${family.id}, ${person.id}, 'bogus')`
      )
    ).toBe('23514');
  });

  it('rejects a non-positive partner rank', async () => {
    const { organization, project, person, family } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into family_partner (organization_id, project_id, family_id, person_id, role, rank)
        values (${organization.id}, ${project.id}, ${family.id}, ${person.id}, 'wife', 0)`
      )
    ).toBe('23514');
  });

  it('rejects a second partner row for the same (project, family, person)', async () => {
    const { organization, project, user, person, family } = await subjects();
    await createFamilyPartner({
      orgId: organization.id,
      projectId: project.id,
      familyId: family.id,
      personId: person.id,
      createdBy: user.id,
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into family_partner (organization_id, project_id, family_id, person_id, role)
        values (${organization.id}, ${project.id}, ${family.id}, ${person.id}, 'wife')`
      )
    ).toBe('23505');
  });

  it('keeps rank unique per (project, family, role)', async () => {
    const { organization, project, user, person, family } = await subjects();
    const other = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      sex: 'female',
    });
    await createFamilyPartner({
      orgId: organization.id,
      projectId: project.id,
      familyId: family.id,
      personId: person.id,
      createdBy: user.id,
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into family_partner (organization_id, project_id, family_id, person_id, role, rank)
        values (${organization.id}, ${project.id}, ${family.id}, ${other.id}, 'husband', 1)`
      )
    ).toBe('23505');
  });

  it('refuses a child whose mother half is not paired', async () => {
    const { organization, project, person, family } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into family_child (organization_id, project_id, family_id, person_id, mother_person_id)
        values (${organization.id}, ${project.id}, ${family.id}, ${person.id}, ${person.id})`
      )
    ).toBe('23514');
  });

  it('refuses a child kind outside the six-value domain', async () => {
    const { organization, project, person, family } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into family_child (organization_id, project_id, family_id, person_id, kind)
        values (${organization.id}, ${project.id}, ${family.id}, ${person.id}, 'bogus')`
      )
    ).toBe('23514');
  });

  it('refuses an origin family equal to the current family', async () => {
    const { organization, project, person, family } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into family_child (organization_id, project_id, family_id, person_id, kind, origin_family_id)
        values (${organization.id}, ${project.id}, ${family.id}, ${person.id}, 'adopted', ${family.id})`
      )
    ).toBe('23514');
  });

  it('refuses a mother pair that has no matching partner row (four-column FK)', async () => {
    const { organization, project, person, family } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into family_child (organization_id, project_id, family_id, person_id, mother_person_id, mother_role)
        values (${organization.id}, ${project.id}, ${family.id}, ${person.id}, ${person.id}, 'wife')`
      )
    ).toBe('23503');
  });

  it('accepts a mother pair that matches a partner row', async () => {
    const { organization, project, user, person, family } = await subjects();
    await createFamilyPartner({
      orgId: organization.id,
      projectId: project.id,
      familyId: family.id,
      personId: person.id,
      createdBy: user.id,
    });
    const child = await createFamilyChild({
      orgId: organization.id,
      projectId: project.id,
      familyId: family.id,
      personId: person.id,
      createdBy: user.id,
    });
    expect(child.kind).toBe('biological');
    expect(child.motherPersonId).toBeNull();
    expect(child.motherRole).toBeNull();
  });
});
