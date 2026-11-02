# A2.1 生平层（名讳 / 地点 / 事件）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 A1 关系层之上落下「生平层」四张表（`person_name`、`place`、`event`、`event_participant`），把 `node` 上扁平的生卒葬列回填成事件与名讳，让检查器从「一行文本」升级为「可查询的名讳列表 + 生卒时间线」，并顺手补上租户列不可变这一条所有组织级表都缺的兜底。

**Architecture:** 分四层落地。**加固层**先在 custom migration 里给全部组织级表加 `BEFORE UPDATE` 触发器禁止改 `organization_id`；**数据层**四张新表一律 `uuidv7()` 主键、`organization_id` 第一列、`UNIQUE (organization_id, id)` 复合外键目标、`deleted_at` 软删、`FORCE RLS` + 三段式 policy（照 `0001_auth_rls.sql` 的 DO 块模式）；**契约层**新增 `lib/genealogy/person-record-schemas.ts`（Zod）与 `lib/lineage/person-record-actions.ts`（Server Action），因为 `lib/genealogy/schemas.ts`（293 行）与 `lib/lineage/actions.ts`（394 行）都已贴着 F6 的 400 行上限；**读取层**新增三个 query 模块，`NodeView` 增加名讳/事件投影，检查器把扁平生卒区换成两个新面板。回填与对账是 `data/` 下可重复执行的脚本，与迁移分开提交。

**Tech Stack:** Next.js 16 App Router、React 19、Server Actions + `useActionState`、Zod 4、Drizzle ORM 0.45 + PostgreSQL 18（`uuidv7()`、`num_nonnulls`、`NULLS NOT DISTINCT`）、Vitest 单测 + 真实 PostgreSQL 集成测试、Playwright。

**Spec:** [A1 关系层设计](../specs/2026-10-29-person-family-model-design.md)（A2 阶段的表清单见其 §9）＋ [附件模型评审](../../reviews/2026-10-29-data-model-v1.0-review.md)（本文采纳其 §7 决策表中标记「修正后采纳（A2.1）」的三行，并按 §3 的 P0/P1 修法改写）。

## Rulings Carried Into This Plan

- **R1 A1 是硬前置。** `person`/`family`/`family_child`/`person_tree` 与 `lib/db/schema/` 目录拆分必须已经落地；本计划不重复 A1 的表，也不碰关系层。若 A1 未落地，Task 0 会失败并停止——**不要**在本计划里顺手实现 A1。
- **R2 层级不重命名。** 附件的 `genealogy` 在本仓库叫 `project`，`lineage` 就是 `lineage`。新表用 `organization_id` 作租户列、不加 `genealogy_id`；附件的 `genealogy_id` 一律读作 `organization_id`。
- **R3 事件主体二选一，participant 里没有 principal。** `event.person_id` 与 `event.family_id` 用 `CHECK (num_nonnulls(person_id, family_id) = 1)` 互斥，主体本身就是「主角」；`event_participant.role` 只记见证/主婚/媒人/教父/亲属/邻里/其他，从枚举里**删掉** `principal`。附件 `event_scope` 这一列不落库（它与主体外键重复，且能说谎）。
- **R4 日期边界语义写进 CHECK，不做农历转换。** `(date_start, date_end)` 是闭区间边界，`date_qualifier` 决定哪端为空：`exact`/`about`/`estimated`/`calculated`/`range`/`period` 两端非空且 `start <= end`；`before` 只填 `end`；`after` 只填 `start`；无日期时三者同为 NULL。`date_precision` 只影响展示粒度，不改变边界。`date_cn` 只存原文结构（年号/干支/闰月/时辰），**A2.1 不实现农历↔公历换算**（留给 ADR 0015 的后续增量）。
- **R5 不建 trgm 索引。** 名讳搜索继续走 [ADR 0011](../../decisions/0011-search-boundary-node-client-article-trgm.md) 的客户端边界，`person_name` 不建 GIN，也不引入应用维护的 `search_text` 列。
- **R6 编辑面最小。** A2.1 的写路径只覆盖：名讳增删改 + 设为主名、事件增删改、事件参与人增删。地点只读（从事件里选或输入原文），地点管理 UI 与史料层一起做（A2.2）。

## Global Constraints

