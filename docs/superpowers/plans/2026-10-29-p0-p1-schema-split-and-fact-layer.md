# 家谱数据模型 P0+P1 实施计划（schema 拆分 / 租户列不可变 / 事实层落库与回填）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `lib/db/schema.ts` 拆成 `lib/db/schema/` 目录、给全部租户表加上"租户列不可 UPDATE"触发器，然后按蓝图 §9/§11 建起事实层六张表（`person`、`person_name`、`family`、`family_partner`、`family_child`、`event`），把 `node` 存量数据回填进新表并对账到零差异。

**Architecture:** P0 是纯结构准备（拆文件 + 一个安全触发器），不改任何行为，全部现有测试必须原样通过。P1 是"只建不读"：新表上线、RLS 上线、`data/` 脚本把 `node` 存量搬进新表，`node` 仍是唯一读源，所以画布、世系表、检查器、Action 全部不动。读写切换留给下一份计划（见"本计划的边界"）。

**Tech Stack:** PostgreSQL 18（`uuidv7()`、`ltree`、`pg_trgm`、`btree_gist`）· Drizzle ORM + drizzle-kit · Vitest 单测 + 真实 PostgreSQL 集成测试 · Biome · TypeScript strict

**Spec:** [docs/superpowers/specs/2026-10-29-genealogy-data-model-blueprint-design.md](../specs/2026-10-29-genealogy-data-model-blueprint-design.md)

## 本计划的边界

蓝图 §21 的 P0 与 P1 是两个独立可上线的阶段，但 P1 内部还分两半：**落库**（建表 + 回填 + 对账）与**切换**（读路径改新表 + 写路径改新表 + UI 适配）。本计划只做：

| 做 | 不做（留给下一份计划 `2026-11-XX-p1-read-write-switch.md`） |
|---|---|
| P0：schema 拆分、租户列不可变触发器、ADR 0016 | `lib/db/queries/persons.ts` 等新查询 |
| P1：六张表的 Drizzle 定义 + 生成迁移 + 手写 RLS/不变量迁移 | `NodeView` DTO 投影改造、画布/世系表/检查器改数据源 |
| P1：`data/backfill-fact-layer.ts` 与 `data/reconcile-fact-layer.ts` | `lib/lineage/actions.ts`、`node-services.ts` 的写路径改造 |
| P1：`lib/genealogy/constants.ts` 枚举 + 枚举↔CHECK 一致性测试 | `person_placement` / `placement_tree`（P2）、`place`（P3） |

**为什么切开：** 落库与对账的验收标准是"数字对得上"，完全可以用集成测试证明；切换的验收标准是"画布上的东西一个不少"，那要 E2E 和真实谱数据，是另一种风险。混在一份计划里，评审无法只拒绝一半。

**本计划完成后系统仍完全可用**：`node` 未被冻结、没有任何读路径改动，新表是"影子数据 + 已证明一致"。

## Global Constraints

以下每条都是蓝图或仓库既有约定，逐字照做，不要"顺手改进"：

- **DDL 幂等**：`CREATE TABLE IF NOT EXISTS`、`CREATE OR REPLACE FUNCTION`、`DROP POLICY IF EXISTS` 后 `CREATE POLICY`、`DROP TRIGGER IF EXISTS` 后 `CREATE TRIGGER`（蓝图 §7.10）。
- **主键** `uuid primary key default uuidv7()`，用 `lib/db/schema/shared.ts` 的 `uuidPk()`；**不要** `gen_random_uuid()`（仓库规则 4）。
- **每张组织级表**：`organization_id uuid not null`；事实层六张表额外 `project_id uuid not null`；每张表 `UNIQUE (organization_id, project_id, id)` 供复合外键引用（蓝图 §7.1）。
- **RLS 三段式**：`ENABLE` + `FORCE` + `_select`（四角色）/ `_insert` / `_update`（owner·admin·editor），用 `auth.has_org_role(organization_id, ...)`；**不建 DELETE policy，不授 DELETE**（蓝图 §7.4）。
- **全部软删**：`deleted_at timestamptz` + 唯一约束一律写成部分唯一索引 `WHERE deleted_at IS NULL`（蓝图 §7.2/§7.3）。
- **枚举**：`varchar` + `CHECK (col IN (...))`，不用 PostgreSQL `ENUM`；值定义在 `lib/genealogy/constants.ts`，TS 侧 `$type<Union>()`（蓝图 §7.6）。
- **复合索引一律 `organization_id` 打头**；每条复合外键在子侧都要有索引（蓝图 §7.8）。
- **不建 trgm 索引**（ADR 0011）：人丁搜索在客户端做。
- **不新增后台任务/队列/定时器**（ADR 0005）。回填是同步 CLI 脚本。
- **迁移只做 DDL**，回填逻辑放 `data/`（AGENTS.md §7 规则 9）。
- **手写迁移只追加 `lib/db/migrations/meta/_journal.json` 条目，不生成 snapshot**（照 `0013_drop_node_trgm.sql`、`0014_spouse_sort_index.sql`）。
- **单文件 ≤400 行**（F6），**只有 `lib/config.ts` 读 `process.env`**（F7）；`data/` 目录不在 F6/F7 扫描范围（`scripts/check-file-size.mjs:20`、`scripts/check-env-access.mjs:15` 的 `SCANNED` 只有 `app`/`components`/`lib`/`hooks`）。
- **提交前必须** `pnpm check && pnpm typecheck && pnpm test` 全绿，另加 `pnpm arch:check`、`pnpm docs:check --strict`、`pnpm test:integration`。
- **迁移与业务代码分开提交**（AGENTS.md §9）。本计划的每个 Task 都是一次提交，迁移 SQL 与该 Task 的 schema/测试同 commit（它们互相依赖，拆开会让 CI 红）。
- **回填脚本要求以 BYPASSRLS 角色运行**（本地即 Docker 的 `postgres` 超级用户）：所有业务表是 `FORCE ROW LEVEL SECURITY`，非 BYPASSRLS 角色连表主也看不到行。脚本启动时先 `SELECT current_user, rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user` 并拒绝继续，除非为 true。

## Review Focus

这五类输入/条件没有测试会自然覆盖，但最可能让使用者出事。每一条都在下面某个 Task 里有对应测试（括号内）：

1. **同时属于两个组织的用户把行搬走**：`UPDATE project SET organization_id = <另一个我也有权限的组织>` 会被 RLS 的 `WITH CHECK` 放行（它只看新值）。修复前这是真实的静默越权（Task 2）。
2. **一个人有多个配偶时的子女母亲归属**：`node` 不记录母亲。回填后这些子女挂在"只有一个血亲 partner"的 `family` 上，必须被 `lossReport` 计数并报 `unknownMother`，而不是静默猜一个配偶（Task 7 用例 4；Task 8 的 `families` 对账项独立复算同一条规则）。
3. **日期原文与边界不一致**：`birth_text='约光绪二十年'`（只有原文）、`'before 1691'`（只有上界）、`'1900'`（整年）三种输入，必须分别落到 `unknown` / `before` / `exact + year` 三种合法编码，任何组合都不能违反五条 CHECK（Task 6 用例 4–8、Task 7 用例 5–6）。
4. **名讳失考的人**：`person_name.full_name` 允许为空、`person.name_status='unknown'`、`person.primary_name_id` 为 NULL。这样的行必须能插、能回填，不能因为"每个人必须有主名"的直觉假设而失败（Task 4 用例 1；回填侧见 Task 7 用例 9 的反面）。
5. **软删的连锁**：软删一条边后同一 `(family, person)` 必须能重新建立（部分唯一索引），而软删的 `node` 不产生 `family_child` 边、也不让回填失败（Task 5 用例 3、Task 7 用例 8）。

---

## 文件结构

**新建**

| 文件 | 职责 |
|---|---|
| `lib/db/schema/shared.ts` | `ltree` 自定义类型、`timestamptz()`、`uuidPk()` 三个助手 |
| `lib/db/schema/auth.ts` | `authSchema` + `users`/`sessions`/`accounts`/`verifications` |
| `lib/db/schema/org.ts` | `organizations`、`orgMembers`、`invitations` |
| `lib/db/schema/project.ts` | `projects`、`folders` |
| `lib/db/schema/lineage.ts` | `lineages`、`nodes` |
| `lib/db/schema/content.ts` | `articles`、`books`、`bookCatalogs` |
| `lib/db/schema/activity.ts` | `activityLogs` + `ActivityType` 枚举 |
| `lib/db/schema/relations.ts` | 全部 `relations()` 声明 |
| `lib/db/schema/person.ts` | `person`、`personNames`（P1） |
| `lib/db/schema/family.ts` | `families`、`familyPartners`、`familyChildren`（P1） |
| `lib/db/schema/event.ts` | `events`（P1） |
| `lib/db/schema/index.ts` | 唯一对外出口：再导出全部表、枚举与 `$inferSelect` 类型 |
| `lib/genealogy/constants.ts` | 全部枚举值（`as const` 数组 + 联合类型） |
| `lib/db/backfill/fact-layer.ts` | `backfillFactLayer()`：`node` → 事实层，单事务 |
| `lib/db/backfill/reconcile-fact-layer.ts` | `reconcileFactLayer()`：只读对账 |
| `data/backfill-fact-layer.ts` | 回填 CLI（读环境变量、打印进度） |
| `data/reconcile-fact-layer.ts` | 对账 CLI（打印差异表，差异非零时退出码 1） |
| `tests/helpers/constraints.ts` | `readCheckConstraintValues()` 等测试助手 |
| `tests/integration/tenant-immutability.test.ts` | P0 触发器 |
| `tests/integration/fact-person.test.ts` | `person`/`person_name` 约束与 RLS |
| `tests/integration/fact-family.test.ts` | `family`/`family_partner`/`family_child` 约束与 RLS |
| `tests/integration/fact-event.test.ts` | `event` 日期矩阵与主体 CHECK |
| `tests/integration/fact-backfill.test.ts` | 回填 + 对账零差异 |
| `docs/decisions/0016-tenant-columns-immutable.md` | ADR 0016 |

