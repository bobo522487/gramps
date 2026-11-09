import { describe, expect, it } from 'vitest';
import { persons } from '@/lib/db/schema';
import {
  PERSON_NAME_TYPE_VALUES,
  PERSON_SEX_VALUES,
} from '@/lib/genealogy/constants';
import { readCheckConstraintValues } from '../helpers/constraints';
import { getTestDb, getTestSql, pgErrorCode } from '../helpers/db';
import {
  addMember,
  createOrganization,
  createPerson,
  createPersonName,
  createProject,
  createUser,
} from '../helpers/factories';

// 直测数据库约束：每个用例都直接对 person / person_name 发 INSERT，绕过应用
// 服务，验证附录 A.3 的 CHECK / UNIQUE / FK 真的落在库里（不是应用逻辑）。
// 阶段 A′ 的 DDL 基线尚未落库，本文件只保证结构与列形状按目标态写对。

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

/** Executes a raw statement and returns its SQLSTATE, or undefined on success. */
async function sqlState(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return pgErrorCode(error);
  }
}

describe('person / person_name (target-model DDL constraints)', () => {
  it('stores a target-model person and exposes only the new columns', async () => {
    const { organization, project, user } = await scope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      sex: 'female',
    });
    const [row] = await getTestDb().select().from(persons);
    expect(row?.sex).toBe('female');
    expect(person.orgId).toBe(organization.id);
    expect(person.projectId).toBe(project.id);
    // 退役的回填快照列不应再出现在结果行上。
    for (const retired of [
      'livingStatus',
      'privacyLevel',
      'nameStatus',
      'primaryNameId',
      'mergedIntoId',
      'sortKey',
      'legacyNodeId',
      'createdBy',
      'updatedAt',
      'deletedAt',
    ]) {
      expect(person, retired).not.toHaveProperty(retired);
    }
  });

  it('refuses a sex outside the four-value CHECK domain (person_sex_check)', async () => {
    const { organization, project } = await scope();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into person (organization_id, project_id, sex)
        values (${organization.id}, ${project.id}, 'bogus')`
      )
    ).toBe('23514');
  });

  it('refuses a blank person_name.value (person_name_value_not_blank)', async () => {
    const { organization, project, user } = await scope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into person_name (organization_id, project_id, person_id, kind, value)
        values (${organization.id}, ${project.id}, ${person.id}, 'given', '   ')`
      )
    ).toBe('23514');
  });

  it('refuses a person_name.kind outside the seven-value domain', async () => {
    const { organization, project, user } = await scope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into person_name (organization_id, project_id, person_id, kind, value)
        values (${organization.id}, ${project.id}, ${person.id}, 'birth', '陈实')`
      )
    ).toBe('23514');
  });

  it('refuses a duplicate (project_id, person_id, kind, value)', async () => {
    const { organization, project, user } = await scope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    await createPersonName({
      orgId: organization.id,
      projectId: project.id,
      personId: person.id,
      createdBy: user.id,
      fullName: '陈实',
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into person_name (organization_id, project_id, person_id, kind, value)
        values (${organization.id}, ${project.id}, ${person.id}, 'given', '陈实')`
      )
    ).toBe('23505');
  });

  it('allows at most one primary name per person (person_name_one_primary)', async () => {
    const { organization, project, user } = await scope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    await createPersonName({
      orgId: organization.id,
      projectId: project.id,
      personId: person.id,
      createdBy: user.id,
      fullName: '陈实',
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into person_name (organization_id, project_id, person_id, kind, value, is_primary)
        values (${organization.id}, ${project.id}, ${person.id}, 'courtesy', '陈元英', true)`
      )
    ).toBe('23505');
  });

  it('refuses a name whose person belongs to another project (person_name_person_fk)', async () => {
    const { organization, project, user } = await scope();
    const otherProject = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into person_name (organization_id, project_id, person_id, kind, value)
        values (${organization.id}, ${otherProject.id}, ${person.id}, 'given', '陈实')`
      )
    ).toBe('23503');
  });

  it('refuses a name scoped to a project that does not exist (person_name_scope_fk)', async () => {
    const { organization, project, user } = await scope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into person_name (organization_id, project_id, person_id, kind, value)
        values (${organization.id}, ${'00000000-0000-0000-0000-000000000000'}, ${person.id}, 'given', '陈实')`
      )
    ).toBe('23503');
  });

  it('rejects a duplicate composite primary key (project_id, id)', async () => {
    const { organization, project, user } = await scope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into person (organization_id, project_id, id, sex)
        values (${organization.id}, ${project.id}, ${person.id}, 'male')`
      )
    ).toBe('23505');
  });
});

// 值域常量与数据库 CHECK 不能漂移：任何一边单独加值都会被这条钉住。
const enumConstraints = [
  {
    table: 'person',
    constraint: 'person_sex_check',
    values: PERSON_SEX_VALUES,
  },
  {
    // 内联无名 CHECK 的 PG 默认名是 <table>_<column>_check。
    table: 'person_name',
    constraint: 'person_name_kind_check',
    values: PERSON_NAME_TYPE_VALUES,
  },
];

describe('person enum columns match the TypeScript constants', () => {
  for (const { table, constraint, values } of enumConstraints) {
    it(`${table}.${constraint}`, async () => {
      await expect(
        readCheckConstraintValues(getTestSql(), table, constraint)
      ).resolves.toEqual([...values].sort());
    });
  }
});