- 表名用单数 `person_name` / `place` / `event` / `event_participant`；列名 `snake_case`；Drizzle 导出名复数（`personNames` / `places` / `events` / `eventParticipants`）。
- 每张新表必须有：`id uuid primary key default uuidv7()`、`organization_id uuid not null` 作为**第一列**、`UNIQUE (organization_id, id)`（命名 `uk_<table>_organization_id`）、`created_at`/`created_by`/`updated_at`/`deleted_at`。
- 每张新表必须 `ENABLE` **和** `FORCE ROW LEVEL SECURITY`，并写三条 policy（`_select` 四角色 / `_insert` + `_update` 的 owner·admin·editor），照 `lib/db/migrations/0001_auth_rls.sql:490-513` 的 DO 块模式。**不授 DELETE**：`app_rw` 只有 `SELECT, INSERT, UPDATE`（`0001_auth_rls.sql:406`），软删是唯一删除方式。
- 所有查询带 `organization_id`，并走 `withOrg(userId, fn)`；所有写走 `withOrgWrite({ userId, orgId, permission }, fn)`（`lib/db/write.ts`）。
- 单文件 ≤400 行（F6，`scripts/check-file-size.mjs`）。`components/lineage/person-inspector.tsx` 当前 606 行、正好卡在豁免上限，**只能减不能加**。
- 迁移只做 DDL，回填放 `data/`；迁移与业务代码分开提交；手写迁移照 `0013`/`0014` 先例：追加 `meta/_journal.json` 条目、不生成 snapshot。
- 面向用户文案一律简体中文；日志与错误码英文；不把数据库错误抛给 UI。
- 不新增后台任务、队列、定时器（[ADR 0005](../../decisions/0005-zero-background-jobs.md)）；不新增 `process.env` 读取（F7，只允许 `lib/config.ts`）。
- 每个任务结束前 `pnpm check && pnpm typecheck && pnpm test` 全绿；涉及 SQL 的任务补 `pnpm test:integration`。

## Review Focus

- **事件既没有主体又有主体**：`person_id`/`family_id` 同时为空或同时非空必须被数据库拒绝，而不是靠 Zod。测试见 Task 4 的三条 CHECK 用例。
- **`before 1691` 的两种编码**：只允许 `date_end` 有值；把 `date_start` 也填上必须报错。测试见 Task 4 的 qualifier 用例。
- **跨租户挂靠**：`orgId=A` 的用户拿 `person_id` 属于 B 的 uuid 插入事件，必须失败（复合外键 + RLS 双拦）。测试见 Task 4 与 Task 6。
- **回填可重复执行**：连跑两次 `data/backfill-a2-lifespan.ts`，名讳与事件数量不变；用户手工建的同类型事件不被覆盖。测试见 Task 7。
- **换主名**：同一事务内两条语句（先清旧主名、再设新主名）必须成功；一条语句同时翻两面必须失败（部分唯一索引不是 `DEFERRABLE`）。测试见 Task 6。
- **检查器行数**：替换扁平生卒区之后 `person-inspector.tsx` 行数不涨过 606。`pnpm arch:check` 是判据。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `lib/db/migrations/00NN_forbid_tenant_move.sql`（新建，手写） | `app.forbid_tenant_move()` 触发器函数 + 对组织级表的 DO 块挂载 |
| `lib/db/migrations/meta/_journal.json`（修改） | 追加手写迁移的 journal 条目（先例 `0013`/`0014`） |
| `lib/db/schema/person-names.ts`（新建） | `person_name` 表 |
| `lib/db/schema/places.ts`（新建） | `place` 表 |
| `lib/db/schema/events.ts`（新建） | `event` + `event_participant` 两张表 |
| `lib/db/schema/index.ts`（修改，A1 已建） | 重新导出新表 |
| `lib/db/migrations/00NN_*.sql`（生成） | 四张表的 DDL（列/约束/索引/复合外键） |
| `lib/db/migrations/00NN_a2_lifespan_rls.sql`（新建，手写） | 四张表的 `FORCE RLS` + 三段式 policy |
| `lib/genealogy/constants.ts`（新建） | `EVENT_TYPES`、`ATTRIBUTE_EVENT_TYPES`、`DATE_PRECISIONS`、`DATE_QUALIFIERS`、`CALENDARS`、`DATA_STATUSES`、`PARTICIPANT_ROLES`、`NAME_TYPES`、`PLACE_TYPES` 与 `DateCn` 类型 |
| `lib/genealogy/person-record-schemas.ts`（新建） | 名讳/地点/事件/参与人的 Zod 契约 |
| `lib/db/queries/person-names.ts`（新建） | 按人取名讳、主名解析、写入 |
| `lib/db/queries/events.ts`（新建） | 按人/家庭取事件、时间线排序、写入 |
| `lib/db/queries/places.ts`（新建） | 按组织搜索地点、按 id 取地点 |
| `lib/lineage/person-record-actions.ts`（新建） | 名讳/事件/参与人的 Server Action |
| `components/lineage/person-names-panel.tsx`（新建） | 名讳列表 + 设为主名 + 增删改 |
| `components/lineage/person-events-panel.tsx`（新建） | 生卒时间线 + 事件增删改 |
| `components/lineage/types.ts`（修改） | `PersonNameView` / `PersonEventView`（结构化输入类型，不 import `lib/db/schema`） |
| `components/lineage/person-inspector.tsx`（修改） | 挂两个新面板、移除扁平生卒输入（净行数不增） |
| `lib/db/queries/nodes.ts`（修改） | 一并取名讳与事件，随 `NodeView` 下发 |
| `data/backfill-a2-lifespan.ts`（新建） | `node` 扁平列 → `person_name` / `event`，幂等 |
| `data/reconcile-a2-lifespan.ts`（新建） | 对账：人数、名讳数、事件数、软删状态零差异 |
| `package.json`（修改） | `db:backfill:a2`、`db:reconcile:a2` 两个 `npx tsx` 脚本 |
| `tests/integration/tenant-immutability.test.ts`（新建） | 租户列不可变 |
| `tests/integration/person-names.test.ts`（新建） | 名讳落库、主名唯一、换主名 |
| `tests/integration/places.test.ts`（新建） | 地点层级、坐标范围、跨租户 |
| `tests/integration/events.test.ts`（新建） | 主体互斥、日期语义、年龄、跨租户 |
| `tests/person-record-schemas.test.ts`（新建） | Zod 边界 |
| `docs/data-model.md` / `docs/implementation-status.md`（修改） | 四张新表与数据字典 |
| `docs/decisions/0015-event-and-date-semantics.md` / `0016-tenant-column-immutability.md`（新建） | 两条决策 |