**修改**

| 文件 | 改动 |
|---|---|
| `lib/db/schema.ts` | **删除**（内容搬进目录） |
| `drizzle.config.ts:5` | `schema: './lib/db/schema.ts'` → `'./lib/db/schema/index.ts'` |
| `scripts/check-file-size.mjs:27` | 删掉 `{ path: 'lib/db/schema.ts', lines: 688 }` 这条豁免 |
| `lib/db/migrations/meta/_journal.json` | 追加 7 条（见下表） |
| `tests/helpers/db.ts:40-58` | `resetDatabase()` 的 TRUNCATE 清单加新表 |
| `tests/helpers/factories.ts` | 新增 6 个工厂函数 |
| `tests/integration/migrations.test.ts` | 表清单、RLS 计数、索引清单随新表更新 |
| `docs/data-model.md` | 新表条目 + 租户列不可变说明 |
| `docs/implementation-status.md` | P0/P1 落地状态 |
| `docs/decisions/README.md` | 索引里加 ADR 0016 |
| `package.json` | 加 `data:backfill:fact`、`data:reconcile:fact` 两个脚本 |

**迁移编号表（照此顺序，不要跳号）**

| 编号 | 产生方式 | Task | 内容 |
|---|---|---|---|
| `0015_forbid_tenant_move.sql` | 手写 | 2 | `app` schema、`app.forbid_tenant_move()`、10 个触发器 |
| `0016_<drizzle-kit 生成>.sql` | `pnpm db:generate` | 5 | `person`、`person_name` |
| `0017_fact_person_rls.sql` | 手写 | 5 | 两张表的 RLS、GRANT、`primary_name_id` 复合外键 |
| `0018_<生成>.sql` | `pnpm db:generate` | 6 | `family`、`family_partner`、`family_child` |
| `0019_fact_family_rls.sql` | 手写 | 6 | RLS、血亲侧不变量触发器 |
| `0020_<生成>.sql` | `pnpm db:generate` | 7 | `event` |
| `0021_fact_event_rls.sql` | 手写 | 7 | RLS、日期五条 CHECK（生成式表达不了，见 Task 7） |

`pnpm db:generate` 用 `_journal.json` 的条目数决定编号，所以手写条目会让下一次生成自动跳号——**先跑手写迁移再跑 generate 的顺序不能颠倒**，否则编号会撞。

---

### Task 1: 把 `lib/db/schema.ts` 拆成目录

纯搬移，零行为变更。失败信号来自 F6：先删豁免，`pnpm arch:check` 会红，拆完才绿。

**Files:**
- Delete: `lib/db/schema.ts`
- Create: `lib/db/schema/shared.ts`、`auth.ts`、`org.ts`、`project.ts`、`lineage.ts`、`content.ts`、`activity.ts`、`relations.ts`、`index.ts`
- Modify: `drizzle.config.ts:5`、`scripts/check-file-size.mjs:27`
- Test: `tests/schema-barrel.test.ts`

**Interfaces:**
- Consumes: 无（第一个 Task）
- Produces: `@/lib/db/schema` 这个模块路径保持不变（目录 `index.ts` 解析），导出名与现在**完全一致**——11 个表对象、`authSchema`、`ActivityType`、11 个 `$inferSelect` 类型（`User`/`NewUser`/`Session`/`NewSession`/`Account`/`NewAccount`/`Verification`/`NewVerification`/`Organization`/`NewOrganization`/`OrgMember`/`NewOrgMember`/`Project`/`NewProject`/`ActivityLog`/`NewActivityLog`/`Invitation`/`NewInvitation`/`Folder`/`Lineage`/`Node`/`Article`/`Book`/`BookCatalog`）。新增导出 `shared.ts` 的 `uuidPk`、`timestamptz`、`ltree` 供后续 Task 使用。

- [ ] **Step 1: 删掉 F6 豁免，让检查变红**

把 `scripts/check-file-size.mjs:27` 的 `{ path: 'lib/db/schema.ts', lines: 688 },` 整行删除。

- [ ] **Step 2: 确认检查失败**

Run: `pnpm arch:check`
Expected: FAIL，输出含 `lib/db/schema.ts` 与 `688`（`[F6] ... 1 violation`）。

- [ ] **Step 3: 写回归网测试**

创建 `tests/schema-barrel.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';

const TABLE_EXPORTS = [
  'users', 'sessions', 'accounts', 'verifications',
  'organizations', 'orgMembers', 'invitations',
  'projects', 'folders', 'lineages', 'nodes',
  'articles', 'books', 'bookCatalogs', 'activityLogs',
] as const;

describe('schema barrel', () => {
  it('re-exports every table object', () => {
    for (const name of TABLE_EXPORTS) {
      expect(schema[name], name).toBeDefined();
    }
  });

  it('re-exports authSchema and the ActivityType enum', () => {
    expect(schema.authSchema.schemaName).toBe('auth');
    expect(schema.ActivityType.CREATE_NODE).toBe('CREATE_NODE');
  });
});
```

- [ ] **Step 4: 确认它现在通过（这是回归网，不是红绿灯）**

Run: `pnpm test tests/schema-barrel.test.ts`
Expected: PASS（2 passed）。**本 Task 的红色信号是 Step 2 的 `arch:check`，不是这个测试**——搬移型重构没有新行为可测，这个测试的作用是搬完之后证明出口没漏。

- [ ] **Step 5: 按域搬运，一次搬完**

`lib/db/schema/shared.ts`：把 `lib/db/schema.ts:22-31` 的 `ltree`、`timestamptz`、`uuidPk` 原样搬过来并 `export`，import 从 `'drizzle-orm/pg-core'` 取 `customType`、`timestamp`、`uuid`，`sql` 从 `'drizzle-orm'`。

其余按"文件结构"表逐表搬移，**代码一字不改**，只调整 import 路径：

- `auth.ts`：`authSchema`（`:33`）、`users`（`:40`）、`sessions`（`:87`）、`accounts`（`:111`）、`verifications`（`:139`）
- `org.ts`：`organizations`（`:57`）、`orgMembers`（`:155`）、`invitations`（`:184`）
- `project.ts`：`projects`（`:215`）、`folders`（`:255`）；保留 `import type { ProjectStatus } from '../../project/constants';`（注意多一层 `../`）
- `lineage.ts`：`lineages`（`:290`）、`nodes`（`:325`）
- `content.ts`：`articles`（`:416`）、`books`（`:445`）、`bookCatalogs`（`:483`）
- `activity.ts`：`activityLogs`（`:542`）+ `ActivityType`（`:663-687`）
- `relations.ts`：`:562-628` 的 8 个 `*Relations`
- `index.ts`：`export * from './shared'; export * from './auth'; ...`（全部 8 个域文件）+ `:634-660` 的 11 个 `$inferSelect` 类型导出

- [ ] **Step 6: 改 drizzle 配置**

`drizzle.config.ts:5`：`schema: './lib/db/schema.ts'` → `schema: './lib/db/schema/index.ts'`。

- [ ] **Step 7: 验证全绿**

Run: `pnpm arch:check && pnpm typecheck && pnpm check && pnpm test && pnpm test:integration`
Expected: `arch:check` 输出 `[F6] ... 0 violations`（豁免从 8 条降到 7 条）与 `[F7] ... 0 process.env violations`；其余全部通过，无一个测试被改动。

- [ ] **Step 8: 确认 drizzle 仍能读懂 schema**

Run: `pnpm db:generate`
Expected: 输出 `No schema changes, nothing to migrate`，且 `lib/db/migrations/` 与 `meta/_journal.json` 无任何新文件。**如果有新文件，说明搬移改变了 Drizzle 看到的 schema，回到 Step 5 找出差异，不要提交生成的迁移。**

- [ ] **Step 9: 提交**

```bash
git add -A lib/db/schema lib/db/schema.ts drizzle.config.ts scripts/check-file-size.mjs tests/schema-barrel.test.ts
git commit -m "refactor(db): split lib/db/schema.ts into a per-domain directory"
```

---

### Task 2: 租户列不可变触发器（ADR 0016）

**Files:**
- Create: `lib/db/migrations/0015_forbid_tenant_move.sql`
- Modify: `lib/db/migrations/meta/_journal.json`
- Create: `tests/integration/tenant-immutability.test.ts`
- Test: 同上

**Interfaces:**
- Consumes: Task 1 的 `lib/db/schema/` 目录（测试要 import 表对象）；仓库既有的 `withOrg`（`lib/db/drizzle.ts:71-85`）与 `tests/helpers/factories.ts` 的 `createUser`/`createOrganization`/`addMember`/`createProject`/`createFolder`/`createLineage`/`createNode`/`createArticle`/`createBook`。
- Produces: 函数 `app.forbid_tenant_move()`（`RETURNS trigger`，读 `TG_ARGV` 里的列名列表）；10 个触发器 `trg_<table>_tenant_immutable`。后续所有新表都必须挂这个触发器。

- [ ] **Step 1: 写失败测试**

创建 `tests/integration/tenant-immutability.test.ts`：

```ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withOrg } from '@/lib/db/drizzle';
import { getTestSql, pgErrorCode } from '../helpers/db';
import {
  addMember, createOrganization, createProject, createUser,
} from '../helpers/factories';

describe('tenant columns are immutable', () => {
  it('rejects moving a project into another organization', async () => {
    const user = await createUser();
    const from = await createOrganization();
    const to = await createOrganization();
    await addMember({ userId: user.id, organizationId: from.id, role: 'owner' });
    await addMember({ userId: user.id, organizationId: to.id, role: 'owner' });
    const project = await createProject({ orgId: from.id, createdBy: user.id });

    await expect(
      withOrg(user.id, (tx) =>
        tx.execute(
          sql`update project set organization_id = ${to.id} where id = ${project.id}`
        )
      )
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '42501');
  });

  it('rejects moving a lineage into another project', async () => { /* 同上，改 lineage.project_id */ });

  it('rejects moving a node into another lineage', async () => { /* node.lineage_id */ });

  it('still allows updating ordinary columns', async () => {
    // rename a project: 必须成功，证明触发器没有误伤
  });

  it('guards every tenant table that has a tenant column', async () => {
    const rows = await getTestSql()<{ table_name: string }[]>`
      SELECT c.relname AS table_name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg_%_tenant_immutable'
      ORDER BY c.relname`;
    expect(rows.map((r) => r.table_name)).toEqual([
      'activity_logs', 'article', 'book', 'book_catalog', 'folder',
      'invite', 'lineage', 'node', 'organization_member', 'project',
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:integration tests/integration/tenant-immutability.test.ts`
Expected: 前 3 个用例 FAIL（UPDATE 成功、没有报错），最后 1 个 FAIL（0 行）。

- [ ] **Step 3: 写迁移**

创建 `lib/db/migrations/0015_forbid_tenant_move.sql`。文件头注释要说明动机（照 `0014_spouse_sort_index.sql` 的注释密度）：`withOrg` 里 `app_rw` 有 UPDATE 权限，RLS 的 `WITH CHECK` 只看新值，所以同时属于两个组织的用户能把行搬走——这是当前代码里真实存在的越权路径（蓝图 §7.5、评审 P0）。

```sql
CREATE SCHEMA IF NOT EXISTS app;

-- 一个函数服务所有表：列名从 TG_ARGV 传入，避免 10 份几乎相同的 PL/pgSQL。
CREATE OR REPLACE FUNCTION app.forbid_tenant_move() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION 'column %.% is immutable', TG_TABLE_NAME, col
        USING ERRCODE = '42501',
              HINT = 'tenant and ownership columns cannot be reassigned; create a new row instead';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

GRANT USAGE ON SCHEMA app TO app_rw;
GRANT EXECUTE ON FUNCTION app.forbid_tenant_move() TO app_rw;
-- organization / organization_member / invite 的写权限属于 auth_service（AGENTS.md §5.4），
-- Better Auth 的 organization 插件会 UPDATE 这三张表的非租户列。触发器以调用者身份执行，
-- 所以 auth_service 也必须有 EXECUTE，否则改成员角色会报 permission denied。
GRANT USAGE ON SCHEMA app TO auth_service;
GRANT EXECUTE ON FUNCTION app.forbid_tenant_move() TO auth_service;
```

**不要** `REVOKE ALL ... FROM PUBLIC`：这个函数只读 `NEW`/`OLD` 并可能 `RAISE`，没有可被滥用的能力；而漏授一个角色会让 Better Auth 的成员变更在生产上失败，是比"多余授权"贵得多的故障。这一点写进 ADR 0016 的"后果"段。

然后 10 张表各一组 `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER ... BEFORE UPDATE ... FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('...')`，列清单**必须逐字照下表**（结构关系列如 `parent_id`、`spouse_of_id` 不在内——移动节点是合法操作）：

| 表 | 传参 |
|---|---|
| `organization_member` | `'organization_id'` |
| `invite` | `'organization_id'` |
| `project` | `'organization_id'` |
| `folder` | `'organization_id', 'project_id'` |
| `lineage` | `'organization_id', 'project_id', 'folder_id'` |
| `node` | `'organization_id', 'lineage_id'` |
| `article` | `'organization_id', 'project_id', 'folder_id'` |
| `book` | `'organization_id', 'project_id', 'folder_id'` |
| `book_catalog` | `'organization_id', 'book_id'` |
| `activity_logs` | `'organization_id'` |

- [ ] **Step 4: 追加 journal 条目**

在 `lib/db/migrations/meta/_journal.json` 的 `entries` 末尾追加（`when` 用当前毫秒时间戳）：

```json
{
  "idx": 15,
  "version": "7",
  "when": 1793200000000,
  "tag": "0015_forbid_tenant_move",
  "breakpoints": true
}
```

**不生成 snapshot**（照 0013/0014 的做法）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test:integration tests/integration/tenant-immutability.test.ts`
Expected: PASS（5 passed）。

- [ ] **Step 6: 确认没有误伤**

Run: `pnpm test:integration`
Expected: 全绿。三处必须逐个确认：

1. `tests/integration/nodes.test.ts`（移动节点、改父节点）、`projects.test.ts`（改名）、`folders-lineages.test.ts`——都在 UPDATE 非租户列，必须照常通过。
2. `tests/integration/better-auth.test.ts`、`tests/integration/auth-migration.test.ts`——走 `auth_service` 连接改 `organization_member.role` / `organization.name`。如果这两处红了，就是 Step 3 漏授了 `auth_service` 的 EXECUTE，回去补，**不要**改成 `DISABLE TRIGGER`。
3. `tests/integration/org-scope.test.ts`——跨组织越权的既有断言必须仍然通过（说明触发器没有意外收紧合法路径）。

- [ ] **Step 7: 写 ADR 0016**

创建 `docs/decisions/0016-tenant-columns-immutable.md`，照 `docs/decisions/0004-soft-delete-forever.md` 的结构（背景 / 决策 / 后果 / 重估触发）。必须写清：漏洞形态（RLS `WITH CHECK` 只看新值）、为什么用触发器而不是收紧 policy、为什么列清单是"归属列"而不是"全部外键列"、以及新增表必须挂这个触发器。然后在 `docs/decisions/README.md` 索引表加一行。

- [ ] **Step 8: 文档同步**

`docs/data-model.md` §12（隔离与 RLS）加一小节"租户列不可变"，说明 `app.forbid_tenant_move()` 与 10 张受保护表；`docs/implementation-status.md` 在数据层部分记一条。

- [ ] **Step 9: 提交**

```bash
git add lib/db/migrations/0015_forbid_tenant_move.sql lib/db/migrations/meta/_journal.json \
  tests/integration/tenant-immutability.test.ts docs/decisions/0016-tenant-columns-immutable.md \
  docs/decisions/README.md docs/data-model.md docs/implementation-status.md
git commit -m "feat(db): forbid reassigning tenant columns on every tenant table"
```

---

### Task 3: 枚举常量与测试助手

**Files:**
- Create: `lib/genealogy/constants.ts`
- Create: `tests/helpers/constraints.ts`
- Test: `tests/genealogy-constants.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `PERSON_SEX_VALUES` / `PersonSex`、`LIVING_STATUS_VALUES` / `LivingStatus`、`PRIVACY_LEVEL_VALUES` / `PrivacyLevel`、`NAME_STATUS_VALUES` / `NameStatus`、`PERSON_NAME_TYPE_VALUES` / `PersonNameType`、`PARTNER_ROLE_VALUES` / `PartnerRole`、`PARTNER_STATUS_VALUES` / `PartnerStatus`、`PARENTAGE_TYPE_VALUES` / `ParentageType`、`UNION_TYPE_VALUES` / `UnionType`、`EVENT_KIND_VALUES` / `EventKind`、`EVENT_TYPE_VALUES` / `EventType`、`DATE_PRECISION_VALUES` / `DatePrecision`、`DATE_QUALIFIER_VALUES` / `DateQualifier`、`CALENDAR_VALUES` / `Calendar`
  - `readCheckConstraintValues(sql, table: string, constraintName: string): Promise<string[]>`

- [ ] **Step 1: 写失败测试**

创建 `tests/genealogy-constants.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_VALUES, DATE_PRECISION_VALUES, DATE_QUALIFIER_VALUES, EVENT_TYPE_VALUES,
  LIVING_STATUS_VALUES, PARENTAGE_TYPE_VALUES, PARTNER_ROLE_VALUES, PARTNER_STATUS_VALUES,
  PERSON_NAME_TYPE_VALUES, PERSON_SEX_VALUES, PRIVACY_LEVEL_VALUES, NAME_STATUS_VALUES,
  UNION_TYPE_VALUES,
} from '@/lib/genealogy/constants';

const ALL = {
  PERSON_SEX_VALUES, LIVING_STATUS_VALUES, PRIVACY_LEVEL_VALUES, NAME_STATUS_VALUES,
  PERSON_NAME_TYPE_VALUES, PARTNER_ROLE_VALUES, PARTNER_STATUS_VALUES, PARENTAGE_TYPE_VALUES,
  UNION_TYPE_VALUES, EVENT_TYPE_VALUES, DATE_PRECISION_VALUES, DATE_QUALIFIER_VALUES,
  CALENDAR_VALUES,
};

describe('genealogy constants', () => {
  it('has no duplicate values in any enum', () => {
    for (const [name, values] of Object.entries(ALL)) {
      expect(new Set(values).size, name).toBe(values.length);
    }
  });

  it('pins the values the blueprint names explicitly', () => {
    expect([...PERSON_SEX_VALUES]).toEqual(['male', 'female', 'other', 'unknown']);
    expect([...LIVING_STATUS_VALUES]).toEqual(['living', 'deceased', 'unknown']);
    expect([...PRIVACY_LEVEL_VALUES]).toEqual(['public', 'restricted', 'private']);
    expect([...NAME_STATUS_VALUES]).toEqual(['known', 'unknown', 'partial']);
    expect([...PARTNER_ROLE_VALUES]).toEqual(['blood', 'spouse']);
    expect([...PARENTAGE_TYPE_VALUES]).toEqual([
      'birth', 'adoptive', 'foster', 'step', 'traditional', 'unknown',
    ]);
    expect([...DATE_QUALIFIER_VALUES]).toEqual([
      'exact', 'about', 'estimated', 'calculated', 'before', 'after',
      'between', 'period', 'unknown',
    ]);
    expect([...DATE_PRECISION_VALUES]).toEqual(['day', 'month', 'year', 'decade', 'century']);
  });

  it('covers the event types P1 backfill and Chinese genealogy need', () => {
    for (const required of [
      'birth', 'death', 'burial', 'marriage',
      'succession', 'ancestral_hall', 'genealogy_compiled', 'name_change', 'posthumous_title',
    ]) {
      expect(EVENT_TYPE_VALUES, required).toContain(required);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/genealogy-constants.test.ts`
