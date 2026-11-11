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
      // 本次没要求改口令 → 不能算作「口令改不动」而致命。
      expect(result.canSetPassword).toBe(true);
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

describe('P11 生产 app 角色可进入 genealogy_app', () => {
  test('只在 app 与 genealogy_app 都存在时授予成员资格', () => {
    // 生产 APP_POSTGRES_URL 以 Neon 托管的 `app` 登录，而 withOrg() 会
    // `SET LOCAL ROLE genealogy_app`；缺这条授权时组织页统一 42501。
    expect(script).toContain("rolname = 'app'");
    expect(script).toContain("rolname = 'genealogy_app'");
    expect(script).toContain('GRANT genealogy_app TO app');
  });
});

describe('P10 给了口令才 ALTER，且口令是 SCRAM verifier 而非明文', () => {
  test('属性已合规时不发属性语句，只发一条 SCRAM password 语句', async () => {
    const statements: string[] = [];
    const result = await ensureRole(
      fakeSql(statements, compliant(true)),
      'auth_runtime',
      { login: true, password: "S3cret-'x" }
    );

    // SQL 文本里出现的是 base64 的 verifier，绝不含明文或明文里的引号。
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(
      /^alter role "auth_runtime" password 'SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*'$/
    );
    expect(statements[0]).not.toContain("S3cret-'x");
    expect(statements[0]).not.toContain("''");
    expect(result.canSetPassword).toBe(true);
    expect(result.attributesCompliant).toBe(true);
  });

  test('同一口令两次生成的 verifier 不同（salt 随机），但都可被服务端接受', async () => {
    const statements: string[] = [];
    await ensureRole(fakeSql(statements, compliant(true)), 'auth_runtime', {
      login: true,
      password: 'pw',
    });
    const first = statements[0];
    statements.length = 0;
    await ensureRole(fakeSql(statements, compliant(true)), 'auth_runtime', {
      login: true,
      password: 'pw',
    });
    expect(statements[0]).not.toBe(first);
  });

  test('属性不合规时先改属性，再改口令（口令仍是 verifier）', async () => {
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

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe('alter role "genealogy_app" login nosuperuser');
    expect(statements[1]).toMatch(
      /^alter role "genealogy_app" password 'SCRAM-SHA-256\$/
    );
  });
});

describe('S1 属性改不动不阻止口令更新，两个结果各自独立', () => {
  /** 属性 ALTER 全拒、口令 ALTER 放行——Neon 实测就是这个边界。 */
  function attributeDeniedPasswordAllowed(statements: string[]): RoleSql {
    const sql = fakeSql(statements, {
      rolcanlogin: false,
      rolsuper: true,
      rolbypassrls: true,
    });
    sql.unsafe = async (statement: string) => {
      statements.push(statement);
      if (!statement.includes('password')) {
        throw Object.assign(new Error('permission denied to alter role'), {
          code: '42501',
        });
      }
      return [];
    };
    return sql;
  }

  test('属性 42501 但口令能改：仍发出 password 语句，canSetPassword=true', async () => {
    const statements: string[] = [];
    const result = await ensureRole(
      attributeDeniedPasswordAllowed(statements),
      'genealogy_app',
      { login: true, password: 'pw' }
    );

    // 旧实现在属性失败时 return，这里会漏掉 password 且被判致命。
    expect(statements.some((statement) => statement.includes('password'))).toBe(
      true
    );
    expect(result.canSetPassword).toBe(true);
    expect(result.attributesCompliant).toBe(false);
    expect(result.status).toContain('属性不合规且改不动');
    expect(result.status).toContain('42501');
    expect(result.status).toContain('口令已更新');
  });

  test('属性 42501 且未给口令：不致命，但如实报告属性不合规', async () => {
    const statements: string[] = [];
    const result = await ensureRole(
      attributeDeniedPasswordAllowed(statements),
      'auth_runtime',
      { login: true, password: null }
    );

    expect(result.canSetPassword).toBe(true);
    expect(result.attributesCompliant).toBe(false);
    expect(result.status).toContain('未提供口令');
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