---

### Task 0: 前置校验（不改代码）

**Files:** 无（只读校验）

**Interfaces:**
- 产出：确认 `lib/db/schema/` 目录存在、`person`/`family` 表已导出、`person` 上有 `UNIQUE (organization_id, id)`、`data/` 目录存在。

- [ ] **Step 1: 校验 A1 已落地**

```bash
ls lib/db/schema/ | head; grep -rn "uk_person_organization_id" lib/db/schema/ lib/db/migrations/
grep -rn "export const persons\|export const families" lib/db/schema/
```

期望：`lib/db/schema/index.ts` 存在且 `persons`/`families` 可被 grep 到；`uk_person_organization_id` 与 `uk_family_organization_id` 在 schema 或迁移里出现。任一缺失 → **停止**，本计划的 R1 前置未满足。

- [ ] **Step 2: 校验回填桥接键**

```bash
grep -rn "legacy_node_id\|node_id" lib/db/schema/persons.ts docs/superpowers/specs/2026-10-29-person-family-model-design.md | head
```

期望：`person` 上存在指向来源 `node` 的桥接列（`legacy_node_id` 或等价映射表）。若不存在，先在 A1 的回填脚本里补一个可空唯一列 `person.legacy_node_id uuid`（仅用于 A2 回填，A3 随 `node` 退役一起删除），再继续 Task 1。

- [ ] **Step 3: 记录基线**

```bash
pnpm arch:check && pnpm check && pnpm typecheck && pnpm test
wc -l components/lineage/person-inspector.tsx
```

期望：全绿；记录 `person-inspector.tsx` 的当前行数作为 Task 8 的行数上限依据。

---

### Task 1: 租户列不可变（兜底触发器）

**Files:**
- Create: `lib/db/migrations/00NN_forbid_tenant_move.sql`
- Modify: `lib/db/migrations/meta/_journal.json`
- Create: `tests/integration/tenant-immutability.test.ts`
- Create: `docs/decisions/0016-tenant-column-immutability.md`

**Interfaces:**
- 产出：`app.forbid_tenant_move() RETURNS trigger`，挂在 `project`/`folder`/`lineage`/`node`/`article`/`book`/`book_catalog` 及 A1 的四张表上；`UPDATE … SET organization_id = <另一个组织>` 抛 `check_violation`。

- [ ] **Step 1: 写失败的集成测试**

`tests/integration/tenant-immutability.test.ts`：用 `tests/integration/org-scope.test.ts` 的双组织夹具（同一用户在两个组织里都是 editor），在 `withOrg` 事务里执行

```ts
await expect(
  tx.execute(sql`update node set organization_id = ${otherOrgId} where id = ${nodeId}`)
).rejects.toThrow(/immutable/i);
```

再加一条正向用例：`update node set full_name = …` 必须成功（触发器不能误伤普通更新）。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test:integration -- tenant-immutability
```

期望：FAIL —— 当前 `organization_id` 可被改（这正是 P0-1）。

- [ ] **Step 3: 写触发器迁移**

`lib/db/migrations/00NN_forbid_tenant_move.sql`：

```sql
-- organization_id is the tenant key every policy, every composite foreign key
-- and every query filters on. RLS cannot express "this column is immutable":
-- a WITH CHECK on the new value passes as soon as the actor can write both
-- tenants. A BEFORE UPDATE trigger is the only place that sees OLD and NEW.
CREATE OR REPLACE FUNCTION app.forbid_tenant_move() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id is immutable on %', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'project', 'folder', 'lineage', 'node', 'article', 'book', 'book_catalog'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_' || t || '_tenant_immutable'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move()',
        'trg_' || t || '_tenant_immutable', t
      );
    END IF;
  END LOOP;
END
$$;
```

A1 落地后追加它的四张表名到数组（`person`、`family`、`family_child`、`person_tree`）。`organization_member` 与 `invite` 不在名单内：它们由 `auth_service` 写、`app_rw` 没有写权限。

- [ ] **Step 4: 登记 journal**

在 `lib/db/migrations/meta/_journal.json` 的 `entries` 末尾追加（`idx` 递增、`when` 用 `Date.now()` 量级、`tag` 与文件名去掉 `.sql` 一致、`breakpoints: true`），照 `0013`/`0014` 先例**不生成 snapshot**。

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm test:integration -- tenant-immutability && pnpm test:integration
```

- [ ] **Step 6: 写 ADR 0016 并提交**

ADR 记：为什么 RLS `WITH CHECK` 不够、为什么用触发器而不是 `REVOKE`、为什么 `organization_member` 例外。