Expected: FAIL，`Cannot find module '@/lib/genealogy/constants'`。

- [ ] **Step 3: 写 `lib/genealogy/constants.ts`**

每个枚举一个 `as const` 数组 + 一个联合类型，形如：

```ts
export const PERSON_SEX_VALUES = ['male', 'female', 'other', 'unknown'] as const;
export type PersonSex = (typeof PERSON_SEX_VALUES)[number];
```

`EVENT_TYPE_VALUES` 的取值规则：GEDCOM 7 标准事件/属性标签全集（`INDI` 与 `FAM` 两侧，例如 `census`、`probate`、`will`、`naturalization`、`ordination`、`confirmation`、`first_communion`、`blessing`、`barmitzvah`、`basmitzvah`、`graduation`、`retirement`、`emigration`、`immigration`、`residence`、`migration`、`occupation`、`education`、`title`、`nationality`、`property`、`religion`、`cremation`、`adoption`、`christening`、`baptism`、`engagement`、`divorce`、`annulment`、`military_service`），加上 5 个中文宗族事件（`succession`、`ancestral_hall`、`genealogy_compiled`、`name_change`、`posthumous_title`）与兜底值 `custom`、`other`。**不要**只写附件那 26 个值——蓝图 §11.1 明确要求开放枚举（评审 M1：附件把 16 个标准标签逼进了 `custom`）。

`UNION_TYPE_VALUES = ['marriage', 'cohabitation', 'unknown']`、`PARTNER_STATUS_VALUES = ['current', 'divorced', 'widowed', 'separated', 'unknown']`、`CALENDAR_VALUES = ['gregorian', 'julian', 'hebrew', 'french_r', 'chinese_lunar', 'other']`。

- [ ] **Step 4: 写测试助手 `tests/helpers/constraints.ts`**

```ts
import type { Sql } from 'postgres';

/**
 * 从 pg_get_constraintdef 里抠出 CHECK 约束的字符串字面量，用来断言
 * "lib/genealogy/constants.ts 的值集合 == 数据库 CHECK 的值集合"（蓝图 §7.6）。
 */
export async function readCheckConstraintValues(
  sql: Sql,
  table: string,
  constraintName: string
): Promise<string[]> {
  const [row] = await sql<{ def: string }[]>`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = ${table}::regclass AND conname = ${constraintName}`;
  if (!row) {
    throw new Error(`constraint ${constraintName} not found on ${table}`);
  }
  return [...row.def.matchAll(/'([^']*)'::(?:text|character varying)/g)]
    .map((match) => match[1])
    .sort();
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test tests/genealogy-constants.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 6: 提交**

```bash
git add lib/genealogy/constants.ts tests/genealogy-constants.test.ts tests/helpers/constraints.ts
git commit -m "feat(genealogy): add enum constants and a CHECK-constraint test helper"
```

---

### Task 4: `person` 与 `person_name`

**Files:**
- Create: `lib/db/schema/person.ts`
- Modify: `lib/db/schema/index.ts`
- Create: `lib/db/migrations/0016_<生成>.sql`、`lib/db/migrations/0017_fact_person_rls.sql`
- Modify: `lib/db/migrations/meta/_journal.json`、`tests/helpers/db.ts:40-58`、`tests/integration/migrations.test.ts`、`tests/helpers/factories.ts`
- Test: `tests/integration/fact-person.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `uuidPk`/`timestamptz`、Task 2 的 `app.forbid_tenant_move()`、Task 3 的枚举类型与 `readCheckConstraintValues`。
- Produces: Drizzle 导出 `persons`、`personNames`；类型 `Person = typeof persons.$inferSelect`、`NewPerson`、`PersonName`、`NewPersonName`。列（全部 `snake_case`）：
  - `persons`：`id`、`organization_id`、`project_id`、`sex`、`living_status`、`living_status_locked`（bool not null default false）、`privacy_level`、`name_status`、`primary_name_id`（uuid 可空）、`merged_into_id`（uuid 可空）、`sort_key`（text 可空）、`legacy_node_id`（uuid 可空）、`created_at`、`created_by`、`updated_at`、`deleted_at`
  - `personNames`：`id`、`organization_id`、`project_id`、`person_id`、`name_type`、`custom_type`、`full_name`、`surname`、`given_name`、`name_prefix`、`name_suffix`、`surname_prefix`、`nickname`、`pinyin`、`romanized`、`language`（varchar(35)）、`sort_order`（smallint not null default 0）、`created_at`、`created_by`、`updated_at`、`deleted_at`
  - 工厂：`createPerson(params: { orgId: string; projectId: string; createdBy: string; sex?: PersonSex; fullName?: string | null; ... })`、`createPersonName(...)`

- [ ] **Step 1: 写失败测试**

创建 `tests/integration/fact-person.test.ts`，至少覆盖：

```ts
// 1. 名讳失考的人可以存在：full_name 为空、name_status='unknown'、primary_name_id 为 NULL
// 2. person_name.name_type='other' 但 custom_type 为空 → 23514
// 3. 同一 person 同一 name_type 同一 sort_order 插两条 → 23505；软删一条后可再插 → 成功
// 4. primary_name_id 指向别人的 name → 23503（复合外键 (organization_id, id, primary_name_id) → person_name(organization_id, person_id, id)）
// 5. merged_into_id 指向自己 → 23514
// 6. RLS：A 组织的人查不到 B 组织的 person（空数组）；viewer 写 person → 42501；editor 写 → 成功
// 7. 枚举↔CHECK 一致：readCheckConstraintValues(sql,'person','ck_person_sex') 等于 [...PERSON_SEX_VALUES].sort()
//    （person_name 的 name_type、living_status、privacy_level、name_status 同样各一条）
// 8. 租户列不可变：update person set project_id = <另一个 project> → 42501
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:integration tests/integration/fact-person.test.ts`
Expected: FAIL，`relation "person" does not exist`。

- [ ] **Step 3: 写 `lib/db/schema/person.ts`**

`persons` 的约束与索引（Drizzle 能表达的写在 schema 里，表达不了的进 0017）：

- `foreignKey` 三列：`(organization_id, project_id)` → `project(organization_id, id)` `ON DELETE restrict`；`(organization_id, project_id, merged_into_id)` → `persons(organization_id, project_id, id)` `ON DELETE restrict`
- `unique('uk_person_organization_project_id').on(t.organizationId, t.projectId, t.id)`
- `uniqueIndex('uk_person_legacy_node').on(t.organizationId, t.projectId, t.legacyNodeId).where(sql\`deleted_at is null and legacy_node_id is not null\`)`
- `index('idx_person_project').on(t.organizationId, t.projectId, t.deletedAt)`
- `index('idx_person_merged').on(t.organizationId, t.projectId, t.mergedIntoId)`（复合外键子侧索引）
- `check('ck_person_sex', sql\`sex in ('male','female','other','unknown')\`)`，其余枚举同理
- `check('ck_person_not_self_merged', sql\`merged_into_id is distinct from id\`)`

`personNames` 的约束与索引：

- `foreignKey`：`(organization_id, project_id, person_id)` → `persons(organization_id, project_id, id)`
- `unique('uk_person_name_organization_person_id').on(t.organizationId, t.personId, t.id)`（供 `persons.primary_name_id` 的复合外键引用）
- `uniqueIndex('uk_person_name_type_order').on(t.organizationId, t.personId, t.nameType, t.sortOrder).where(sql\`deleted_at is null\`)`
- `index('idx_person_name_person').on(t.organizationId, t.personId, t.sortOrder)`
- `check('ck_person_name_custom_type', sql\`name_type <> 'other' or custom_type is not null\`)`

**不要**给 `personNames.full_name` 建 trgm 索引（ADR 0011）。

- [ ] **Step 4: 生成迁移并人工 review**

Run: `pnpm db:generate`
Expected: 生成 `lib/db/migrations/0016_*.sql` 与 `meta/0016_snapshot.json`，journal 追加 idx 16。

逐行读生成的 SQL，确认：只有两张 `CREATE TABLE` 与它们的约束/索引；没有出现对既有 11 张表的任何 `ALTER`/`DROP`。**如果有，说明 Task 1 的搬移改动了 schema 表达，回到 Task 1 修。**

- [ ] **Step 5: 写 0017 手写迁移**

创建 `lib/db/migrations/0017_fact_person_rls.sql`：

1. `ALTER TABLE person ENABLE ROW LEVEL SECURITY; ALTER TABLE person FORCE ROW LEVEL SECURITY;`（`person_name` 同样）
2. 每张表三条 policy（`person_select`/`person_insert`/`person_update`，`person_name_*` 同理），照蓝图 §7.4 的模板
3. `GRANT SELECT, INSERT, UPDATE ON person, person_name TO app_rw;`
4. 租户列不可变触发器：`trg_person_tenant_immutable` 传 `'organization_id', 'project_id'`；`trg_person_name_tenant_immutable` 同样
5. `persons.primary_name_id` 的复合外键（生成式无法表达循环引用）：
   `ALTER TABLE person ADD CONSTRAINT fk_person_primary_name FOREIGN KEY (organization_id, id, primary_name_id) REFERENCES person_name (organization_id, person_id, id) ON DELETE restrict;`
   加之前先 `ALTER TABLE person DROP CONSTRAINT IF EXISTS fk_person_primary_name;`
