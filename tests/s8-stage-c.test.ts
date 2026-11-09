/**
 * S8 阶段 C · 隔离层静态核对门禁（T29 / T30 / T31 / T33，兼记 T32 基线侧状态）。
 *
 * 阶段 C 按 G0 ① 的定位是「核对 / 断言 / 应用侧跟改」：A.6 的 SQL 已在 B0
 * 一次性落进唯一基线，这里不再重写 DDL，只把目标态形状钉死，防止后续批次
 * （尤其 T32 运行期角色重排、T34 CI 角色预置）把 InitPlan 谓词、SECDEF 的
 * `pg_temp` 防阴影或 `SET LOCAL` 事务边界改坏。
 *
 * 注意两处与旧规格的偏差，都是基线演进的结果，不是缺陷：
 * - 旧 T29 验证写「grep -c CREATE FUNCTION app. === 4」，但 B0 把组织状态 /
 *   邀请预览 / 租户键触发器，B4 又把 4 个组织写入 writer 都放进了同一基线，
 *   现在是 12 个函数；这里改断言下界。
 * - 旧 T30 验证写「grep -c coalesce((SELECT ...) >= 1」，实际是 `DO $$ FOREACH`
 *   循环里 1 个 `$p$` 模板批量生成 16 张表的策略；计数 1 不代表只覆盖一张表。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const DDL = 'lib/db/migrations/0000_target_schema.sql';

function stripSqlComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

function stripTsComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

const CORE_FUNCS = [
  'current_user_id',
  'visible_org_array',
  'create_organization',
  'accept_invite',
] as const;

const RLS_TABLES = [
  'organization_member',
  'invite',
  'project',
  'folder',
  'person',
  'person_name',
  'family',
  'family_partner',
  'family_child',
  'event',
  'lineage',
  'node',
  'article',
  'book',
  'book_catalog',
  'book_export',
];

describe('S8 阶段 C · 隔离层核对', () => {
  test('C-1 T29：四个核心隔离函数齐全，current_user_id 不授予应用角色', () => {
    const ddl = read(DDL);
    for (const name of CORE_FUNCS) {
      expect(ddl, name).toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION app\\.${name}\\(`)
      );
    }
    expect(
      (ddl.match(/CREATE OR REPLACE FUNCTION app\./g) ?? []).length
    ).toBeGreaterThanOrEqual(12);
    // fail-closed：认证函数只能被 SECDEF 函数体内部调用，不能直接给应用角色。
    expect(ddl).not.toMatch(
      /GRANT EXECUTE ON FUNCTION app\.current_user_id\(\)/
    );
    for (const name of CORE_FUNCS.slice(1)) {
      expect(ddl, name).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION app\\.${name}\\([^)]*\\) TO genealogy_app;`
        )
      );
    }
  });

  test('C-2 T30：RLS 谓词是 InitPlan 模板，且批量覆盖全部租户表', () => {
    const ddl = read(DDL);
    expect(ddl).toContain(
      "$p$organization_id = ANY (coalesce((SELECT app.visible_org_array()), '{}'::uuid[]))$p$"
    );
    expect(ddl).toContain('FOREACH t IN ARRAY');
    expect(ddl).toContain("replace(p, 'organization_id', 'id')");
    for (const table of RLS_TABLES) {
      expect(ddl, table).toContain(`'${table}'`);
    }
    // 两类反例：裸 ANY(...) 会让 STABLE 函数逐行调用；IN (SELECT setof) 变成
    // hashed SubPlan 并带出外部归并排序。
    expect(ddl).not.toMatch(/=\s*ANY \(app\.visible_org_array\(\)\)/);
    expect(ddl).not.toMatch(/IN \(SELECT app\.visible_org_array\(\)\)/);
  });

  test('C-3 T31：所有 SECDEF 函数把 pg_temp 放在 search_path 末尾', () => {
    const ddl = read(DDL);
    const paths = ddl.match(/SET search_path = [^\n]+/g) ?? [];
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const path of paths) {
      expect(path).toMatch(/pg_temp AS \$\$$/);
    }
    // 含 auth schema 的那个（accept_invite）也必须把 pg_temp 置末。
    expect(ddl).toContain(
      'SET search_path = pg_catalog, public, auth, pg_temp AS $$'
    );
    // 只置末还不够：函数体内关系名必须 schema-qualified，否则 public 的
    // CREATE 权限仍可被 pg_temp 同名对象阴影。
    expect(ddl).not.toMatch(/\bFROM invite\b/);
    expect(ddl).not.toContain('v_inv invite%ROWTYPE');
  });

  test('C-4 T33：withOrg 在同一事务内注入 app.user_id，旧 GUC 已退役', () => {
    const drizzle = read('lib/db/drizzle.ts');
    const transactionBody = drizzle.slice(
      drizzle.indexOf('getDb().transaction')
    );
    expect(transactionBody).toMatch(
      /set local role[\s\S]{0,200}set_config\('app\.user_id', \$\{userId\}, true\)/
    );
    // 认证连接在执行任何查询前把角色钉死。
    expect(read('lib/db/auth-db.ts')).toContain('-c role=');
    // 只看可执行代码：说明文字里提到旧 GUC 名字不算回归。
    expect(
      stripTsComments(read('tests/integration/with-org-write.test.ts'))
    ).not.toContain('request.jwt.claims');
  });

  test('C-5 T32 基线侧：只建 genealogy_app，不启用 FORCE RLS / 旧角色', () => {
    const ddl = stripSqlComments(read(DDL));
    expect(ddl).toContain('CREATE ROLE genealogy_app');
    expect(ddl).not.toContain('FORCE ROW LEVEL SECURITY');
    expect(ddl).not.toMatch(/CREATE ROLE (app_rw|auth_service)\b/);
    expect(ddl).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO genealogy_app'
    );
  });

  test('C-6 T35：写通道图登记库内 SECDEF 写入口（6 个 app.* 函数）', () => {
    // T28 拆掉 organization 插件 + B4 收口后，组织 / 成员写不再直写表，
    // 而是 Server Action 在 withOrg 事务内调库内 SECURITY DEFINER 函数。
    // 接口地图若只写「写只走 Server Action」就漏了这一层，读图的人会以为
    // 存在直写 organization / organization_member 的合法通道。
    const doc = read('docs/interfaces.md');
    expect(doc).toContain('SECURITY DEFINER');
    expect(doc).toContain('withOrg');
    for (const fn of [
      'app.create_organization',
      'app.accept_invite',
      'app.rename_organization',
      'app.archive_organization',
      'app.remove_org_member',
      'app.set_org_member_role',
    ]) {
      expect(doc, fn).toContain(fn);
    }
    // 说明这层不是绕过 Server Action，且 RLS 只做可见性、不做写授权。
    expect(doc).toContain('不是绕过 Server Action');
    expect(doc).toMatch(/RLS[^\n]{0,80}可见性/);
  });
});
