/**
 * S8 阶段 B · B2a：边界层与内容层主键归位、软删 / 时间戳清理、删除语义收紧。
 *
 * 规格唯一真相源是附录 A.1（`organization` / `organization_member` / `invite`）
 * 与 A.5（`article` / `book`），归档于 `gramps-S8-目标DDL.sql`。批次划分见
 * 实施计划 §4「阶段 B 批次划分与规格决议」的 B2a。
 *
 * `activity_logs` 已按拍板提前到 B2a 整表退役（原计划归 B2c），见 B2a-9。
 * `book_catalog` 的 `path ltree` / `project_id` 已由 B3 / T25 完成，本文件对它
 * 只保留「软删列不回潮」的反向保护断言；正向断言在 s8-stage-b3。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const exists = (path: string) => existsSync(join(root, path));
const schema = (name: string) => read(`lib/db/schema/${name}.ts`);

/**
 * 从 `pgTable('table'` / `schema.table('table'` 切到下一张表的起点。
 *
 * 必须锚定建表调用的形态（`pgTable('x'` / `.table('x'`），不能只找首个带引号
 * 的表名：`content.ts` 的注释里就出现过 `'book'`，裸 indexOf 会从注释处截断，
 * 后续断言变成在空串上跑，永远通过。
 */
function block(source: string, table: string, next?: string) {
  const start = findTableStart(source, table);
  if (start < 0) throw new Error(`找不到 pgTable('${table}'`);
  const end = next ? findTableStart(source, next, start + 1) : -1;
  return source.slice(start, end < 0 ? undefined : end);
}

function findTableStart(source: string, table: string, from = 0): number {
  // `pgTable(` 与表名之间可以换行（`content.ts` 就是多行写法），所以用正则而不是
  // 裸 indexOf。锚定建表调用的形态，注释里出现表名（如 `'book'`）不会被误判。
  const pattern = new RegExp(`(?:pgTable|\\.table)\\(\\s*'${table}'`);
  const rest = source.slice(from);
  const match = pattern.exec(rest);
  return match ? from + match.index : -1;
}