```bash
git add lib/db/migrations lib/db/migrations/meta/_journal.json tests/integration/tenant-immutability.test.ts docs/decisions/0016-tenant-column-immutability.md
git commit -m "feat(db): 租户列不可变，用触发器兜住 RLS 表达不了的约束"
```

---

### Task 2: `person_name`（名讳）

**Files:**
- Create: `lib/db/schema/person-names.ts`
- Create: `lib/genealogy/constants.ts`（`NAME_TYPES` 部分）
- Modify: `lib/db/schema/index.ts`
- Create: `tests/integration/person-names.test.ts`

**Interfaces:**
- 产出：`export const personNames = pgTable('person_name', …)`；类型 `PersonName = typeof personNames.$inferSelect`。

- [ ] **Step 1: 写失败的集成测试**

`tests/integration/person-names.test.ts` 三条用例：① 同一人可有多条名讳，`name_type='other'` 缺 `custom_type` 被拒（23514）；② 同一人两条 `is_primary=true` 被拒（23505）；③ 跨租户 `person_id` 被拒（23503 或 RLS 过滤后 0 行）。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test:integration -- person-names
```

期望：FAIL —— 表不存在。

- [ ] **Step 3: 声明 schema**

```ts
export const personNames = pgTable('person_name', {
  id: uuidPk(),
  orgId: uuid('organization_id').notNull(),
  personId: uuid('person_id').notNull(),
  nameType: text('name_type').notNull().default('birth'),
  customType: text('custom_type'),
  fullName: text('full_name').notNull(),
  surname: text('surname'),
  givenName: text('given_name'),
  namePrefix: text('name_prefix'),
  nameSuffix: text('name_suffix'),
  nickname: text('nickname'),
  pinyin: text('pinyin'),
  language: text('language'),
  rareCharNote: text('rare_char_note'),
  isPrimary: boolean('is_primary').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedAt: timestamptz('updated_at'),
  deletedAt: timestamptz('deleted_at'),
}, (t) => [
  foreignKey({ columns: [t.orgId, t.personId], foreignColumns: [persons.orgId, persons.id], name: 'fk_person_name_person' }).onDelete('restrict'),
  unique('uk_person_name_organization_id').on(t.orgId, t.id),
  uniqueIndex('uq_person_name_primary').on(t.orgId, t.personId).where(sql`is_primary AND deleted_at IS NULL`),
  index('idx_person_name_person').on(t.orgId, t.personId, t.sort),
  check('ck_person_name_type', sql`${t.nameType} IN ('birth','courtesy','art','posthumous','temple','childhood','maiden','married','aka','religious','professional','school','official','other')`),
  check('ck_person_name_custom_type', sql`${t.nameType} <> 'other' OR ${t.customType} IS NOT NULL`),
]);
```

`NAME_TYPES` 与上述 CHECK 的取值列表放在 `lib/genealogy/constants.ts`，schema 与 Zod 共用同一份字面量。

- [ ] **Step 4: 生成迁移并人工 review**

```bash
pnpm db:generate
```

检查生成的 SQL 是否只有 `CREATE TABLE` + 约束 + 索引，**没有**夹带数据语句（`docs/data-model.md` §13）。

- [ ] **Step 5: 手写 RLS 迁移**

`lib/db/migrations/00NN_a2_lifespan_rls.sql`：`ALTER TABLE person_name ENABLE/FORCE ROW LEVEL SECURITY` + 三条 policy，角色数组与 `0001_auth_rls.sql:490-513` 一致。同文件先只放 `person_name`，后续 Task 逐张追加（同一迁移文件在 A2.1 内保持可重复执行：policy 用 `DROP POLICY IF EXISTS` 前置）。

- [ ] **Step 6: 跑测试确认通过**

```bash
pnpm db:generate && pnpm test:integration -- person-names
```

- [ ] **Step 7: 提交**

```bash
git add lib/db/schema/person-names.ts lib/db/schema/index.ts lib/db/migrations lib/genealogy/constants.ts tests/integration/person-names.test.ts
git commit -m "feat(db): person_name 多值名讳表"
```

---

### Task 3: `place`（地点）

**Files:**
- Create: `lib/db/schema/places.ts`
- Modify: `lib/genealogy/constants.ts`（`PLACE_TYPES`）
- Modify: `lib/db/schema/index.ts`、`lib/db/migrations/00NN_a2_lifespan_rls.sql`
- Create: `tests/integration/places.test.ts`

**Interfaces:**
- 产出：`export const places = pgTable('place', …)`；`formJurisdictions: text[]` 保留 GEDCOM `PLAC.FORM` 的辖区顺序。

- [ ] **Step 1: 写失败的集成测试**

`tests/integration/places.test.ts`：① 自引用父子（省→县）可建；② `parent_id = id` 被拒（`ck_place_not_self`）；③ 纬度 91 被拒（`ck_place_latitude`）；④ 跨租户父地点被拒；⑤ `form_jurisdictions` 保序（存 `['省','府','县']` 读回同序）。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test:integration -- places
```

- [ ] **Step 3: 声明 schema**