6. 子侧索引：`CREATE INDEX IF NOT EXISTS idx_person_primary_name ON person (organization_id, id, primary_name_id);`

然后追加 journal 条目 `{"idx": 17, "version": "7", "when": <ms>, "tag": "0017_fact_person_rls", "breakpoints": true}`。

- [ ] **Step 6: 更新既有测试的三处清单**

- `tests/helpers/db.ts` 的 `resetDatabase()` TRUNCATE 清单加 `person, person_name`（`RESTART IDENTITY CASCADE` 不要求顺序，但请放在 `node` 之后、`organization` 之前，便于阅读）
- `tests/integration/migrations.test.ts` 的 public 表清单 `toEqual([...])` 加 `person`、`person_name`（**保持字母序**）
- 同文件 `expect(rows).toHaveLength(15)` → `17`
- 同文件索引清单 `arrayContaining` 加 `uk_person_organization_project_id`、`uk_person_name_type_order`

- [ ] **Step 7: 加工厂函数**

在 `tests/helpers/factories.ts` 追加 `createPerson` 与 `createPersonName`，照 `createNode`（`:160`）的写法：用 `getTestDb()` 直接 insert、自动生成可读的默认值、返回插入的行。`createPerson` 默认 `sex: 'male'`、`livingStatus: 'unknown'`、`privacyLevel: 'private'`、`nameStatus: 'known'`。

- [ ] **Step 8: 跑测试确认通过**

Run: `pnpm test:integration tests/integration/fact-person.test.ts tests/integration/migrations.test.ts`
Expected: 两个文件全绿。

- [ ] **Step 9: 全量验证并提交**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm test:integration && pnpm arch:check`
Expected: 全绿。

```bash
git add lib/db/schema/person.ts lib/db/schema/index.ts lib/db/migrations \
  tests/helpers/db.ts tests/helpers/factories.ts tests/integration/migrations.test.ts \
  tests/integration/fact-person.test.ts
git commit -m "feat(db): add person and person_name tables with RLS and composite keys"
```

---

### Task 5: `family` / `family_partner` / `family_child`

**Files:**
- Create: `lib/db/schema/family.ts`
- Modify: `lib/db/schema/index.ts`、`lib/db/schema/project.ts`（加一列，见 Step 3b）
- Create: `lib/db/migrations/0018_<生成>.sql`、`lib/db/migrations/0019_fact_family_rls.sql`
- Modify: `lib/db/migrations/meta/_journal.json`、`tests/helpers/db.ts`、`tests/integration/migrations.test.ts`、`tests/helpers/factories.ts`
- Test: `tests/integration/fact-family.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `persons`、Task 2 的触发器函数、Task 3 的枚举。
- Produces: `families`、`familyPartners`、`familyChildren`；类型 `Family`、`NewFamily`、`FamilyPartner`、`NewFamilyPartner`、`FamilyChild`、`NewFamilyChild`。列：
  - `families`：`id`、`organization_id`、`project_id`、`union_type`（varchar(20) not null default `'unknown'`）、`sort`（integer not null default 0）、`notes`（text 可空）、审计列
  - `familyPartners`：`id`、`organization_id`、`project_id`、`family_id`、`person_id`、`role`（`blood|spouse`）、`partner_order`（smallint not null default 1）、`status`（varchar(20) not null default `'unknown'`）、审计列
  - `familyChildren`：`id`、`organization_id`、`project_id`、`family_id`、`person_id`、`parentage_type`（varchar(20) not null default `'birth'`）、`is_primary`（bool not null default true）、`sort`（integer not null default 0）、审计列
  - 工厂：`createFamily`、`createFamilyPartner`、`createFamilyChild`

- [ ] **Step 1: 写失败测试**

创建 `tests/integration/fact-family.test.ts`，至少覆盖：

```ts
// 1. 一个 family 可以只有一个 blood partner（入赘/母系/母亲未知）
// 2. 一个 family 不能有两个 role='blood' 的 partner → 23514（触发器，见 Step 6）
// 2b. 把 project.allow_consanguineous_marriage 置 true 后，同一个 family 可以有两个 blood partner → 成功
// 3. 同一个 family 下同一 person 不能有两条 partner → 23505
// 4. 同一个 family 下同一 person 可以有多条 family_child（兼祧/过继）→ 成功
// 5. family_partner.person_id 指向另一个 project 的 person → 23503（复合外键）
// 6. 并发插两个 blood partner：两个事务先后提交时第二个必须失败（advisory lock 生效）
//    —— 用两个 postgres 连接手动 BEGIN/COMMIT，断言第二个抛 23514 或序列化失败
// 7. RLS：跨组织读为空；viewer 写 → 42501；editor 写 → 成功
// 8. 枚举↔CHECK：ck_family_partner_role 等三条
// 9. 租户列不可变：update family set project_id = ... → 42501
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:integration tests/integration/fact-family.test.ts`
Expected: FAIL，`relation "family" does not exist`。

- [ ] **Step 3: 写 `lib/db/schema/family.ts`**

三张表都带 `unique('uk_<table>_organization_project_id').on(organizationId, projectId, id)`、三列复合外键（`family_id` → `family`、`person_id` → `person`）、软删部分唯一索引、`organization_id` 打头的索引。

- `familyPartners`：`uniqueIndex('uk_family_partner_family_person').on(organizationId, familyId, personId).where(sql\`deleted_at is null\`)`
- `familyChildren`：`uniqueIndex('uk_family_child_family_person').on(organizationId, familyId, personId).where(sql\`deleted_at is null\`)`；`index('idx_family_child_person').on(organizationId, projectId, personId)`
- 每张表的 `role`/`status`/`parentage_type`/`union_type` 各一条 `check`

- [ ] **Step 4: 给 `project` 加 `allow_consanguineous_marriage`**

蓝图 §8.2 要求 `project` 增加这一列，而"血亲侧只能有一个"的放宽条件正是它——所以它必须与 Task 5 的触发器同批上线，否则触发器只能无条件收紧（堂兄妹婚在旧谱里真实存在，评审 §7 C5）。

在 `lib/db/schema/project.ts` 的 `projects` 表定义里加：

```ts
allowConsanguineousMarriage: boolean('allow_consanguineous_marriage').notNull().default(false),
```

**不要**同时加 `default_calendar`——它属于时间层，跟 `era` 一起在 P4 落地（蓝图 §8.2 的另一列）。加完后 `tests/integration/projects.test.ts` 必须照常通过（默认 `false`，无行为变化）。

- [ ] **Step 5: 生成迁移并 review**

Run: `pnpm db:generate`
Expected: 生成 `0018_*.sql` + `meta/0018_snapshot.json`，journal idx 18。review 时确认：三张 `CREATE TABLE`；`ALTER TABLE project ADD COLUMN allow_consanguineous_marriage boolean NOT NULL DEFAULT false`（只有这一条 ALTER，且不触碰 `person`/`person_name`）。

- [ ] **Step 6: 写 0019 手写迁移（RLS + 血亲侧不变量）**

`0019_fact_family_rls.sql` 内容：

1. 三张表 `ENABLE` + `FORCE` RLS、每张三条 policy、`GRANT SELECT, INSERT, UPDATE ... TO app_rw`
2. 租户列不可变触发器（传 `'organization_id', 'project_id'`）
3. **血亲侧不变量触发器** `app.check_family_blood_side()`：

```sql
CREATE OR REPLACE FUNCTION app.check_family_blood_side() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  blood_count integer;
  allow_consanguineous boolean;
BEGIN
  IF NEW.role <> 'blood' OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.allow_consanguineous_marriage INTO allow_consanguineous
  FROM public.project p
  WHERE p.id = NEW.project_id;

  IF allow_consanguineous THEN
    RETURN NEW;   -- 谱系级放开了族内婚（堂兄妹婚），允许多个血亲侧
  END IF;

  -- 同一 family 的并发写入必须串行，否则两个事务各插一个 blood partner 都能通过
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.organization_id::text || ':' || NEW.family_id::text, 0));

  SELECT count(*) INTO blood_count
  FROM public.family_partner
  WHERE organization_id = NEW.organization_id
    AND family_id = NEW.family_id
    AND role = 'blood'
    AND deleted_at IS NULL
    AND id <> NEW.id;

  IF blood_count >= 1 THEN
    RAISE EXCEPTION 'family % already has a blood partner', NEW.family_id
      USING ERRCODE = '23514',
            HINT = 'set project.allow_consanguineous_marriage to allow consanguineous unions';
  END IF;
  RETURN NEW;
END;
$$;
```

触发器 `trg_family_partner_blood_side`：`BEFORE INSERT OR UPDATE ON family_partner FOR EACH ROW`。

三处容易写错、必须按上面这段抄的地方：

1. **判据是 `blood_count >= 1` 不是 `> 1`**。INSERT 时 `NEW` 还不在表里，`id <> NEW.id` 排除的是 UPDATE 的自己；已有一个血亲侧时再插第二个，`blood_count = 1`，用 `> 1` 会放行——这正是这段代码最容易写成"看起来对"的地方。
2. **`allow_consanguineous` 为真时直接返回**，连 advisory lock 都不拿（多血亲侧本来就没有串行化需求）。
3. **软删的血亲侧不计入**（`deleted_at IS NULL`）：解除婚配是置 `deleted_at`，不是物理删。

**为什么只管上界、不管下界**：蓝图 §9.3 要求每个 family 至少一个 blood partner，但"至少一个"在 INSERT 时无法检查（先插 spouse 后插 blood 是合法中间态，UPDATE 时才成立）。P1 只强制上界，下界由回填脚本与将来的检查器（`validation_issue`，P9）负责。这段理由要写进 SQL 注释，否则后人会以为是漏了约束。

