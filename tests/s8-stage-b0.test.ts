/**
 * S8 阶段 B · B0：迁移基线整体重建门禁（G0 ① 已拍板）。
 *
 * DDL 唯一真相源是附录 A 全量归档（`/workspace/gramps-S8-目标DDL.sql`），
 * 按 A.0→A.6 顺序拼接、跳过 A.7 参数化样例。本文件按 TDD 先于 B0 改动
 * 写出（RED），阶段 B 范围修订见实施计划 §4「B0 前置」。
 *
 * 断言一律读文件系统、不 import 待改模块：让 RED 表现为「断言失败」而不是
 * 「编译失败」，才能精确指出哪一条规格没兑现。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const migrationsDir = join(root, 'lib/db/migrations');
const metaDir = join(migrationsDir, 'meta');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const exists = (path: string) => existsSync(join(root, path));
const sqlFiles = () =>
  readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
// 文件尚未生成时返回空串：让 RED 表现为断言失败，而不是 ENOENT 运行时错误。
const baseline = () =>
  existsSync(join(migrationsDir, '0000_target_schema.sql'))
    ? read('lib/db/migrations/0000_target_schema.sql')
    : '';

describe('S8 阶段 B · B0 迁移基线整体重建', () => {
  test('B0-1：只剩唯一基线 0000_target_schema.sql', () => {
    expect(sqlFiles()).toEqual(['0000_target_schema.sql']);
  });

  test('B0-2：journal 重置为 1 条，tag 与 idx 对齐', () => {
    const journal = JSON.parse(read('lib/db/migrations/meta/_journal.json'));
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0]).toMatchObject({
      idx: 0,
      tag: '0000_target_schema',
      breakpoints: true,
    });
  });

  test('B0-3：旧 snapshot 不残留（T39 生成新 snapshot 后仍成立）', () => {
    // 旧基线有 19 份按旧迁移编号命名的 snapshot。B0 当下为 0 份；T39 用
    // pnpm db:generate 对齐 schema TS 时会生成唯一基线对应的 1 份，所以门禁
    // 按可持续口径写成「最多 1 份」，而不是固化「meta 只剩 journal」。
    const snapshots = readdirSync(metaDir).filter((name) =>
      /^\d{4}_.*_snapshot\.json$/.test(name)
    );
    expect(snapshots.length).toBeLessThanOrEqual(1);
  });

  test('B0-4：28 个旧迁移的代表文件已删除', () => {
    const legacy = [
      '0000_baseline.sql',
      '0001_auth_rls.sql',
      '0002_app_role_grant.sql',
      '0003_better_auth.sql',
      '0026_catalog_book_composite_fk.sql',
      '0027_yummy_captain_cross.sql',
    ];
    expect(
      legacy.filter((name) => existsSync(join(migrationsDir, name)))
    ).toEqual([]);
  });

  test('B0-5：基线无过渡语句、无 A.7 参数化样例', () => {
    const source = baseline();
    expect(source.length).toBeGreaterThan(1000);
    expect(source).not.toMatch(/DROP\s+TABLE/i);
    expect(source).not.toMatch(
      /ALTER\s+TABLE[\s\S]{0,80}(ADD|DROP)\s+(COLUMN|CONSTRAINT)/i
    );
    expect(source).not.toMatch(/TRUNCATE/i);
    expect(source).not.toMatch(/\$1\b/);
  });

  test('B0-6：A.0–A.5 的表与扩展齐备（21 条建表语句）', () => {
    const source = baseline();
    // 附录 A.0 有一条注释也含 "CREATE TABLE"，过滤注释行后才是真实语句数：
    // 17 张 public 表 + auth 四表（user / session / account / verification）。
    // 后三张是 Better Auth 运行期表，附录 A 之外、按规格决议 ② 由 Better Auth
    // 管理 DDL，但基线必须建出来——缺任一张，登录 / 会话 / 成员管理整条链路
    // 都会报 `relation "auth.session" does not exist`。与 PG18 落库实测一致。
    const statements = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect((statements.match(/CREATE\s+TABLE/gi) ?? []).length).toBe(21);
    expect(source).toContain('CREATE EXTENSION IF NOT EXISTS ltree');
    expect(source).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist');
    expect(source).toContain('CREATE SCHEMA IF NOT EXISTS app');
    expect(source).toContain('CREATE DOMAIN member_role_t');
    expect(source).toContain('CREATE TABLE book_export');
  });

  test('B0-7：A.6 四个隔离函数落地（另有 A.6.1 的租户守卫）', () => {
    const source = baseline();
    // `OR REPLACE` 是为了让 `pnpm test:integration` 的 resetAndMigrate（每次都
    // drop schema 后重跑）与 `psql -f` 两条路径都能重复执行；不带它时第二次
    // 建函数报 42723。
    //
    // 附录 A.6 是四个函数；A.6.1 的 `app.forbid_tenant_move()` 是 B0b 按规格
    // §5.3 例外表补的第五个。这里改成「至少 4 个 + 逐个在册」，不再写死总数：
    // 后续批次（T25 的路径辅助等）还会加 `app.*` 函数，写死总数会持续误伤。
    expect(
      (source.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+app\./gi) ?? [])
        .length
    ).toBeGreaterThanOrEqual(4);
    for (const fn of [
      'current_user_id',
      'visible_org_array',
      'create_organization',
      'accept_invite',
      'forbid_tenant_move',
    ]) {
      expect(source).toContain(`app.${fn}(`);
    }
  });

  test('B0-8：InitPlan 谓词与 SECDEF pg_temp 两条硬口径', () => {
    const source = baseline();
    expect(source).toContain(
      "coalesce((SELECT app.visible_org_array()), '{}'::uuid[])"
    );
    expect(
      (source.match(/SET search_path[^\n]*pg_temp/gi) ?? []).length
    ).toBeGreaterThanOrEqual(3);
  });

  test('B0-9：A.0→A.6 顺序落地，A.7 不进基线', () => {
    const source = baseline();
    const marks = [
      '[A.0]',
      '[A.1]',
      '[A.2]',
      '[A.3]',
      '[A.4]',
      '[A.5]',
      '[A.6]',
    ];
    const positions = marks.map((mark) => source.indexOf(mark));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(source).not.toContain('[A.7]');
  });

  test('B0-10：旧迁移验收集成测试随基线退役', () => {
    expect(exists('tests/integration/migrations.test.ts')).toBe(false);
    expect(exists('tests/integration/auth-migration.test.ts')).toBe(false);
  });

  test('B0-11：§8 已随 T47 整节删除，谱系层差异的留档改在 CHANGELOG', () => {
    // 差异清单是「待改对象」，T47 之后不再保留第二份现状描述；
    // 逐条消掉的记录看 CHANGELOG 的 S8 段落。
    expect(read('docs/data-model.md')).not.toContain('## 8. 重构前的实现差异');
    expect(read('CHANGELOG.md')).toContain('S8');
  });

  test('B0-12：verify-deployment 仍动态比对 journal，不硬编码 28', () => {
    const source = read('scripts/verify-deployment.mjs');
    expect(source).toContain('journal.entries.length');
    expect(source).not.toContain('=== 28');
  });
});