列：`id`、`orgId`、`parentId uuid('parent_place_id')`、`name`、`placeType text default 'other'`、`latitude numeric(10,7)`、`longitude numeric(10,7)`、`formJurisdictions: text('form_jurisdictions').array()`、`description`、审计四列。约束：`fk_place_parent` 指向 `places(orgId, id)`、`uk_place_organization_id`、`ck_place_not_self`（`parent_place_id IS DISTINCT FROM id`）、`ck_place_type`、`ck_place_latitude`（`-90..90`）、`ck_place_longitude`（`-180..180`）。索引：`idx_place_parent (orgId, parentId)`、`idx_place_name (orgId, name)`。

- [ ] **Step 4: 生成迁移 + 追加 RLS**

```bash
pnpm db:generate
```

把 `place` 加进 `00NN_a2_lifespan_rls.sql` 的 DO 块表数组。

- [ ] **Step 5: 跑测试确认通过并提交**

```bash
pnpm test:integration -- places
git add lib/db/schema/places.ts lib/genealogy/constants.ts lib/db/migrations tests/integration/places.test.ts
git commit -m "feat(db): place 地点表与辖区顺序"
```

---

### Task 4: `event`（事件 + 日期语义）

**Files:**
- Create: `lib/db/schema/events.ts`
- Modify: `lib/genealogy/constants.ts`（`EVENT_TYPES`、`ATTRIBUTE_EVENT_TYPES`、`DATE_*`、`DATA_STATUSES`、`DateCn`）
- Modify: `lib/db/schema/index.ts`、`lib/db/migrations/00NN_a2_lifespan_rls.sql`
- Create: `tests/integration/events.test.ts`
- Create: `docs/decisions/0015-event-and-date-semantics.md`

**Interfaces:**
- 产出：`export const events = pgTable('event', …)`；`isAttribute(type)` 从 `ATTRIBUTE_EVENT_TYPES` 派生，**不落列**。

- [ ] **Step 1: 写失败的集成测试**

`tests/integration/events.test.ts` 六条：① 两个主体都为空 → 23514；② 两个主体都填 → 23514；③ `date_qualifier='before'` 且 `date_start` 非空 → 23514；④ `date_qualifier='exact'` 且 `start > end` → 23514；⑤ `age_years` 非空而 `age_basis` 为空 → 23514；⑥ `event_type='custom'` 缺 `custom_type` → 23514。再加一条跨租户：`person_id` 属于另一个组织 → 23503。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test:integration -- events
```

- [ ] **Step 3: 声明 schema**

列：`id`、`orgId`、`personId`、`familyId`、`eventType text notNull`、`customType`、`gedcomTag`、`value`、`title`、`description`、`dateOriginal`、`dateStart date('date_start')`、`dateEnd date('date_end')`、`datePrecision`、`dateQualifier`、`calendar text default 'gregorian'`、`dateCn jsonb('date_cn').$type<DateCn>()`、`ageYears smallint`、`ageBasis`、`placeId`、`placeOriginal`、`dataStatus text default 'recorded'`、审计四列。

三条核心 CHECK（照抄进 `docs/decisions/0015-event-and-date-semantics.md`）：

```sql
-- 1. 主体恰好一个
CHECK (num_nonnulls(person_id, family_id) = 1)
-- 2. 日期边界语义
CHECK (
  (date_start IS NULL AND date_end IS NULL AND date_qualifier IS NULL)
  OR (date_qualifier IN ('exact','about','estimated','calculated','range','period')
      AND date_start IS NOT NULL AND date_end IS NOT NULL AND date_start <= date_end)
  OR (date_qualifier = 'before' AND date_start IS NULL AND date_end IS NOT NULL)
  OR (date_qualifier = 'after'  AND date_start IS NOT NULL AND date_end IS NULL)
)
-- 3. 年龄与依据同生同灭
CHECK ((age_years IS NULL) = (age_basis IS NULL))
```

另有 `ck_event_type`（覆盖事件 + 属性的全枚举，含 GEDCOM 的 `census`/`probate`/`will`/`naturalization`/`ordination`/`confirmation`/`first_communion`/`blessing`/`bar_mitzvah`/`bas_mitzvah`/`chrismation`/`divorce_filed`/`marriage_banns`/`marriage_contract`/`marriage_license`/`marriage_settlement`）、`ck_event_custom_type`、`ck_event_age_range`（`0..150`）、`ck_event_data_status`。

索引：`idx_event_person (orgId, personId, dateStart)`、`idx_event_family (orgId, familyId, dateStart)`、`idx_event_type (orgId, eventType)`、`idx_event_place (orgId, placeId)`、`uk_event_organization_id`。

- [ ] **Step 4: 生成迁移 + 追加 RLS**

```bash
pnpm db:generate
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm test:integration -- events
```

- [ ] **Step 6: 写 ADR 0015 并提交**

ADR 要写清：为什么 `exact` 也要求两端非空（闭区间边界 + `date_precision` 只影响展示）、`before`/`after` 的单端约定、为什么 `event_kind`/`event_scope` 不落库、农历转换为何推迟。

```bash
git add lib/db/schema/events.ts lib/genealogy/constants.ts lib/db/migrations tests/integration/events.test.ts docs/decisions/0015-event-and-date-semantics.md
git commit -m "feat(db): event 事件表，日期边界语义写进 CHECK"
```

---

### Task 5: `event_participant`（参与人）

**Files:**
- Modify: `lib/db/schema/events.ts`（同文件追加，保持 ≤400 行）
- Modify: `lib/genealogy/constants.ts`（`PARTICIPANT_ROLES`）
- Modify: `lib/db/schema/index.ts`、`lib/db/migrations/00NN_a2_lifespan_rls.sql`
- Create: `tests/integration/event-participants.test.ts`

**Interfaces:**
- 产出：`export const eventParticipants = pgTable('event_participant', …)`；`role ∈ {'witness','officiant','matchmaker','godparent','relative','neighbor','other'}`（**没有** `principal`）。

- [ ] **Step 1: 写失败的集成测试**

三条：① 同一事件同一人同一角色重复插入 → 23505；② `role='other'` 缺 `custom_role` → 23514；③ 事件软删后参与人查询不可见（查询层用例，Task 6 复用）。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test:integration -- event-participants
```

