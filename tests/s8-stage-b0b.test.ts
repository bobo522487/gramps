/**
 * S8 阶段 B · B0b：补回 B0 丢失的隔离层（租户键不可变 + 注册建个人组织）。
 *
 * 背景：B0 重建唯一基线（commit `a753e12`）时丢了整层多租户隔离实现，导致
 * `217 failed`。B2a 已修掉两处契约断裂（GUC 名、auth 表名），本批补 DDL 层。
 *
 * **本批只补 2 个触发器**，都与规格 §5.3「全库用户定义触发器 0」构成刻意的
 * 例外，理由写在 `docs/data-model.md` §5.3 的例外表里：
 *
 *   1. `trg_<table>_tenant_immutable`（16 张表）—— RLS 的 USING 只看 OLD、
 *      WITH CHECK 只看 NEW，任何策略组合都比不了两行。
 *   2. `trg_auth_user_created` —— Better Auth 的 after 钩子在事务提交后才跑，
 *      做不出「用户与组织同生同死」。
 *
 * 其余 4 项旧触发器（`trg_org_slug_immutable` / `last_owner_*` / `active_org`）
 * **刻意不补**：§9 已把它们登记为写入路径契约，不靠 DDL。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** 去掉行注释与块注释：本批两次被自己的注释误伤，计数一律看剥注释版。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)--.*$/gm, '$1');
}

const ddl = read('lib/db/migrations/0000_target_schema.sql');
const ddlCode = stripComments(ddl);

/** `CREATE TABLE <name> (` 到行首 `);` 之间的列定义块。 */
function tableBlock(source: string, table: string): string {
  const escaped = table.replace(/\./g, '\\.');
  const start = new RegExp(
    `^CREATE TABLE (?:IF NOT EXISTS )?${escaped} \\(`,
    'm'
  ).exec(source);
  if (!start) return '';
  const from = start.index + start[0].length;
  const end = source.indexOf('\n);', from);
  return source.slice(from, end < 0 ? undefined : end);
}

/** A.6.1 段里那份 (表, 租户键数组) 清单。 */
function guardEntries(): { table: string; columns: string[] }[] {
  // 段界锚点必须取自原文：`[A.6.1]` 只是注释文本，stripComments 会把它整行删掉。
  const from = ddl.indexOf('app.forbid_tenant_move');
  const to = ddl.indexOf('REVOKE ALL ON SCHEMA app FROM PUBLIC');
  const section = stripComments(ddl.slice(from, to));
  return [...section.matchAll(/^\s*\('([a-z_]+)',\s*ARRAY\[([^\]]*)\]/gm)].map(
    (m) => ({
      table: m[1],
      columns: [...m[2].matchAll(/'([a-z_]+)'/g)].map((c) => c[1]),
    })
  );
}

