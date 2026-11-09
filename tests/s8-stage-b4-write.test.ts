/**
 * S8 阶段 B · B4 收口：组织 / 成员写入改走 `app.*` SECURITY DEFINER 函数。
 *
 * T28 拆掉 Better Auth organization 插件后，改名 / 归档 / 移除成员 / 改角色
 * 一度用 `withOrg`（SET LOCAL ROLE app_rw）直写 organization /
 * organization_member。测试库复刻的旧权限矩阵里 `app_rw` 对这两张表只有
 * SELECT，于是 42501 被 mapAuthError 压成「操作失败，请稍后重试。」——
 * better-auth 集成测试里 5 条组织生命周期用例全红。
 *
 * 修法取实施计划 §4.2 登记的第二条：与 `app.create_organization` 同族的
 * SECURITY DEFINER 写入函数，以属主身份落库，认证 / 角色 / last-owner 守卫
 * 放进函数体。它与 T32「运行期角色统一 genealogy_app」相互独立，重排运行期
 * 角色时不需要返工。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function functionBody(ddl: string, name: string): string {
  const start = ddl.indexOf(`CREATE OR REPLACE FUNCTION app.${name}(`);
  if (start < 0) throw new Error(`找不到函数 app.${name}`);
  const next = ddl.indexOf('\nCREATE ', start + 1);
  return ddl.slice(start, next < 0 ? undefined : next);
}

const WRITE_FUNCS = [
  'rename_organization',
  'archive_organization',
  'remove_org_member',
  'set_org_member_role',
] as const;

describe('S8 阶段 B · B4 组织写入 SECDEF 收口', () => {
  test('B4W-1：基线里四个写入函数齐全，且都是 SECURITY DEFINER + pg_temp 置末', () => {
    const ddl = read('lib/db/migrations/0000_target_schema.sql');
    for (const name of WRITE_FUNCS) {
      expect(ddl, name).toMatch(
        new RegExp(
          `CREATE OR REPLACE FUNCTION app\\.${name}\\([\\s\\S]{0,260}?SECURITY DEFINER[\\s\\S]{0,160}?SET search_path = pg_catalog, public, pg_temp`
        )
      );
    }
  });

  test('B4W-2：四个函数都做认证守卫与成员角色守卫（不是裸 UPDATE/DELETE）', () => {
    const ddl = read('lib/db/migrations/0000_target_schema.sql');
    for (const name of WRITE_FUNCS) {
      const body = functionBody(ddl, name);
      expect(body, name).toContain('app.current_user_id()');
      expect(body, name).toContain('public.organization_member');
      expect(body, name).toContain('42501');
    }
  });

  test('B4W-3：成员写函数额外守住「不能动 owner」这条写路径契约', () => {
    const ddl = read('lib/db/migrations/0000_target_schema.sql');
    for (const name of ['remove_org_member', 'set_org_member_role']) {
      const body = functionBody(ddl, name);
      expect(body, name).toContain("'owner'");
      expect(body, name).toMatch(/最后一个所有者|不能修改所有者|不能移除/);
    }
  });

  test('B4W-4：四个函数都 GRANT EXECUTE 给 genealogy_app', () => {
    const ddl = read('lib/db/migrations/0000_target_schema.sql');
    for (const name of WRITE_FUNCS) {
      expect(ddl, name).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION app\\.${name}\\([^)]*\\) TO genealogy_app`
        )
      );
    }
  });

  test('B4W-5：org/actions.ts 四个动作不再直写组织/成员表', () => {
    const src = stripComments(read('lib/org/actions.ts'));
    expect(src).not.toMatch(/\.update\(organizations\)/);
    expect(src).not.toMatch(/\.delete\(orgMembers\)/);
    expect(src).not.toMatch(/\.update\(orgMembers\)/);
    for (const name of WRITE_FUNCS) {
      expect(src, name).toContain(`app.${name}(`);
    }
  });

  test('B4W-6：调用仍在 withOrg 事务内（SET LOCAL 边界不破）', () => {
    const src = stripComments(read('lib/org/actions.ts'));
    expect((src.match(/withOrg\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    for (const name of WRITE_FUNCS) {
      const at = src.indexOf(`app.${name}(`);
      const open = src.lastIndexOf('withOrg(', at);
      expect(open, name).toBeGreaterThan(-1);
      // 函数调用到最近的 withOrg 之间不应跨越另一个 action 的定义。
      const between = src.slice(open, at);
      expect(between, name).not.toContain('validatedActionWithUser(');
    }
  });
});