- [ ] **Step 3: 声明 schema**

列：`id`、`orgId`、`eventId`、`personId`、`role`、`customRole`、`sort`、审计四列。约束：`fk_event_participant_event` → `events(orgId, id)` restrict、`fk_event_participant_person` → `persons(orgId, id)` restrict、`uk_event_participant_organization_id`、`uq_event_participant (orgId, eventId, personId, role) WHERE deleted_at IS NULL`、`ck_event_participant_role`、`ck_event_participant_custom_role`。索引：`idx_event_participant_event (orgId, eventId, sort)`、`idx_event_participant_person (orgId, personId)`。

- [ ] **Step 4: 生成迁移 + 追加 RLS + 跑测试**

```bash
pnpm db:generate && pnpm test:integration -- event-participants
```

- [ ] **Step 5: 提交**

```bash
git add lib/db/schema/events.ts lib/genealogy/constants.ts lib/db/migrations tests/integration/event-participants.test.ts
git commit -m "feat(db): event_participant 参与人表"
```

---

### Task 6: 查询层 + 契约层 + 写路径

**Files:**
- Create: `lib/db/queries/person-names.ts`、`lib/db/queries/events.ts`、`lib/db/queries/places.ts`
- Create: `lib/genealogy/person-record-schemas.ts`
- Create: `lib/lineage/person-record-actions.ts`
- Create: `tests/person-record-schemas.test.ts`
- Modify: `tests/integration/person-names.test.ts`、`tests/integration/events.test.ts`（补写路径用例）

**Interfaces:**
- `getPersonNames(userId: string, orgId: string, personId: string): Promise<PersonName[]>`
- `getEventsForPerson(userId: string, orgId: string, personId: string): Promise<EventWithParticipants[]>`
- `getEventsForFamily(userId: string, orgId: string, familyId: string): Promise<EventWithParticipants[]>`
- `searchPlaces(userId: string, orgId: string, query: string, limit?: number): Promise<Place[]>`
- `setPrimaryPersonName(input: SetPrimaryNameInput): Promise<ActionState>` —— 事务内**两条语句**：先 `UPDATE … SET is_primary = false WHERE orgId = ? AND personId = ? AND is_primary`，再 `UPDATE … SET is_primary = true WHERE id = ?`。
- `createPersonName` / `updatePersonName` / `deletePersonName` / `createEvent` / `updateEvent` / `deleteEvent` / `addEventParticipant` / `removeEventParticipant`：全部 `Promise<ActionState>`，全部走 `withOrgWrite({ permission: 'lineage.write' })`。

- [ ] **Step 1: 写失败的 Zod 单测**

`tests/person-record-schemas.test.ts`：事件日期三态（无日期 / `before` 只带 end / `exact` 带两端且 start ≤ end）、`ageYears` 与 `ageBasis` 同生同灭、`eventType='custom'` 要求 `customType`、名讳 `nameType='other'` 要求 `customType`、`fullName` 空串被拒。中文字典文案断言。

- [ ] **Step 2: 跑单测确认失败**

```bash
pnpm test -- person-record-schemas
```

- [ ] **Step 3: 写 Zod 契约**

`lib/genealogy/person-record-schemas.ts` 复用 `lib/genealogy/schemas.ts` 的本地辅助风格（`z.preprocess` 处理空串、中文 `error` 文案），导出 `createPersonNameSchema`、`updatePersonNameSchema`、`setPrimaryPersonNameSchema`、`createEventSchema`、`updateEventSchema`、`createEventParticipantSchema`、`searchPlacesSchema`。

- [ ] **Step 4: 跑单测确认通过**

```bash
pnpm test -- person-record-schemas
```

- [ ] **Step 5: 写查询层**

三个 query 模块一律 `import 'server-only'`、`withOrg` 包裹、`organization_id` + `isNull(deletedAt)` 过滤、按 `dateStart` 升序且 `NULLS LAST` 排序。每个文件 ≤400 行；超了就在 `events.ts` 里把「取参与人」拆成 `lib/db/queries/event-participants.ts`。