- [ ] **Step 7: 更新三处清单 + 工厂**

照 Task 4 Step 6/7：`resetDatabase()` 加 `family, family_partner, family_child`；`migrations.test.ts` 表清单加三项（字母序）、`toHaveLength(17)` → `20`、索引清单加 `uk_family_child_family_person`、`uk_family_partner_family_person`；`factories.ts` 加三个工厂。

- [ ] **Step 8: 跑测试确认通过**

Run: `pnpm test:integration tests/integration/fact-family.test.ts tests/integration/migrations.test.ts`
Expected: 全绿。并发用例（第 6 条）必须真的并发——两个 `postgres(url, { max: 1 })` 连接各自 `BEGIN`，第一个插入但不提交，第二个插入应当**阻塞**，第一个提交后第二个抛 23514。

- [ ] **Step 9: 全量验证并提交**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm test:integration && pnpm arch:check`

```bash
git add lib/db/schema/family.ts lib/db/schema/index.ts lib/db/migrations \
  tests/helpers/db.ts tests/helpers/factories.ts tests/integration/migrations.test.ts \
  tests/integration/fact-family.test.ts
git commit -m "feat(db): add family, family_partner and family_child tables"
```

---

### Task 6: `event`

**Files:**
- Create: `lib/db/schema/event.ts`
- Modify: `lib/db/schema/index.ts`
- Create: `lib/db/migrations/0020_<生成>.sql`、`lib/db/migrations/0021_fact_event_rls.sql`
- Modify: `lib/db/migrations/meta/_journal.json`、`tests/helpers/db.ts`、`tests/integration/migrations.test.ts`、`tests/helpers/factories.ts`
- Test: `tests/integration/fact-event.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `persons`、Task 5 的 `families`、Task 3 的 `EVENT_KIND_VALUES`/`EVENT_TYPE_VALUES`/`DATE_*`。
- Produces: `events`；类型 `Event`、`NewEvent`。列：`id`、`organization_id`、`project_id`、`person_id`（可空）、`family_id`（可空）、`event_kind`、`event_type`、`custom_type`、`gedcom_tag`、`title`、`value`、`description`、`date_original`（**not null**）、`date_start`、`date_end`（`date` 类型）、`date_precision`、`date_qualifier`、`calendar`、`date_cn`（jsonb）、`age_text`、`age_years`（smallint）、`age_basis`、`place_original`、审计列。工厂 `createEvent`。

**P1 的主体是二选一**：`placement_id` 与 `subject_type` 的第三值属于 P2（`person_placement` 那时才存在），P2 的迁移会 drop 本 Task 的 CHECK 与生成列并重建。**这不是遗漏，是分期**——在 SQL 注释里写明。

- [ ] **Step 1: 写失败测试**

创建 `tests/integration/fact-event.test.ts`，至少覆盖：

```ts
// 1. person_id 与 family_id 同时为空 → 23514（ck_event_subject_exactly_one）
// 2. person_id 与 family_id 同时非空 → 23514
// 3. date_original 为 null → 23514
// 4. 'before 1691'：date_start=null, date_end='1691-01-01', qualifier='before' → 成功
//    'before 1691' 带 date_start → 23514
// 5. 'after 1691'：date_start 非空、date_end 为空 → 成功；带 date_end → 23514
// 6. qualifier='unknown' 且 start/end 都为空 → 成功；带任一 → 23514
// 7. qualifier='exact' 且 start > end → 23514
// 8. qualifier='exact' 且 date_end 为空 → 23514
// 9. age_years 有值但 age_basis 为空 → 23514；反之亦然
// 10. event_type='custom' 且 custom_type 为空 → 23514
// 11. event_type 不在 EVENT_TYPE_VALUES 里 → 23514
// 12. RLS 三条 + 租户列不可变
// 13. 枚举↔CHECK：ck_event_type 的值集合 == [...EVENT_TYPE_VALUES].sort()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:integration tests/integration/fact-event.test.ts`
Expected: FAIL，`relation "event" does not exist`。

- [ ] **Step 3: 写 `lib/db/schema/event.ts`**

Drizzle 里表达：三列复合外键（`person_id` → `persons`、`family_id` → `families`，两者都 `ON DELETE restrict`）、`unique('uk_event_organization_project_id')`、软删索引 `idx_event_subject (organization_id, project_id, person_id, date_start)`、`idx_event_family (organization_id, project_id, family_id)`、`idx_event_type (organization_id, project_id, event_type)`、`check('ck_event_subject_exactly_one', sql\`num_nonnulls(person_id, family_id) = 1\`)`、`check('ck_event_custom_type', sql\`event_type <> 'custom' or custom_type is not null\`)`、`check('ck_event_age_pair', sql\`(age_years is null) = (age_basis is null)\`)`。

- [ ] **Step 4: 生成迁移并 review**

Run: `pnpm db:generate`
Expected: `0020_*.sql` + `meta/0020_snapshot.json`，journal idx 20。

- [ ] **Step 5: 写 0021 手写迁移（RLS + 日期五条 CHECK + 枚举 CHECK）**

`0021_fact_event_rls.sql`：RLS 三件套 + GRANT + 租户列不可变触发器，再加下面这些（生成式不会产出它们，因为 `date_qualifier` 的组合语义要靠手写）：

```sql
ALTER TABLE event DROP CONSTRAINT IF EXISTS ck_event_date_original;
ALTER TABLE event ADD CONSTRAINT ck_event_date_original
  CHECK (date_original IS NOT NULL);

-- exact / about / estimated / calculated：两端都必填且有序
ALTER TABLE event DROP CONSTRAINT IF EXISTS ck_event_date_point;
ALTER TABLE event ADD CONSTRAINT ck_event_date_point
  CHECK (date_qualifier NOT IN ('exact','about','estimated','calculated')
         OR (date_start IS NOT NULL AND date_end IS NOT NULL AND date_start <= date_end));

-- before：只有上界
ALTER TABLE event DROP CONSTRAINT IF EXISTS ck_event_date_before;
ALTER TABLE event ADD CONSTRAINT ck_event_date_before
  CHECK (date_qualifier <> 'before' OR (date_start IS NULL AND date_end IS NOT NULL));

-- after：只有下界
ALTER TABLE event DROP CONSTRAINT IF EXISTS ck_event_date_after;
ALTER TABLE event ADD CONSTRAINT ck_event_date_after
  CHECK (date_qualifier <> 'after' OR (date_start IS NOT NULL AND date_end IS NULL));

-- between / period：明确区间
ALTER TABLE event DROP CONSTRAINT IF EXISTS ck_event_date_between;
ALTER TABLE event ADD CONSTRAINT ck_event_date_between
  CHECK (date_qualifier NOT IN ('between','period')
         OR (date_start IS NOT NULL AND date_end IS NOT NULL AND date_start <= date_end));

-- unknown：只有原文
ALTER TABLE event DROP CONSTRAINT IF EXISTS ck_event_date_unknown;
ALTER TABLE event ADD CONSTRAINT ck_event_date_unknown
  CHECK (date_qualifier <> 'unknown' OR (date_start IS NULL AND date_end IS NULL));
```

`ck_event_type` 的取值集合必须**逐字**来自 `lib/genealogy/constants.ts` 的 `EVENT_TYPE_VALUES`（Step 1 的第 13 条测试会强制这一点）。

- [ ] **Step 6: 更新三处清单 + 工厂**

`resetDatabase()` 加 `event`；`migrations.test.ts` 表清单加 `event`、`toHaveLength(20)` → `21`；`factories.ts` 加 `createEvent`。

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm test:integration tests/integration/fact-event.test.ts tests/integration/migrations.test.ts`
Expected: 全绿。

- [ ] **Step 8: 全量验证并提交**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm test:integration && pnpm arch:check && pnpm docs:check --strict`

```bash
git add lib/db/schema/event.ts lib/db/schema/index.ts lib/db/migrations \
  tests/helpers/db.ts tests/helpers/factories.ts tests/integration/migrations.test.ts \
  tests/integration/fact-event.test.ts
git commit -m "feat(db): add event table with date-boundary constraints"
```

---

### Task 7: 回填脚本（`node` → 事实层）

**Files:**
- Create: `lib/db/backfill/fact-layer.ts`
- Create: `data/backfill-fact-layer.ts`
- Modify: `package.json`、`tests/helpers/factories.ts`
- Test: `tests/integration/fact-backfill.test.ts`

**Interfaces:**
- Consumes: Task 4/5/6 的六张表；`tests/helpers/factories.ts` 的 `createOrganization`/`createProject`/`createLineage`/`createNode`（测试用）。
- Produces:

```ts
// lib/db/backfill/fact-layer.ts
import type { Sql } from 'postgres';

export type LossReport = {
  unknownMother: number;   // 父有多个配偶，子女挂到 family(父, null)
  noMotherAtAll: number;   // 父无配偶
  emptyFullName: number;   // full_name 为空的节点，落成 name_status='unknown'
  birthTextWithoutYear: number;
  deathTextWithoutYear: number;
};

export type BackfillResult = {
  organizationId: string;
  persons: number;
  personNames: number;
  families: number;
  familyPartners: number;
  familyChildren: number;
  events: number;
  lossReport: LossReport;
};

export class FactLayerAlreadyBackfilledError extends Error {}

/**
 * 把一个组织的 node 存量搬进事实层。单个事务；进入前若该组织已有 person 行则抛
 * FactLayerAlreadyBackfilledError（重跑 = 失败即回滚，不需要幂等写逻辑）。
 */
export async function backfillFactLayer(
  sql: Sql,
  organizationId: string
): Promise<BackfillResult>;
```

