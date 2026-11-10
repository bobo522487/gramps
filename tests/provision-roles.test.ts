import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  ensureRole,
  type RoleAttributes,
  type RoleSql,
  roleFixups,
} from '../scripts/lib/role-provisioning.mjs';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
/** 只保留可执行代码：注释里解释「为什么不用 rolowner」不算回归。 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const script = stripComments(read('scripts/provision-roles.mjs'));
const provisioning = stripComments(read('scripts/lib/role-provisioning.mjs'));

/** 属性已经合规的角色。 */
const compliant = (login: boolean): RoleAttributes => ({
  rolcanlogin: login,
  rolsuper: false,
  rolbypassrls: false,
});

/**
 * 假的 `postgres` 连接：`sql\`…\`` 直接返回给定角色行，`unsafe` 只记录语句。
 * 有了注入点，就能断言「脚本到底发了哪些 ALTER」，而不是拿正则去 grep 源码。
 */
function fakeSql(statements: string[], row: RoleAttributes | null): RoleSql {
  const sql = (async () => (row ? [row] : [])) as unknown as RoleSql;
  sql.unsafe = async (statement: string) => {
    statements.push(statement);
    return [];
  };
  return sql;
}

const ROLES = [
  ['genealogy_app', true],
  ['auth_runtime', true],
  ['auth_service', false],
] as const;

/**
 * 2026-11-09 的漏网之鱼：`AUTH_DB_PASSWORD ?? 'auth'` 让「没配口令」和
 * 「配了口令叫 auth」变成同一件事，缺变量的机器会把 auth_runtime（读得到
 * auth.user 的密码哈希与会话 token）静默改成 4 字符口令。以下用例把
 * 「没给口令就绝不发 ALTER」做成行为断言。
 */
describe('P8 口令缺失时不得发出任何改口令的 ALTER', () => {
  for (const [name, login] of ROLES) {
    test(`${name}：password 为 null 时一条语句都不发，并说明未改口令`, async () => {
      const statements: string[] = [];
      const result = await ensureRole(
        fakeSql(statements, compliant(login)),
        name,
        {
          login,
          password: null,
        }
      );

      expect(statements).toEqual([]);
      expect(result.canSetPassword).toBe(false);
      expect(result.status).toContain('未提供口令');
    });

    test(`${name}：空串等同于没给口令（workflow 缺 secret 时就是空串）`, async () => {
      const statements: string[] = [];
      const result = await ensureRole(
        fakeSql(statements, compliant(login)),
        name,
        {
          login,
          password: '',
        }
      );

      expect(statements).toEqual([]);
      expect(result.status).toContain('未提供口令');
    });
  }
});

describe('P9 认证角色与 genealogy_app 同一口径', () => {
  test('同一组输入下，两个角色的语句与结论完全一致', async () => {
    const run = async (name: string) => {
      const statements: string[] = [];
      const result = await ensureRole(
        fakeSql(statements, compliant(true)),
        name,
        { login: true, password: null }
      );
      return { statements, status: result.status };
    };

    const app = await run('genealogy_app');
    const runtime = await run('auth_runtime');

    expect(runtime.statements).toEqual(app.statements);
    expect(runtime.status).toBe(app.status);
  });

  test('脚本不给认证角色任何默认口令', () => {
    // 兜底值一加回来，缺变量的机器就会静默改弱口令——这是本次修复的核心。
    // 允许 `?? ''`（视为「没给口令」，走跳过分支），但绝不允许落到一个真口令。
    expect(script).not.toMatch(/AUTH_DB_PASSWORD\s*\?\?\s*'[^']+'/);
    expect(script).toContain('password: runtimePassword || null');
    expect(script).toContain('AUTH_DB_PASSWORD 未设置，未改口令');
  });
});