- [ ] **Step 6: 写 Action**

`lib/lineage/person-record-actions.ts`：每个 Action 用 `validatedActionWithUser`（或项目现有等价包装）+ `withOrgWrite`，捕获 `23505`/`23514`/`23503` 转中文 `ActionState`（`lib/errors.ts` 的 `actionError()`），成功后 `revalidatePath` 谱系页。

- [ ] **Step 7: 写集成测试（写路径 + 换主名）**

在 `tests/integration/person-names.test.ts` 追加：同一事务内两条语句换主名成功；一条 `UPDATE … SET is_primary = CASE …` 同时翻两面失败。在 `tests/integration/events.test.ts` 追加：viewer 角色调用 `createEvent` 返回 `forbidden` 且不落库。

- [ ] **Step 8: 跑测试确认通过并提交**

```bash
pnpm test -- person-record-schemas && pnpm test:integration -- "person-names|events"
git add lib/db/queries lib/genealogy/person-record-schemas.ts lib/lineage/person-record-actions.ts tests/person-record-schemas.test.ts tests/integration
git commit -m "feat(genealogy): 名讳与事件的查询、契约与写路径"
```

---

### Task 7: 回填与对账

**Files:**
- Create: `data/backfill-a2-lifespan.ts`、`data/reconcile-a2-lifespan.ts`
- Modify: `package.json`

**Interfaces:**
- `pnpm db:backfill:a2` → `npx tsx data/backfill-a2-lifespan.ts`；`pnpm db:reconcile:a2` → `npx tsx data/reconcile-a2-lifespan.ts`
- 回填用 `POSTGRES_URL_DIRECT`（owner/超级用户，绕过 RLS），**单事务**，幂等键是「该 person 是否已有同类型事件 / 是否已有 primary 名讳」。

- [ ] **Step 1: 写对账脚本（先写判据）**

`data/reconcile-a2-lifespan.ts` 输出四组差异明细而不是只报数字：① `node` 有 `full_name` 而对应 `person` 没有 primary 名讳；② `node.birth_year`/`birth_text` 非空而对应 `person` 没有 `event_type='birth'`；③ 同上 `death`；④ `node.burial_place` 非空而没有 `event_type='burial'`。零差异时打印 `reconcile: 0 diff`。

- [ ] **Step 2: 跑对账确认有差异**

```bash
pnpm db:reconcile:a2
```

期望：四组差异都非零（尚未回填）。

- [ ] **Step 3: 写回填脚本**

映射规则（写进脚本头注释）：

| `node` 列 | 目标 |
|---|---|
| `full_name` / `surname` / `name` | `person_name`：`name_type='birth'`、`is_primary=true`、`sort=0` |
| `courtesy`（非空） | `person_name`：`name_type='courtesy'`、`sort=1` |
| `name_prefix`（非空） | 合并进 birth 行的 `name_prefix` |
| `birth_year` / `birth_text` | `event`：`event_type='birth'`、`date_original=birth_text`、`date_start=date_end=make_date(birth_year,1,1)`、`date_precision='year'`、`date_qualifier='exact'` |
| `birth_text` 有值但 `birth_year` 为空 | 同上但三端日期全 NULL（只留原文） |
| `death_year` / `death_text` | 同上，`event_type='death'` |
| `burial_place` | `event`：`event_type='burial'`、`place_original=burial_place`、无日期 |

幂等：`INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM person_name n WHERE n.person_id = p.id AND n.name_type = 'birth')`（事件同理，按 `event_type`）。**不删不改用户数据**，只补缺失。

- [ ] **Step 4: 跑回填 + 对账确认零差异**

```bash
pnpm db:backfill:a2 && pnpm db:reconcile:a2
```

- [ ] **Step 5: 验证可重复执行**

```bash
pnpm db:backfill:a2 && pnpm db:reconcile:a2   # 第二遍不应新增任何行
psql "$POSTGRES_URL_DIRECT" -c "select count(*) from person_name; select count(*) from event;"
```

两次计数必须一致。

- [ ] **Step 6: 提交**

```bash
git add data package.json
git commit -m "feat(data): 生平层回填与对账脚本"
```

---

### Task 8: 读取投影 + 检查器 + 文档

**Files:**
- Modify: `lib/db/queries/nodes.ts`、`components/lineage/types.ts`、`components/lineage/person-inspector.tsx`
- Create: `components/lineage/person-names-panel.tsx`、`components/lineage/person-events-panel.tsx`
- Modify: `docs/data-model.md`、`docs/implementation-status.md`

**Interfaces:**
- `NodeView` 新增 `names: PersonNameView[]`、`events: PersonEventView[]`（结构化输入类型，**不** import `lib/db/schema`，理由见 `components/lineage/types.ts:1-3` 的注释）。
- `PersonNameView = { id, nameType, customType, fullName, surname, givenName, isPrimary, sort }`
- `PersonEventView = { id, eventType, customType, title, value, dateOriginal, dateStart, dateEnd, datePrecision, dateQualifier, calendar, ageYears, ageBasis, placeOriginal, dataStatus, participants: { id, personId, personName, role }[] }`

- [ ] **Step 1: 改查询层并跑既有测试**

