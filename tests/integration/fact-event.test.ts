import { describe, expect, it } from 'vitest';
import { EVENT_KIND_VALUES } from '@/lib/genealogy/constants';
import { readCheckConstraintValues } from '../helpers/constraints';
import { getTestSql, pgErrorCode } from '../helpers/db';
import {
  addMember,
  createEvent,
  createFamily,
  createOrganization,
  createPerson,
  createProject,
  createUser,
} from '../helpers/factories';

/**
 * 直测数据库约束：直接对 `event` 发 INSERT，验证附录 A.3 的单一主体 CHECK、
 * 11 值域、生卒部分唯一索引与日期约束真的落在库里。
 *
 * S8 阶段 A′ 把旧「event_kind / event_type / 日期矩阵 / 软删」快照直测整体
 * 退役：目标态是一张扁平的 kind + 双主体 + date_text/date_sort 表。DDL 基线
 * 尚未落库，本文件只保证结构与列形状按目标态写对；阶段 B 的 T38 按附录 B
 * 场景扩充正反例。
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

describe('event (target-model DDL constraints)', () => {
  it('exposes only the target-model columns', async () => {
    const { organization, project, user, person } = await subjects();
    const event = await createEvent({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      personId: person.id,
    });
    expect(event.kind).toBe('birth');
    expect(event.personId).toBe(person.id);
    for (const retired of [
      'eventKind',
      'eventType',
      'customType',
      'dateOriginal',
      'dateQualifier',
      'dateCn',
      'ageYears',
      'createdBy',
      'updatedAt',
      'deletedAt',
    ]) {
      expect(event, retired).not.toHaveProperty(retired);
    }
  });

  it('requires exactly one subject (num_nonnulls = 1)', async () => {
    const { organization, project, person, family } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, kind, person_id, family_id)
        values (${organization.id}, ${project.id}, 'birth', ${person.id}, ${family.id})`
      )
    ).toBe('23514');
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, kind)
        values (${organization.id}, ${project.id}, 'birth')`
      )
    ).toBe('23514');
  });

  it('rejects a kind outside the eleven-value domain', async () => {
    const { organization, project, person } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, kind, person_id)
        values (${organization.id}, ${project.id}, 'bogus', ${person.id})`
      )
    ).toBe('23514');
  });

  it('rejects a malformed date_sort', async () => {
    const { organization, project, person } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, kind, person_id, date_text, date_sort)
        values (${organization.id}, ${project.id}, 'birth', ${person.id}, '光绪二十年', 'abc')`
      )
    ).toBe('23514');
  });

  it('rejects a date_sort without date_text', async () => {
    const { organization, project, person } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, kind, person_id, date_sort)
        values (${organization.id}, ${project.id}, 'birth', ${person.id}, '1894')`
      )
    ).toBe('23514');
  });

  it('allows at most one birth and one death per person', async () => {
    const { organization, project, user, person } = await subjects();
    await createEvent({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      personId: person.id,
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, kind, person_id)
        values (${organization.id}, ${project.id}, 'birth', ${person.id})`
      )
    ).toBe('23505');
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, kind, person_id, date_text)
        values (${organization.id}, ${project.id}, 'death', ${person.id}, '一九六八年')`
      )
    ).toBeUndefined();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, kind, person_id, date_text)
        values (${organization.id}, ${project.id}, 'death', ${person.id}, '一九六九年')`
      )
    ).toBe('23505');
  });

  it('requires a person subject for person-only kinds', async () => {
    const { organization, project, family } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, kind, family_id)
        values (${organization.id}, ${project.id}, 'birth', ${family.id})`
      )
    ).toBe('23514');
  });

  it('requires a family subject for family-only kinds', async () => {
    const { organization, project, person } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, kind, person_id)
        values (${organization.id}, ${project.id}, 'marriage', ${person.id})`
      )
    ).toBe('23514');
  });

  it('rejects an event scoped to a project that does not exist', async () => {
    const { organization, person } = await subjects();
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, kind, person_id)
        values (${organization.id}, ${'00000000-0000-0000-0000-000000000000'}, 'birth', ${person.id})`
      )
    ).toBe('23503');
  });

  it('rejects a duplicate composite primary key (project_id, id)', async () => {
    const { organization, project, user, person } = await subjects();
    const event = await createEvent({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      personId: person.id,
    });
    expect(
      await sqlState(
        () => getTestSql()`
        insert into event (organization_id, project_id, id, kind, person_id)
        values (${organization.id}, ${project.id}, ${event.id}, 'burial', ${person.id})`
      )
    ).toBe('23505');
  });
});

// 值域常量与数据库 CHECK 不能漂移：任何一边单独加值都会被这条钉住。
describe('event enum column matches the TypeScript constant', () => {
  it('event_kind_check', async () => {
    // 基线的 event.kind 是内联无名 CHECK，PG 自动命名为 event_kind_check；
    // 旧测试写的 event_domain_check 从来不是落库对象名。
    await expect(
      readCheckConstraintValues(getTestSql(), 'event', 'event_kind_check')
    ).resolves.toEqual([...EVENT_KIND_VALUES].sort());
  });
});