- [ ] **Step 1: 扩展 `createNode` 工厂**

现有 `createNode`（`tests/helpers/factories.ts:160`）只接受 `orgId`/`lineageId`/`createdBy`/`parentId`/`spouseOfId`/`role`/`path`/`depth`/`generation`/`sort`/`name`/`surname`/`sex`，而下面的用例需要生卒原文与年份、葬地、字号、软删。给它加可选参数 `birthYear?: number | null`、`birthText?: string | null`、`deathYear?: number | null`、`deathText?: string | null`、`burialPlace?: string | null`、`courtesy?: string | null`、`isAlive?: boolean`、`fullName?: string | null`、`deletedAt?: Date | null`，透传给 insert；**不要改任何现有默认值**（`fullName` 仍默认 `surname + name`），否则既有测试会变。注意 `generation` 是必填参数、`path` 决定 `depth`（`ck_node_depth_eq_level`），造树时要显式给。

- [ ] **Step 2: 写失败测试**

创建 `tests/integration/fact-backfill.test.ts`：

```ts
// 1. 造一棵树：始祖（血亲）→ 两个儿子（血亲）→ 其中一个儿子带配偶 → 再带一个孙辈
//    跑 backfillFactLayer，断言返回计数：persons=5、familyPartners=...、familyChildren=2
// 2. 跑 reconcileFactLayer，断言 report.diffs 为空数组
// 3. 再跑一次 backfillFactLayer，断言抛 FactLayerAlreadyBackfilledError 且 person 行数不变
// 4. 父有多个配偶：造父 + 两个配偶 + 一个子女
//    断言子女挂到 family(父, null)（family_partner 只有 1 行），lossReport.unknownMother === 1
// 5. birth_text='约光绪二十年'（无 birth_year）：断言 event 的 qualifier='unknown'、start/end 为 null
// 6. birth_year=1900（无 birth_text）：断言 date_original='1900'、start='1900-01-01'、end='1900-12-31'、
//    precision='year'、qualifier='exact'
// 7. burial_place 非空：断言生成 event_type='burial' 且 place_original 保留原文
// 8. 已软删的 node：断言对应 person 的 deleted_at 非空，且 family_child 边不被创建
// 9. courtesy 非空：断言多出一条 name_type='courtesy' 的 person_name
// 10. person.primary_name_id 指向 name_type='birth' 的那条
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test:integration tests/integration/fact-backfill.test.ts`
Expected: FAIL，`Cannot find module '@/lib/db/backfill/fact-layer'`。

- [ ] **Step 4: 实现 `backfillFactLayer`**

结构（不要一次写成一个巨型函数，按下面四步分开，每步一个私有函数，便于测试报错定位）：

1. **预检**：`BEGIN`；`SELECT count(*) FROM person WHERE organization_id = $1` 非 0 → `ROLLBACK` + 抛 `FactLayerAlreadyBackfilledError`。
2. **建 person + person_name**：`INSERT INTO person (...) SELECT ... FROM node JOIN lineage ON lineage.id = node.lineage_id WHERE node.organization_id = $1`，映射：
   - `sex`：`node.sex = 0 → 'male'`、`1 → 'female'`（仓库语义：0=男、1=女，见 `components/lineage/person-inspector.tsx:213`）
   - `living_status`：`is_alive = true → 'living'`、`false → 'deceased'`、`null` 不可能（`node.is_alive` not null）
   - `privacy_level`：`living → 'private'`、`deceased → 'public'`
   - `name_status`：`full_name` 为空 → `'unknown'`，否则 `'known'`
   - `legacy_node_id = node.id`、`created_by = node.created_by`、`deleted_at = node.deleted_at`
   - `person_name`：主名 `name_type='birth'`、`full_name=node.full_name`、`surname=node.surname`、`given_name=node.name`、`name_prefix=node.name_prefix`、`sort_order=0`；`courtesy` 非空时再插一条 `name_type='courtesy'`、`sort_order=1`
   - 最后 `UPDATE person SET primary_name_id = (SELECT id FROM person_name WHERE ... name_type='birth')`
3. **建 family + partner + child**：按蓝图 §19.2 的三条规则。血亲节点 P：
   - 配偶集合 S = `node where spouse_of_id = P.id and role='spouse' and deleted_at is null`
   - `|S| = 1` → 一个 family，partners = `(P, blood, 1)` + `(S1, spouse, 1)`
   - `|S| > 1` → 每个配偶各一个 family（`(P, blood, 1)` + `(Si, spouse, i)`），**另外**一个 `family(P, null)` 专供子女（`lossReport.unknownMother += 子女数`）
   - `|S| = 0` 且有子女 → 一个 `family(P, null)`（`lossReport.noMotherAtAll += 子女数`）
   - `|S| = 0` 且无子女 → 不建 family
   - 子女 C（`node.parent_id = P.id`）挂到上述"供子女的那个 family"，`parentage_type='birth'`、`is_primary=true`、`sort=C.sort`
4. **建 event**：`birth`（`birth_text`/`birth_year` 至少一个非空）、`death`（同）、`burial`（`burial_place` 非空，只写 `place_original`，日期留空 → `date_qualifier='unknown'`、`date_original=burial_place`）。年份映射：`start = make_date(year,1,1)`、`end = make_date(year,12,31)`、`precision='year'`、`qualifier='exact'`；只有原文没有年份 → `start/end` 为空、`qualifier='unknown'`；两者都有 → 年份照上面，`date_original` 保留原文。

全程用 `sql.begin(...)` 包住。**不要**碰 `node` 表（一条 UPDATE 都不许有）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test:integration tests/integration/fact-backfill.test.ts`
Expected: 用例 1–10 中除对账（用例 2）外全部 PASS。

- [ ] **Step 6: 写 CLI**

`data/backfill-fact-layer.ts`：读 `POSTGRES_URL_DIRECT ?? POSTGRES_URL_NON_POOLING ?? POSTGRES_URL`（用 `../scripts/load-env.mjs` 的 `loadEnv()`），先断言 `rolsuper or rolbypassrls` 为真（否则退出码 1 并打印原因），再按 `--org <uuid>` 或"遍历全部 organization"逐个调用 `backfillFactLayer`，每个组织打印一行 JSON（`{ organizationId, persons, families, lossReport }`），最后打印汇总。参数缺失时打印用法并退出码 2。

`package.json` 加：

```json
"data:backfill:fact": "npx tsx data/backfill-fact-layer.ts",
"data:reconcile:fact": "npx tsx data/reconcile-fact-layer.ts"
```

- [ ] **Step 7: 提交**

```bash
git add lib/db/backfill/fact-layer.ts data/backfill-fact-layer.ts package.json \
  tests/integration/fact-backfill.test.ts
git commit -m "feat(db): backfill node data into the fact layer"
```

---

### Task 8: 对账脚本与零差异验收

**Files:**
- Create: `lib/db/backfill/reconcile-fact-layer.ts`
- Create: `data/reconcile-fact-layer.ts`
- Test: `tests/integration/fact-backfill.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 7 的回填结果。
- Produces:

```ts
// lib/db/backfill/reconcile-fact-layer.ts
export type ReconcileDiff = { check: string; expected: number; actual: number };
export type ReconcileReport = {
  organizationId: string;
  diffs: ReconcileDiff[];
  checked: string[];   // 实际跑过的检查项名字，供测试断言覆盖面
};
export async function reconcileFactLayer(
  sql: Sql,
  organizationId: string
): Promise<ReconcileReport>;
```

- [ ] **Step 1: 追加失败测试**

在 `tests/integration/fact-backfill.test.ts` 追加：

```ts
it('reconciles every fact-layer count against node', async () => {
  // ...回填之后...
  const report = await reconcileFactLayer(getTestSql(), org.id);
  expect(report.diffs).toEqual([]);
  expect(report.checked.sort()).toEqual([
    'birth_events', 'burial_events', 'child_edges', 'courtesy_names',
    'death_events', 'families', 'partners', 'persons', 'primary_names',
  ]);
});

it('detects a tampered fact-layer row', async () => {
  // 回填后手动软删一条 family_child，再对账 → diffs 里必须出现 child_edges
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:integration tests/integration/fact-backfill.test.ts`
Expected: FAIL，`Cannot find module '@/lib/db/backfill/reconcile-fact-layer'`。

- [ ] **Step 3: 实现九个检查项**

每条检查是一个 `{ name, expectedSql, actualSql }`，两边都 `count(*)`，不等就 push 进 `diffs`：

| check | expected（`node` 侧） | actual（事实层侧） |
|---|---|---|
| `persons` | `count(*) from node where organization_id=$1` | `count(*) from person where organization_id=$1` |
| `primary_names` | `count(*) from node where organization_id=$1` | `count(*) from person_name where organization_id=$1 and name_type='birth'` |
| `courtesy_names` | `count(*) from node where organization_id=$1 and courtesy is not null` | `count(*) from person_name where organization_id=$1 and name_type='courtesy'` |
| `families` | 见下 | `count(*) from family where organization_id=$1` |
| `partners` | `count(*) from node where organization_id=$1` | `count(*) from family_partner where organization_id=$1`（每个 node 恰好一个 partner 位次） |
| `child_edges` | `count(*) from node where organization_id=$1 and parent_id is not null` | `count(*) from family_child where organization_id=$1` |
| `birth_events` | `count(*) from node where organization_id=$1 and (birth_text is not null or birth_year is not null)` | `count(*) from event where organization_id=$1 and event_type='birth'` |
| `death_events` | 同 birth 形状 | `event_type='death'` |
| `burial_events` | `count(*) from node where organization_id=$1 and burial_place is not null` | `event_type='burial'` |