/** 去掉行注释与块注释，供「不许出现某字符串」这类断言使用。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

describe('S8 阶段 B · B2a 边界层与内容层归位', () => {
  test('B2a-1：article / book 改 (project_id,id) 复合主键，且无软删 / 时间戳', () => {
    const content = schema('content');
    const article = block(content, 'article', 'book');
    expect(article).toContain('scopedUuid()');
    expect(article).toContain('primaryKey({ columns: [t.projectId, t.id] })');
    expect(article).not.toContain('uuidPk()');
    expect(article).not.toContain("timestamptz('deleted_at')");
    expect(article).not.toContain("timestamptz('updated_at')");

    const book = block(content, 'book', 'book_catalog');
    expect(book).toContain('scopedUuid()');
    expect(book).toContain('primaryKey({ columns: [t.projectId, t.id] })');
    expect(book).not.toContain('uuidPk()');
    expect(book).not.toContain("timestamptz('deleted_at')");
    expect(book).not.toContain("timestamptz('updated_at')");
  });

  test('B2a-2：organization_member 本批保留代理主键 id（待 B4 / T28）', () => {
    // 附录 A.1 的目标态是 (organization_id, user_id) 复合主键、无代理主键。
    // 但 Better Auth 的 organization 插件直接读 `member.id`，缺列时 `createAuth()`
    // 一初始化就报 `Drizzle schema mismatch — Missing columns: member.id`，
    // 232 条集成测试全红。去插件（T28）与去主键是同一个约束的两面，所以整体
    // 并入 B4。这里做反向保护：谁在本批偷偷删掉 `id`，必须先过这一关。
    const member = block(schema('org'), 'organization_member', 'invite');
    expect(member).toContain('id: uuidPk()');
    // 复合唯一约束保留，它是未来的目标主键，也是去重语义的唯一保障。
    expect(member).toContain(
      "unique('uk_org_member_organization_user').on(t.organizationId, t.userId)"
    );
    expect(member).not.toContain('primaryKey({');
  });

  test('B2a-3：invite 改 (organization_id,id) 复合主键', () => {
    const invite = block(schema('org'), 'invite');
    expect(invite).toContain('scopedUuid()');
    expect(invite).toContain(
      'primaryKey({ columns: [t.organizationId, t.id] })'
    );
    expect(invite).not.toContain('uuidPk()');
  });

  test('B2a-4：org.ts 删除语义按附录 A.1 逐条对齐，无 cascade 到 organization', () => {
    // 计数前先剥注释：解释来龙去脉的注释里会写到 `onDelete: 'cascade'` 这类
    // 字样，裸计数会被自己的注释误伤（本批已踩过两次）。
    const source = stripComments(schema('org'));
    // 指向 organization 的两条 FK 一律 RESTRICT（删组织不许带走成员/邀请）；
    // 指向 auth.user 的成员行必须 CASCADE（销号要能连带删成员）。
    //
    // B2b 已按预期把 `invite.invited_by` 从 `NOT NULL + RESTRICT` 改成
    // `可空 + SET NULL`：邀请人注销后邀请行要留痕，而「谁邀请的谁不能注销」
    // 是把邀请记录当成了账号的附属物。所以 restrict 从 3 条降到 2 条，
    // 并新增 1 条 set null。
    expect(source.match(/onDelete: 'restrict'/g) ?? []).toHaveLength(2);
    expect(source.match(/onDelete: 'cascade'/g) ?? []).toHaveLength(1);
    expect(source.match(/onDelete: 'set null'/g) ?? []).toHaveLength(1);
    // 精确定位：cascade 那一条必须挂在 `users.id` 上，且属于 organization_member。
    const memberBlock = block(source, 'organization_member', 'invite');
    expect(memberBlock).toContain("users.id, { onDelete: 'cascade' }");
    // 反向保护：organization 的两条 FK 不许变成 cascade。
    const orgBlock = block(source, 'organization', 'organization_member');
    expect(orgBlock).not.toContain("onDelete: 'cascade'");
  });

  test('B2a-5：org / project 两份 schema 无软删与时间戳列', () => {
    for (const name of ['org', 'project']) {
      const source = schema(name);
      expect(source, name).not.toContain("timestamptz('deleted_at')");
      expect(source, name).not.toContain("timestamptz('updated_at')");
    }
  });

  test('B2a-6：查询层 4 份文件不再按软删过滤', () => {
    for (const name of ['organizations', 'projects', 'folders']) {
      expect(
        stripComments(read(`lib/db/queries/${name}.ts`)),
        name
      ).not.toContain('deletedAt');
    }
    // `article` 与 `book_catalog` 的软删列均已退役（后者随 B3 / T25），
    // 查询层不允许再有任何 `deletedAt` 引用。
    const raw = read('lib/db/queries/articles.ts');
    // 计数看代码（剥注释），别让注释里的词污染计数。
    const code = stripComments(raw);
    expect(code.match(/deletedAt/g) ?? []).toHaveLength(0);
    expect(code).not.toContain('bookCatalogs.deletedAt');
  });

  test('B2a-7：成员增删改一律按 member.id 传给 Better Auth', () => {
    // 前端成员表单传的是 `member.id`，成员表仍有代理主键（见 B2a-2），所以
    // findMember 必须按 `id` 查，且 removeMember / updateMemberRole 传给插件的
    // 也必须是 `member.id`——插件的 crud-members 走 `adapter.findMemberById()`，
    // 传 userId 只会 MEMBER_NOT_FOUND（uuid 列收到非 uuid 还可能 22P02）。
    const source = stripComments(read('lib/org/actions.ts'));
    expect(source).toContain('orgMembers.id');
    expect(source).toContain('memberIdOrEmail: member.id');
    expect(source).toContain('memberId: member.id');
    expect(source).not.toContain('memberIdOrEmail: member.userId');
    expect(source).not.toContain('memberId: member.userId');
  });

  test('B2a-8：auth.ts 的 updated_at 按决议 ② 保留（反向保护）', () => {
    expect(schema('auth')).toContain("timestamptz('updated_at')");
  });

  test('B2a-9：activity_logs 已整表退役，book_catalog 仍未动（保护断言）', () => {
    // 退役是 B2a 的一部分（原计划归 B2c）：B0 基线不建这张表，代码却仍在写，
    // 真实部署里登录 / 建组织 / 写谱文等 25 处会全部 500。既然附录 A 本来就没有
    // 它，整表删干净比在基线里补建更符合规格。
    expect(exists('lib/db/schema/activity.ts')).toBe(false);
    expect(exists('lib/db/queries/activity.ts')).toBe(false);
    expect(
      exists('app/(dashboard)/dashboard/(account)/activity/page.tsx')
    ).toBe(false);
    for (const name of [
      'article/services',
      'article/page-services',
      'folder/services',
      'lineage/services',
      'lineage/node-services',
      'project/services',
      'org/actions',
      'auth/actions/account',
      'auth/actions/session',
    ]) {
      expect(read(`lib/${name}.ts`), name).not.toMatch(/logActivity/);
    }
    expect(read('tests/helpers/db.ts')).not.toContain('activity_logs');
    // 反向保护：B3 / T25 已把 book_catalog 的软删列退役，不许回潮。
    const catalog = block(schema('content'), 'book_catalog');
    expect(catalog).not.toContain("timestamptz('deleted_at')");
  });

  test('B2a-10：§8 #6 登记 B2a 已消项目内表主键差异', () => {
    expect(read('docs/data-model.md')).toMatch(/\| 6 \|[^\n]*B2a/);
  });

  test('B2a-11：deleteProject 的约束清单与基线 DDL 完全一致', () => {
    // 宽匹配 23503 会把任意 FK 故障伪装成「项目里还有内容」，用户清空后
    // 依然删不掉。所以 deleteProject 按约束名精确判定，清单与基线必须闭环：
    // 基线新增子表而代码没登记 → 这里先红。
    const ddl = read('lib/db/migrations/0000_target_schema.sql');
    const fromDdl = [
      ...ddl.matchAll(
        /CONSTRAINT ([a-z_]+) FOREIGN KEY \(organization_id, project_id\)\s*\n?\s*REFERENCES project \(organization_id, id\)/g
      ),
    ]
      .map((m) => m[1])
      .sort();

    const services = read('lib/project/services.ts');
    const blockStart = services.indexOf('PROJECT_CHILD_CONSTRAINTS = [');
    const blockEnd = services.indexOf('] as const;', blockStart);
    expect(blockStart).toBeGreaterThan(-1);
    const fromCode = [
      ...services.slice(blockStart, blockEnd).matchAll(/'([a-z_]+)'/g),
    ]
      .map((m) => m[1])
      .sort();

    expect(fromDdl.length).toBeGreaterThanOrEqual(13);
    expect(fromCode).toEqual(fromDdl);
    // 宽匹配不许回潮。
    expect(services).not.toMatch(/\bisForeignKeyViolation\(error\)/);
    expect(services).toContain(
      'isForeignKeyViolationOf(error, PROJECT_CHILD_CONSTRAINTS)'
    );
  });

  test('B2a-12：归档组织写 status=closed，且不调基线里不存在的函数', () => {
    // 原实现调 `auth.archive_organization(...)`——B0 重建基线后这个函数
    // 已不存在，归档按钮必然 500，而且「归档」在目标态只等于 status='closed'。
    const actions = read('lib/org/actions.ts');
    // 用调用形态匹配，避免被解释来龙去脉的注释误伤。
    expect(actions).not.toMatch(/archive_organization\s*\(/);
    expect(actions).toContain(".set({ status: 'closed' })");
    // 必须带状态前置条件，否则会把 suspended 覆盖成 closed。
    expect(actions).toContain("eq(organizations.status, 'active')");

    // 全仓不许再调用基线里没有数据库函数（按 A.6 的函数清单白名单校验）。
    const ddl = read('lib/db/migrations/0000_target_schema.sql');
    const defined = new Set(
      [...ddl.matchAll(/FUNCTION (app\.[a-z_]+)\(/g)].map((m) => m[1])
    );
    for (const fn of ['create_organization', 'accept_invite']) {
      expect(defined.has(`app.${fn}`), fn).toBe(true);
    }
    expect(defined.has('app.archive_organization')).toBe(false);
  });
});