describe('P10 给了口令才 ALTER，且只改口令', () => {
  test('属性已合规时不发属性语句，只发一条 password 语句', async () => {
    const statements: string[] = [];
    const result = await ensureRole(
      fakeSql(statements, compliant(true)),
      'auth_runtime',
      { login: true, password: "S3cret-'x" }
    );

    // 单引号走 literal() 转义，断言顺带覆盖口令里的引号。
    expect(statements).toEqual([
      `alter role "auth_runtime" password 'S3cret-''x'`,
    ]);
    expect(result.canSetPassword).toBe(true);
  });

  test('属性不合规时先改属性，再改口令', async () => {
    const statements: string[] = [];
    await ensureRole(
      fakeSql(statements, {
        rolcanlogin: false,
        rolsuper: true,
        rolbypassrls: false,
      }),
      'genealogy_app',
      { login: true, password: 'pw' }
    );

    expect(statements).toEqual([
      'alter role "genealogy_app" login nosuperuser',
      `alter role "genealogy_app" password 'pw'`,
    ]);
  });
});

describe('P11 改不动时不假装成功', () => {
  const denied = () => {
    const sql = fakeSql([], compliant(false));
    sql.unsafe = async () => {
      throw Object.assign(new Error('permission denied to alter role'), {
        code: '42501',
      });
    };
    return sql;
  };

  test('属性不合规且改不动：报出 SQLSTATE，且不谎称口令已改', async () => {
    const result = await ensureRole(denied(), 'genealogy_app', {
      login: true,
      password: 'pw',
    });

    expect(result.canSetPassword).toBe(false);
    expect(result.status).toContain('属性不合规且改不动');
    expect(result.status).toContain('42501');
  });

  test('属性已合规但口令改不动：如实报未更新', async () => {
    const result = await ensureRole(denied(), 'auth_runtime', {
      login: false,
      password: 'pw',
    });

    expect(result.canSetPassword).toBe(false);
    expect(result.status).toContain('口令改不动');
  });
});

describe('P1–P5 既有闸门（源码守卫）', () => {
  test('P1 先读角色属性再决定改什么，不依赖 PG 不存在的「角色属主」概念', () => {
    expect(provisioning).toContain('export async function describeRole');
    expect(provisioning).toContain('export function roleFixups');
    expect(provisioning).toMatch(/select rolcanlogin, rolsuper, rolbypassrls/);
    // `pg_roles` 里没有 rolowner 列——写过一次就是 42703，且只有跑起来才发现。
    expect(provisioning).not.toContain('rolowner');
  });

  test('P2 roleFixups 只收需要改的项', () => {
    expect(roleFixups(compliant(true), { login: true })).toEqual([]);
    expect(roleFixups(compliant(false), { login: true })).toEqual(['login']);
    expect(
      roleFixups(
        { rolcanlogin: true, rolsuper: true, rolbypassrls: true },
        {
          login: true,
        }
      )
    ).toEqual(['nosuperuser', 'nobypassrls']);
  });

  test('P3 genealogy_app 口令改不动时必须失败，不跳过', () => {
    expect(script).toContain('if (appPassword && !app.canSetPassword)');
    expect(script).toContain('拒绝继续：genealogy_app 的口令无法更新');
  });

  test('P4 42501 给的是权限方向的指引，不是裸 SQLSTATE', () => {
    expect(script).toContain('42501 是权限问题');
  });

  test('P5 迁移诊断脚本必须回滚，不能真改生产库', () => {
    expect(read('scripts/diagnose-migration.mjs')).toContain('__rollback__');
  });

  test('P6 workflow 对两个口令 secret 都有前置校验', () => {
    const workflow = read('.github/workflows/migrate-production.yml');
    expect(workflow).toContain(
      'APP_DB_PASSWORD secret is missing; genealogy_app cannot be provisioned.'
    );
    expect(workflow).toContain(
      'AUTH_DB_PASSWORD secret is missing; auth_runtime cannot be provisioned.'
    );
    // 校验必须早于真正动库的步骤，否则「静默跳过改口令」的路径又回来了。
    expect(
      workflow.indexOf('Refuse to run without the auth DB password')
    ).toBeLessThan(workflow.indexOf('pnpm db:provision-roles'));
  });
});
