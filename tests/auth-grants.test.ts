import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { authGrants, TENANT_TABLES } from '../scripts/lib/auth-grants.mjs';

const root = join(import.meta.dirname, '..');
const script = readFileSync(join(root, 'scripts/provision-roles.mjs'), 'utf8');

const indexOf = (predicate: (statement: string) => boolean) =>
  authGrants.findIndex(predicate);
const allIndexOf = (predicate: (statement: string) => boolean) =>
  authGrants.flatMap((statement, index) =>
    predicate(statement) ? [index] : []
  );

/**
 * 2026-11-09 的漏网之鱼：矩阵里只有 `REVOKE ALL ON SCHEMA …`，而 schema 级
 * REVOKE 收不回表级 GRANT。ADR 0020 之前认证侧是「运行期角色全量统一」，
 * 迁移过的旧库上 `auth_service` 可能仍握着 public 全表 DML——注释写着
 * 「重复执行不会累积历史权限」，实际并不会。以下用例把顺序与覆盖面做成断言。
 */
describe('G1 回收必须全部先于授予', () => {
  test('最后一条 REVOKE 排在第一条 GRANT 之前', () => {
    const revokes = allIndexOf((statement) => statement.startsWith('REVOKE'));
    const grants = allIndexOf((statement) => statement.startsWith('GRANT'));

    expect(revokes.length).toBeGreaterThan(0);
    expect(grants.length).toBeGreaterThan(0);
    expect(Math.max(...revokes)).toBeLessThan(Math.min(...grants));
  });

  test('默认权限那条不夹在回收段里（它只做正向授予）', () => {
    expect(
      indexOf((statement) => statement.startsWith('ALTER DEFAULT PRIVILEGES'))
    ).toBeGreaterThanOrEqual(
      Math.min(...allIndexOf((statement) => statement.startsWith('GRANT')))
    );
  });
});

describe('G2 回收覆盖表 / 序列 / 函数，且覆盖 auth / app / public', () => {
  const objects = [
    'REVOKE ALL ON ALL TABLES IN SCHEMA',
    'REVOKE ALL ON ALL SEQUENCES IN SCHEMA',
    'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA',
  ];

  for (const prefix of objects) {
    for (const schema of ['auth', 'app', 'public']) {
      test(`${prefix} ${schema}`, () => {
        expect(
          indexOf(
            (statement) =>
              statement.startsWith(prefix) && statement.includes(schema)
          )
        ).toBeGreaterThanOrEqual(0);
      });
    }
  }

  test('schema 级回收仍在（表级回收不是替代品）', () => {
    for (const schema of ['auth', 'app', 'public']) {
      expect(
        indexOf(
          (statement) =>
            statement.startsWith('REVOKE ALL ON SCHEMA') &&
            statement.includes(schema)
        )
      ).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('G3 只动 auth_service，别的角色一个都不碰', () => {
  test('没有一条语句指向 genealogy_app / auth_runtime 的权限', () => {
    const revokes = authGrants.filter((statement) =>
      statement.startsWith('REVOKE')
    );

    for (const statement of revokes) {
      expect(statement).toMatch(/FROM auth_service$/);
      expect(statement).not.toContain('genealogy_app');
      expect(statement).not.toContain('auth_runtime');
    }
  });

  test('超出矩阵的 schema（如 drizzle）不做无差别回收', () => {
    expect(authGrants.join('\n')).not.toContain('drizzle');
  });
});

describe('G4 授予侧与权限矩阵一致', () => {
  test('public 上只开三张租户表，不多开', () => {
    const publicTableGrants = authGrants.filter(
      (statement) =>
        statement.startsWith('GRANT') && statement.includes('ON public.')
    );

    expect(publicTableGrants).toHaveLength(TENANT_TABLES.length);
    for (const table of TENANT_TABLES) {
      expect(
        publicTableGrants.some((statement) =>
          statement.includes(`public.${table} `)
        )
      ).toBe(true);
    }
  });

  test('auth 全表读写、app 函数 EXECUTE、不授 auth 表给业务角色以外的范围', () => {
    expect(authGrants).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO auth_service'
    );
    expect(authGrants).toContain(
      'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO auth_service'
    );
  });

  test('默认权限只保留 auth 一条，且不做对称的 REVOKE', () => {
    const defaults = authGrants.filter((statement) =>
      statement.startsWith('ALTER DEFAULT PRIVILEGES')
    );

    // public / app 从未给 auth_service 设过 DEFAULT ACL，补 REVOKE 属于乱加。
    expect(defaults).toEqual([
      'ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_service',
    ]);
  });
});

describe('G5 脚本真的用的就是这张表', () => {
  test('provision-roles.mjs 从 lib 引入，而不是就地再维护一份', () => {
    expect(script).toContain("from './lib/auth-grants.mjs'");
    expect(script).not.toContain('const authGrants = [');
    expect(script).toContain('for (const statement of authGrants)');
  });
});