`families` 的 expected 用与 Task 7 Step 3 完全相同的分档逻辑（一条 SQL 复刻：`|S|=1` 计 1、`|S|>1` 计 `|S|+1`、`|S|=0` 且有子女计 1、否则 0）。**两处逻辑必须一致**——对账就是靠"两套独立实现的数字相等"证明回填没错，所以 SQL 要重写一遍，不要从回填脚本里 import 同一个函数。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:integration tests/integration/fact-backfill.test.ts`
Expected: 全绿（含"篡改检测"用例）。

- [ ] **Step 5: 写对账 CLI**

`data/reconcile-fact-layer.ts`：与回填 CLI 同样的连接与权限检查；逐个组织打印差异表（`check / expected / actual`），**任何 diff 非空则以退出码 1 结束**，全零则打印 `reconcile ok: N organizations` 并退出 0。

- [ ] **Step 6: 在真实开发库上跑一遍**

Run: `pnpm data:backfill:fact && pnpm data:reconcile:fact`
Expected: 对账输出 `reconcile ok`，退出码 0。把 `lossReport` 的数字记进 Task 9 的文档。

- [ ] **Step 7: 提交**

```bash
git add lib/db/backfill/reconcile-fact-layer.ts data/reconcile-fact-layer.ts \
  tests/integration/fact-backfill.test.ts
git commit -m "feat(db): reconcile the fact layer against node with a zero-diff gate"
```

---

### Task 9: 文档同步与收尾

**Files:**
- Modify: `docs/data-model.md`、`docs/implementation-status.md`、`docs/superpowers/specs/2026-10-29-genealogy-data-model-blueprint-design.md`（§21 打勾）、`AGENTS.md`（如需）

**Interfaces:**
- Consumes: Task 1–8 的全部产出
- Produces: 无代码接口

- [ ] **Step 1: 更新数据字典**

`docs/data-model.md` 加六张表的条目（列、约束、索引、RLS），格式照现有 `node` 条目。同时补两条约定：租户列不可变（ADR 0016）、`data/` 脚本的权限要求（BYPASSRLS）。

- [ ] **Step 2: 更新实现状态**

`docs/implementation-status.md` 记：P0 完成（schema 已拆成 `lib/db/schema/`，F6 豁免降到 7 条）、P1 落库完成（六张表 + 回填 + 对账，`node` 仍是读源，读写切换未做）。

- [ ] **Step 3: 蓝图打勾**

蓝图 §21 的 P0 行与 P1 行标注"已落地（计划 `2026-10-29-p0-p1-schema-split-and-fact-layer.md`）"，并写明 P1 的读写切换仍在待办。

- [ ] **Step 4: 全量验证**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm test:integration && pnpm arch:check && pnpm docs:check --strict`
Expected: 全绿；`arch:check` 显示 F6 豁免 7 条、0 violation。

- [ ] **Step 5: 提交**

```bash
git add docs AGENTS.md
git commit -m "docs: record P0/P1 fact-layer landing and tenant immutability"
```

---

## Self-Review

**1. Spec coverage（本计划范围内的蓝图条目 → Task）**

| 蓝图条目 | Task |
|---|---|
| §7.1 键粒度按层（事实层三列键） | 4、5、6 |
| §7.2 全部软删 | 4、5、6 |
| §7.3 部分唯一索引 | 4、5、6 |
| §7.4 RLS 三段式 + FORCE | 4、5、6（各自的手写迁移） |
| §7.5 租户列不可变（P0） | 2 |
| §7.6 枚举 + 一致性测试 | 3、4、5、6 |
| §7.8 索引纪律（`organization_id` 打头、子侧索引） | 4、5、6 |
| §7.9 并发（advisory lock） | 5 Step 5 |
| §7.10 DDL 幂等 / 手写迁移只追加 journal | 2、4、5、6 |
| §7.11 schema 拆分 + 查询按域拆（前半） | 1（后半属下一份计划） |
| §9.1 `person` 归 `project` | 4 |
| §9.2 姓名全进 `person_name` + `primary_name_id` | 4 |
| §8.2 `project.allow_consanguineous_marriage` | 5（Step 4） |
| §9.3 `family`/`family_partner`/`family_child` + 血亲侧条件式上界 | 5 |
| §9.4 软删 + 有存活子女拒绝删除 | 5（软删）；"拒绝删除"门槛属写路径，下一份计划 |
| §11.1 `event` 主体二选一（P1 部分） | 6 |
| §11.2 日期五条 CHECK | 6 |
| §11.3 农历只存原文 | 6（`date_cn` 列）+ 7（原文不丢） |
| §11.4 `place`（P3） | 本计划不做（`event.place_original` 已够回填） |
| §17.1 在世判定字段 | 4（`living_status` + `living_status_locked`）；推断函数属 P9 |
| §19.1 映射表 | 7 |
| §19.2 信息损失申报 | 7（`lossReport`） |
| §19.3 回填/对账两步 | 7、8 |
| §21 P0、P1 | 1–9 |
| §22 ADR 0016 | 2 Step 7 |

**缺口（有意为之，均照蓝图 §21 的排期）**：

- `event_participant`（§11.1）排在 **P4**，与 `place_name`、`era` 一起；P1 的 `event` 只记主体与日期。
- `event.place_id`（§11.4）排在 **P3**，因为 `place` 表那时才建；P1 只保留 `place_original` 原文列。
- `event.placement_id` 与 `subject_type` 生成列（§11.1）排在 **P2**，因为 `person_placement` 那时才存在。P1 的 CHECK 是 `num_nonnulls(person_id, family_id) = 1`，P2 的迁移会 drop 它并换成三值版本——这是**分期而非遗漏**，SQL 注释里必须写明，否则后来的人会以为是漏了一列。
- `person_association`（§9.5）排在 **P6**；`person_placement`（§10）排在 **P2**，本计划完全不碰位次层。
- `person.legacy_biography`（§19.1）P1 不迁，P9 建 `note` 时一次性迁入。

**2. Step scan**

每个 Step 都能让实现者写出恰好一件事：测试步骤给了用例名与断言值；实现步骤给了签名、列清单、约束清单；验证步骤给了命令与期望输出。没有 "TBD"、"处理边界情况" 这类空话。唯一没有给全的是 `EVENT_TYPE_VALUES` 的完整取值——给了可判定的生成规则（GEDCOM 7 全集 + 5 个中文事件 + `custom`/`other`）与必须包含的 9 个值，因为逐条抄 100 个标签属于把代码写进计划。

**3. Type consistency**

- `uuidPk`/`timestamptz`/`ltree` 在 Task 1 定义、Task 4–6 使用，名字一致。
- 枚举常量名（`PERSON_SEX_VALUES` 等）在 Task 3 定义，Task 4–6 的 `$type<>()` 与 CHECK 使用同一批名字；`readCheckConstraintValues(sql, table, constraintName)` 在 Task 3 定义、Task 4–6 使用，参数顺序一致。
- `backfillFactLayer(sql, organizationId)` 与 `reconcileFactLayer(sql, organizationId)` 签名对称；`BackfillResult`/`LossReport`/`ReconcileReport` 在 Task 7 定义、Task 8 消费、CLI 打印。
- 表导出名：`persons`/`personNames`/`families`/`familyPartners`/`familyChildren`/`events`（TS 复数，照仓库既有约定），SQL 表名 `person`/`person_name`/`family`/`family_partner`/`family_child`/`event`（单数）。

**4. Review Focus 对应的测试**

五条 Review Focus 分别在：① Task 2 Step 1 用例 1；② Task 7 Step 1 用例 4 + Task 8 的 `families` 检查；③ Task 6 Step 1 用例 4–8 + Task 7 Step 1 用例 5、6；④ Task 4 Step 1 用例 1；⑤ Task 5 Step 1 用例 4 与 Task 7 Step 1 用例 8。

**5. Proportion**

蓝图 810 行，本计划 1156 行，比例 1.43——计划比规范长，这是 DDL 类计划的常态（规范说"要有租户列不可变触发器"，计划必须给出触发器的 PL/pgSQL、10 张表的传参表和测试断言），但值得记下来：如果评审时觉得某几段是在把代码搬进文档，优先砍 Task 7/8 的用例清单（那 20 条用例名可以压缩成"覆盖 §19.2 的四种损失 + §11.2 的六种日期形态"）。

26 个代码块，分布：`ts` 12（全部是测试骨架与函数签名，没有业务实现）、`bash` 9（提交命令，不可压缩）、`sql` 3（触发器、日期五条 CHECK、`readCheckConstraintValues` 无关的那段——这三处算法无法从签名推出）、`json` 2（journal 条目、`package.json` 片段）。**没有一处是 `lib/db/schema/` 的完整表定义**：列清单用表格与 `$type<>()` 说明，因为逐列抄 Drizzle 定义既不可评审也不可维护——实现者照着列清单写，drizzle-kit 生成的 SQL 才是准的。

---

## Execution Handoff

计划已保存到 `docs/superpowers/plans/2026-10-29-p0-p1-schema-split-and-fact-layer.md`。

九个 Task 之间有硬依赖（Task 4 依赖 Task 1 的 `shared.ts` 与 Task 2 的触发器；Task 5/6 依赖 Task 4 的 `persons`；Task 7 依赖全部六张表），迁移编号也被顺序锁死——所以**不能并行**，只能顺序执行。

**建议 Subagent-driven**：Task 2、4、5、6 各自包含一个手写 PL/pgSQL 迁移，这类代码的错误往往在"看起来对"的地方（`FOREACH` 的数组、`to_jsonb` 的 NULL 语义、advisory lock 的哈希冲突范围），一个新鲜上下文的评审者比写代码的人更容易看出来；而且每 Task 都要改同一批共享文件（`tests/helpers/db.ts`、`migrations.test.ts`），顺序执行 + 独立评审能把"漏更新一处清单"这类错误挡在 Task 内。