describe('S8 阶段 B · B0b 隔离层回补', () => {
  test('B0b-1：forbid_tenant_move 是泛化守卫，带三项护栏', () => {
    expect(ddlCode).toContain(
      'CREATE OR REPLACE FUNCTION app.forbid_tenant_move()'
    );
    // TG_ARGV 让它一个函数服务 16 张表，不是 16 份复制粘贴。
    expect(ddlCode).toMatch(/FOREACH col IN ARRAY TG_ARGV/);
    // IS DISTINCT FROM 而非 <>：NULL <> NULL 是 NULL，会把 NULL -> 值 放过去。
    expect(ddlCode).toMatch(
      /to_jsonb\(NEW\) -> col IS DISTINCT FROM to_jsonb\(OLD\) -> col/
    );
    // 手写参数清单的护栏：拼错列名时两边都是 NULL，比较恒不成立。
    expect(ddlCode).toContain('IF NOT (to_jsonb(NEW) ? col) THEN');
    expect(ddlCode).toContain("ERRCODE = '42703'");
    expect(ddlCode).toContain("ERRCODE = '42501'");
  });

  test('B0b-2：含 organization_id 的表与守卫清单严格一一对应', () => {
    // 这条是防「新表忘了加触发器」：之前 16 张表靠一张手写清单维持，
    // 没有机器校验时漏一张就是一条静默的越权路径。双向相等，多写少写都红。
    const tables = [
      ...ddlCode.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?([a-z_.]+) \(/gm),
    ]
      .map((m) => m[1])
      .filter((t) => !t.startsWith('auth.') && !t.startsWith('drizzle.'));

    const scoped = tables
      .filter((t) => /^\s+organization_id\s+uuid/m.test(tableBlock(ddlCode, t)))
      .sort();

    const guarded = guardEntries()
      .map((e) => e.table)
      .sort();

    expect(guarded).toEqual(scoped);
    // activity_logs 已在 B2a 退役，book_export 随 B1 的 A.5 进来。
    expect(guarded).not.toContain('activity_logs');
    expect(guarded).toContain('book_export');
    expect(guarded.length).toBe(16);
  });

  test('B0b-3：关键表的租户键按语义绑定，不是一律 organization_id', () => {
    // 名不副实的旧标题叫「每张表」，实际只断言 7 张——B0b-2 已验证清单
    // 双向相等，这里挑出「钉错就漏权」的那几张逐个核对，改个诚实的名字。
    const byTable = new Map(guardEntries().map((e) => [e.table, e.columns]));
    // 一级：只有组织边界
    // 成员行连 user_id 一起钉：改 user_id 等于把成员身份改写给别人。
    expect(byTable.get('organization_member')).toEqual([
      'organization_id',
      'user_id',
    ]);
    expect(byTable.get('invite')).toEqual(['organization_id']);
    expect(byTable.get('project')).toEqual(['organization_id']);
    // 二级：项目内
    expect(byTable.get('folder')).toEqual(['organization_id', 'project_id']);
    expect(byTable.get('article')).toEqual(['organization_id', 'project_id']);
    // 谱系层：node 必须连 project_id 一起钉——lineage 的主键是 (project_id, id)，
    // 只钉 lineage_id 时，在一个项目里造一条同 id 的 lineage 就能把节点搬过去。
    expect(byTable.get('node')).toEqual([
      'organization_id',
      'project_id',
      'lineage_id',
    ]);
    // 同理 book 的主键是 (project_id, id)。
    expect(byTable.get('book_catalog')).toEqual([
      'organization_id',
      'project_id',
      'book_id',
    ]);
    // 没有二级键的表不许凭手感多钉：多钉一个不存在的列会撞 42703，
    // 多钉一个存在的可变列则把合法操作变成报错。
    expect(byTable.get('book_export')).toEqual([
      'organization_id',
      'project_id',
    ]);
    expect(byTable.get('event')).toEqual(['organization_id', 'project_id']);
  });

  test('B0b-4：注册建个人组织用同事务触发器，不用 after 钩子', () => {
    expect(ddlCode).toContain(
      'CREATE OR REPLACE FUNCTION public.handle_new_user()'
    );
    expect(ddlCode).toMatch(
      /CREATE TRIGGER trg_auth_user_created\s+AFTER INSERT ON auth\.user/
    );
    // SECURITY DEFINER 才能跨 auth -> public 写；否则 auth_service 连接没有
    // public schema 的 INSERT 权限，注册会在触发器里就 42501。
    expect(ddlCode).toMatch(
      /FUNCTION public\.handle_new_user\(\)[\s\S]{0,80}SECURITY DEFINER/
    );
    // 应用层不能有第二套：钩子在事务提交后才跑，做不到原子，
    // 两套并存会让「组织从哪来」变得不可推理。
    const auth = read('lib/auth/better-auth.ts');
    expect(auth).not.toContain('databaseHooks');
  });

  test('B0b-5：accept_invite 拒绝已关停组织的邀请', () => {
    const inviteFn = ddlCode.slice(
      ddlCode.indexOf('FUNCTION app.accept_invite'),
      ddlCode.indexOf('DO $$', ddlCode.indexOf('FUNCTION app.accept_invite'))
    );
    // 目标态没有软删，关停组织行还在表里；没有这个谓词就能继续往
    // 已关停组织里塞人（旧实现靠 trg_invite_active_org 触发器兜）。
    expect(inviteFn).toMatch(/o\.status <> 'closed'/);
  });

  test('B0b-6：规格 §5.3 已修订为「2 类例外」，不再声称 0 触发器', () => {
    const spec = read('docs/data-model.md');
    expect(spec).not.toContain('全库用户定义触发器 0');
    // 「2 类共 17 条」：类数与实例数都要写。只写「2 个」会让人以为库里
    // 真的只有两条触发器，运维照着数会以为部署缺了 15 条。
    expect(spec).toMatch(/全库用户定义触发器 2 类共 17 条/);
    // 例外必须逐条给出「为什么不能进约束 / 策略」和「为什么不能进应用层」，
    // 只写一句「需要所以要」等于没写。
    expect(spec).toContain('trg_<table>_tenant_immutable');
    expect(spec).toContain('trg_auth_user_created');
    expect(spec).toContain('queueAfterTransactionHook');
  });

  test('B0b-7：部署闸门的清单与本批实现同步', () => {
    const verify = read('scripts/verify-deployment.mjs');
    // auth 表已改单数（B2a），闸门不能还查 auth.users。
    expect(verify).toContain(
      "const AUTH_TABLES = ['user', 'session', 'account', 'verification']"
    );
    expect(verify).not.toContain("'auth', 'users'");
    // 租户不可变清单：去 activity_logs、加 book_export。
    expect(verify).toContain("'book_export',");
    expect(verify).not.toMatch(
      /TENANT_IMMUTABLE_TABLES[\s\S]*?'activity_logs'/
    );
    // 注册触发器在 auth.user 上，不是 auth.users。
    expect(verify).toContain("['auth', 'user', 'trg_auth_user_created']");
    // 关停组织的邀请失效，只能从函数体断言（没有触发器可查）。
    expect(verify).toContain(
      'accept_invite rejects invitations to closed organizations'
    );
    // 业务表清单同样要去 activity_logs / 加 book_export，否则部署闸门
    // 会对着一张退役的表报「不存在」，或者放过一张没建的表。
    const businessList = verify.slice(
      verify.indexOf('const BUSINESS_TABLES = ['),
      verify.indexOf('];', verify.indexOf('const BUSINESS_TABLES = ['))
    );
    expect(businessList).not.toContain('activity_logs');
    expect(businessList).toContain("'book_export'");
    // 策略断言必须锚定目标态表达式。旧版查 auth.has_org_role，而目标基线
    // 已没有这个函数（B2a 换成 app.visible_org_array + SET LOCAL ROLE），
    // 留着就是一条恒红的断言——恒红三次之后就有人把它改成 `|| true`。
    expect(verify).toContain('app\\.visible_org_array\\(\\)');
    expect(verify).not.toContain('has_org_role');
  });

  test('B0b-9：接受邀请的准入检查是「组织状态」而不是布尔', () => {
    // 布尔返回值把「已关停」和「组织不存在」压成同一个答案，用户看到
    // 「已归档」却找不到归档记录。函数返回 organization.status 本身，
    // `missing` 作为查无此行的哨兵。
    expect(ddlCode).toContain(
      'CREATE OR REPLACE FUNCTION app.organization_join_state(p_org_id uuid) RETURNS text'
    );
    expect(ddlCode).toMatch(
      /SELECT o\.status::text FROM public\.organization o/
    );
    expect(ddlCode).toContain("'missing'");
    // 兼容壳只做投影，不许长出第二套判断。
    expect(ddlCode).toMatch(
      /FUNCTION app\.organization_is_open\(p_org_id uuid\)[\s\S]{0,200}?SELECT app\.organization_join_state\(p_org_id\) = 'active'/
    );

    // 应用层必须用三态那个，并分别给出文案；用布尔版就退化回含糊提示。
    const action = read('lib/org/actions.ts');
    expect(action).toContain('app.organization_join_state(');
    expect(action).not.toContain('app.organization_is_open(');
    expect(action).toContain("state === 'missing'");
    expect(action).toMatch(/state !== 'active'/);

    // 附录 A 是唯一 DDL 真相源，回写不能只改一半。
    const appendix = read('../gramps-S8-目标DDL.sql');
    expect(appendix).toContain('FUNCTION app.organization_join_state');
    expect(appendix).toContain(
      'GRANT EXECUTE ON FUNCTION app.organization_join_state(uuid)'
    );
  });

  test('B0b-8：旧的 4 项触发器不许回潮', () => {
    // 它们不是「被忘了」，是 §9 明确改成写入路径契约。谁再加回来，
    // 等于把两份真相源重新铺开，必须先改 §9 与本条。
    for (const name of [
      'trg_org_slug_immutable',
      'trg_org_member_last_owner_delete',
      'trg_org_member_last_owner_update',
      'trg_org_member_active_org',
      'trg_invite_active_org',
    ]) {
      expect(ddlCode, name).not.toContain(name);
    }
  });
});
