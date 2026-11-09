import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
/** 只保留可执行代码：注释里解释「为什么不用 rolowner」不算回归。 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 角色 provisioning 的权限闸门。
 *
 * 2026-11-09 生产重建第二次红：`genealogy_app` 建出来了，紧接着
 * `alter role auth_service …` 报 `42501 permission denied to alter role`。
 * 原因是托管库上迁移连接既不是那三个角色的成员、也没有 CREATEROLE。
 * 本地 PG 用超级用户连接，永远复现不出来。
 *
 * 本组断言守两件事：改不动就别硬 alter（给出可诊断的理由）、
 * 以及 `genealogy_app` 口令改不动时必须**失败**而不是跳过。
 */
describe('P1–P3 角色 provisioning 的权限闸门', () => {
  const script = stripComments(read('scripts/provision-roles.mjs'));

  test('P1 改角色前先判断权限，且不依赖 PG 不存在的「角色属主」概念', () => {
    expect(script).toContain('async function canAlter');
    // ALTER ROLE 的真实判定依据：超级用户 / CREATEROLE / 是该角色成员。
    expect(script).toMatch(/pg_has_role\(current_user, \$\{name\}, 'MEMBER'\)/);
    expect(script).toContain('rolcreaterole');
    // `pg_roles` 里没有 rolowner 列——写过一次就是 42703，且只有跑起来才发现。
    expect(script).not.toContain('rolowner');
  });

  test('P2 改不动时返回可读理由，不抛原始 SQLSTATE', () => {
    expect(script).toMatch(/if \(!gate\.ok\)/);
    expect(script).toContain('无权改');
  });

  test('P3 genealogy_app 口令改不动必须失败：否则应用侧连接全线 28P01', () => {
    // 应用侧 `APP_POSTGRES_URL` 与这里用的是同一份 secret，库里的口令
    // 更新不了就永远不一致，而且只在运行时暴露。
    expect(script).toContain('拒绝继续：genealogy_app 的口令无法更新');
    expect(script).toMatch(
      /拒绝继续：genealogy_app 的口令无法更新[\s\S]{0,120}process\.exit\(1\)/
    );
  });

  test('P4 42501 时给出可执行的处置指引，而不是让值班去猜', () => {
    expect(script).toContain("code === '42501'");
    expect(script).toContain('diagnose-drizzle-state.mjs');
    expect(script).toMatch(/ADMIN OPTION/);
  });
});

describe('P5 诊断脚本能回答「这个角色改不改得动」', () => {
  const script = stripComments(read('scripts/diagnose-drizzle-state.mjs'));

  test('P5 逐角色打印可否 ALTER，且不查不存在的列', () => {
    expect(script).toContain('→ ALTER');
    expect(script).toContain('pg_has_role(current_user');
    expect(script).toContain('rolcreaterole');
    expect(script).not.toContain('rolowner');
  });
});