`getNodes` 一次性取三份数据（node + 名讳 + 事件）并合并成 `NodeView[]`；保持 `organization_id` + `lineage_id` + `isNull(deletedAt)` 过滤与既有排序不变。

```bash
pnpm test && pnpm test:integration -- nodes
```

期望：既有断言全绿（排序与可见性不变）。

- [ ] **Step 2: 写两个面板组件**

`person-names-panel.tsx`：列表 + 「设为主名」按钮 + 新增/编辑/删除，空态文案「暂无其他名讳」。
`person-events-panel.tsx`：时间线（`dateOriginal` 优先展示，无日期显示 `dataStatus` 的中文：已载 / 失考 / 待考），每条事件可展开参与人。

- [ ] **Step 3: 改检查器（净行数不增）**

把 `person-inspector.tsx` 里出生/去世/葬地/名讳的扁平输入区替换为两个新面板的挂载；跑

```bash
wc -l components/lineage/person-inspector.tsx && pnpm arch:check
```

期望：行数 ≤ Task 0 记录的基线（606），`arch:check` 无 violation。

- [ ] **Step 4: 补 E2E**

`tests/e2e/critical-path.spec.ts` 追加：打开族人 → 时间线出现「出生」→ 新增一条「葬」事件 → 刷新后仍在。

```bash
pnpm test:e2e -- critical-path
```

- [ ] **Step 5: 同步文档**

`docs/data-model.md` 加四张表的数据字典条目（列名、约束、索引、软删、RLS），`docs/implementation-status.md` 的「已实现」表加一行、状态只写一处。跑

```bash
pnpm docs:check --strict
```

- [ ] **Step 6: 全量验证并提交**

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm arch:check && pnpm docs:check --strict && pnpm test:integration
git add lib/db/queries/nodes.ts components/lineage docs
git commit -m "feat(ui): 检查器接入名讳列表与生卒时间线"
```

---

## Self-Review

**Spec 覆盖：** A1 spec §9 的 A2 阶段列了 `event`/`place`/`source`/`citation`/`person_name` 五类，本计划覆盖前三类 + `event_participant`，并把 `source`/`citation`/`citation_link`/`repository`/`submitter`/`place_name`/`person_name_translation` 明确留给 A2.2——计划头部的 Architecture 段与评审 §7 决策表一致，没有静默丢项。`node` 扁平列迁入事件在 Task 7 完成；`biography` 仍留在 `person`（A1 已定），不迁。

**步骤扫描：** 每个 Task 都是「先写失败测试 → 跑失败 → 实现 → 跑通过 → 提交」，只有 Task 0（只读校验）、Task 7 Step 5（重复执行验证）、Task 8 Step 4（E2E）是验证性步骤，没有「TBD」「稍后补」。

**类型一致性：** `PersonName`/`Place`/`Event`/`EventParticipant` 一律从 `$inferSelect` 派生（AGENTS §6）；`NodeView` 用结构化输入类型避免客户端 bundle 触碰 `lib/db/schema`；`DateCn` 只在一处定义（`lib/genealogy/constants.ts`），schema 与 Zod 共用。

**Review Focus 对应：** 主体互斥 → Task 4 Step 1 用例①②；`before` 二义 → Task 4 Step 1 用例③；跨租户挂靠 → Task 4 Step 1 末条 + Task 6 Step 7；回填幂等 → Task 7 Step 5；换主名 → Task 6 Step 7；检查器行数 → Task 8 Step 3。

**比例：** 五个任务做 DDL、一个做读写契约、一个做数据迁移、一个做界面与文档；DDL 占大头是因为 A2.1 的实质就是四张表的约束设计，而约束正是本计划最贵的部分（日期语义、主体互斥、复合外键）。**未做**：地点管理 UI、史料层、GEDCOM 导出、农历换算——都在 A2.2/A3，写在这里会被当成半成品。

**已知风险：** ① A1 若改了 `person` 的复合唯一键命名，Task 2-5 的 `foreignKey({ foreignColumns: [persons.orgId, persons.id] })` 需要跟着改（Task 0 Step 1 就是为这个）；② `person-inspector.tsx` 已经 606 行，替换而非新增是硬要求，Task 8 Step 3 若涨行数，正确做法是把名讳/事件渲染进一步下沉到面板组件，而不是提高豁免；③ 回填脚本用 owner 连接绕过 RLS，本地/CI 是超级用户没问题，生产执行必须走工单与备份（`docs/guides/runbooks.md`）。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-10-29-a2-lifespan-layer.md`.** 两种执行方式：

1. **Subagent-Driven（推荐）** —— 每个 Task 派一个全新 subagent，任务之间由我复核 diff 与测试输出；适合 Task 1–5 这种彼此独立的 DDL 任务，能并行、上下文干净。
2. **Inline Execution** —— 在当前会话里按 Task 顺序执行，用 `superpowers:executing-plans` 的批处理与检查点；适合你想全程看着每一处约束怎么落地。

**选哪个？** 另外提醒：本计划的前置（A1 关系层）尚未实施，Task 0 会先做只读校验；如果你希望现在就开始动代码，需要先批准并执行 A1。
