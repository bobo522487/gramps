# 创建谱系（新建谱系）优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「新建谱系」弹窗改造成截图规格的「创建谱系」：名称 ≤24 字、所属分类与地区必填、主题名与姓氏只读继承项目、新增备注，创建后进入画布并直接录入始祖。

**Architecture:** 分三层落地。数据层给 `lineage` 加两个可空列（`region`、`notes`）；契约层把 `surname` 从创建/更新 schema 移除、改为事务内从 `project` 读取，`folderId` 变必填、名称上限收紧到 24；界面层用 Radix `Dialog` 重写创建弹窗（替换手写 `createPortal`），编辑弹窗补地区/备注并只读姓氏。每个任务结束时 `pnpm check && pnpm typecheck && pnpm test` 都是绿的。

**Tech Stack:** Next.js 16 App Router、React 19 Client Component、Server Actions、Zod 4、Drizzle ORM + PostgreSQL 18、Radix UI（`radix-ui` 包的 `Dialog`/`Select`）、lucide-react、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-25-create-lineage-design.md`

## Rulings Carried Into This Plan

- **R1 无分类死结（人类伙伴 2026-10-25 确认）**：`createLineageInTransaction` 支持 `folderId: null` —— 当项目内没有分类时，在同一事务内隐式创建（或复用）`kind=0`、名为「默认分类」的顶层分类，并让新谱系归属它。不改变分类管理的 `project.write` 权限，不改 RLS。这推翻了 spec 初稿「`folderId` 必填」的做法：**Zod 层 `folderId` 仍必填**，但弹窗在无分类时提交空串并由服务层兜底。
- **R2 姓氏注入点**：姓氏永远由服务端从 `project.surname` 读取；`project_surname_missing` 只对历史/种子数据可达（`createProjectSchema` 创建时必填）。
- **R3 标题与按钮**：标题「创建谱系」，底部「取消」/「确定」。
- **R4 已删除的旧计划**：`docs/superpowers/plans/2026-10-24-create-project-dialog.md` 是已实施的旧计划，与本计划无冲突范围。

## Global Constraints

- 弹窗标题「创建谱系」；底部按钮「取消」/「确定」；字段顺序固定为：谱系名称、所属分类、主题名、姓氏、地区、郡望堂号、备注。
- 谱系名称最多 **24** 个字符；`input maxLength=24`，Zod 同步拒绝 25 字符（前后端都要拦）。
- 所属分类、地区为**必填**；主题名、姓氏为**只读继承值**，不接收客户端传值。
- 主题名/姓氏**不加红色星号**，改标「项目信息」；点击「修改所属项目基本信息」跳 `/dashboard/project/[projectRef]/settings`，无 `project.write` 时按钮禁用并给中文原因。
- 地区为自由文本，≤ 100 字，默认值取 `project.countries_regions ?? ''`；郡望堂号 ≤ 60 字；备注 ≤ 500 字。
- **字辈不出现在创建弹窗**，只在编辑谱系维护。
- `lineage.region` / `lineage.notes` 两列**可空**（历史数据无值）；长度只在 Zod 校验，不加 `CHECK`。
- `lineage.folder_id` 在数据库保持可空（历史「未分类」谱系），「必填」只是创建契约。
- 姓氏在**创建与编辑两处都不可修改**：`createLineageSchema` / `updateLineageSchema` 均不含 `surname`。
- 面向用户文案一律简体中文；数据库列名、日志、错误码保持英文。
- 组织级读写仍走 `withOrg` / `app_rw`；不得读写 `auth.*`。
- 不在 `app/(dashboard)`、`components/lineage`、`components/project` 新增裸色值（`tests/design-system.test.ts` 会检查）；主按钮用 `button.tsx` 的 `brand` 变体。
- 迁移由 `pnpm db:generate` 生成并人工 review，迁移提交与业务代码提交分开。
- 每个任务结束前 `pnpm check && pnpm typecheck && pnpm test` 全绿；涉及 SQL 的任务补 `pnpm test:integration`，涉及 UI 流程的任务补 `pnpm test:e2e`。
- 不修改 `docs/decisions/` 下的历史 ADR；当前字段以 `docs/data-model.md` 为准。

## Review Focus

- **项目没有分类时新建谱系**：用户第一次进谱系页、一个分类都没有，弹窗下拉为空——必须能现场建分类继续走，不能卡死。测试见 Task 3（`+ 新建分类` 分支）与 Task 6（E2E）。
- **伪造 `surname` 表单字段**：客户端强行提交 `surname=王`，落库值必须仍是项目姓氏。测试见 Task 2 的 schema 剥离用例与 Task 4 的集成用例。
- **项目姓氏为空**：`project.surname` 为 null 或空串时，事务必须返回 `project_surname_missing`，Action 给中文提示，而不是写入空姓氏或 500。测试见 Task 4。
- **历史谱系无地区/备注/未分类**：列表、侧栏、画布、世系表、打印视图都不能渲染 `null` 或崩溃。测试见 Task 5 与 Task 6。
- **25 字名称**：24 字可提交、25 字被拒；中文与英文混排都按字符计。测试见 Task 2。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `lib/lineage/constants.ts`（新建） | `MAX_LINEAGE_NAME_LENGTH = 24`、`MAX_LINEAGE_REGION_LENGTH = 100`、`MAX_LINEAGE_NOTES_LENGTH = 500`、`MAX_LINEAGE_HALL_CODE_LENGTH = 60`、`MAX_LINEAGE_GENERATION_WORDS = 40` |
| `lib/db/schema.ts`（修改） | `lineages` 增加 `region` / `notes` 可空列 |
| `lib/db/migrations/0007_*.sql`（生成） | `ALTER TABLE lineage ADD COLUMN region text; ADD COLUMN notes text;` |
| `lib/genealogy/schemas.ts`（修改） | 创建/更新谱系 Zod 契约：去 `surname`、`folderId` 必填、名称 24 字、新增 `region`/`notes` |
| `lib/lineage/services.ts`（修改） | 创建时从项目读姓氏、写 `region`/`notes`、新增 `project_surname_missing`；更新白名单加两字段 |
| `lib/lineage/actions.ts`（修改） | 不再传/读 `surname`；新增失败原因中文映射 |
| `components/lineage/readonly-project-field.tsx`（新建） | 只读继承字段：「项目信息」标签 + 修改入口按钮 |
| `components/lineage/create-lineage-dialog.tsx`（重写） | 截图规格的创建弹窗（Radix `Dialog`） |
| `components/lineage/lineage-edit-dialog.tsx`（修改） | 姓氏只读、新增地区/备注 |
| `components/lineage/lineage-tree.ts`（修改） | 搜索纳入 `region` |
| `components/lineage/lineage-sidebar.tsx`（修改） | 透传创建弹窗新 props |
| `components/lineage/lineage-workspace.tsx`（修改） | 列表卡片展示地区，类型加新字段 |
| `components/lineage/lineage-detail.tsx`（修改） | 空谱系一次性自动打开「录入始祖」；编辑弹窗透传新字段 |
| `components/lineage/lineage-shell.tsx`（修改） | 透传项目主题名/地区与 `canProjectWrite` |
| `app/(dashboard)/dashboard/project/[projectRef]/lineages/layout.tsx`（修改） | 透传新 props |
| `app/(dashboard)/dashboard/project/[projectRef]/lineages/page.tsx`（修改） | 透传新字段与新 props |
| `app/(dashboard)/dashboard/project/[projectRef]/lineages/[lineageId]/page.tsx`（修改） | 透传 `region` / `notes` |
| `tests/lineage-schemas.test.ts`（修改） | 创建/更新 schema 边界与不可变性 |
| `tests/lineage-tree.test.ts`（新建） | 搜索纳入地区 |
| `tests/lineage-auto-root.test.ts`（新建） | 「一次性自动弹出始祖」判定为纯函数 |
| `tests/integration/folders-lineages.test.ts`（修改） | 落库、姓氏继承、项目无姓氏、更新不改姓氏 |
| `tests/e2e/critical-path.spec.ts`（修改） | 新弹窗流程与新选择器 |
| `docs/implementation-status.md` / `docs/data-model.md`（修改） | `FR-LIN-1` 行为与新列 |

---

### Task 1: `lineage` 新增 `region` / `notes` 列

**Files:**
- Modify: `lib/db/schema.ts:283-315`（`lineages` 表定义）
- Create: `lib/db/migrations/0007_*.sql`（`pnpm db:generate` 生成）
- Test: `tests/integration/migrations.test.ts`（追加用例）

**Interfaces:**
- Produces: `lineages.region: text | null`、`lineages.notes: text | null`；Drizzle 类型 `Lineage['region']` / `Lineage['notes']` 自动派生。

- [ ] **Step 1: 写失败的迁移断言测试**

在 `tests/integration/migrations.test.ts` 的 `describe('migrations')` 内追加：

```ts
it('adds nullable region and notes columns to lineage', async () => {
  const rows = await getTestSql()<{ column_name: string; is_nullable: string }[]>`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lineage'
      AND column_name IN ('region', 'notes')
    ORDER BY column_name`;

  expect(rows).toEqual([
    { column_name: 'notes', is_nullable: 'YES' },
    { column_name: 'region', is_nullable: 'YES' },
  ]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:integration -- tests/integration/migrations.test.ts`
Expected: FAIL — 实际拿到 `[]`，与期望的两行不一致。

- [ ] **Step 3: 在 schema 加列**

`lib/db/schema.ts` 的 `lineages` 表定义中，在 `generationWords` 之后插入：

```ts
    region: text('region'),
    notes: text('notes'),
```

- [ ] **Step 4: 生成迁移并人工 review**

Run: `pnpm db:generate`
Expected: 新增 `lib/db/migrations/0007_<name>.sql`，内容只有两行 `ALTER TABLE "lineage" ADD COLUMN ...`（外加 `statement-breakpoint`），无 DROP、无数据修复、无 RLS 改动。若生成内容不符，停下修正 schema 后重跑。

- [ ] **Step 5: 执行迁移并验证**

Run: `pnpm db:migrate && pnpm test:integration -- tests/integration/migrations.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交（迁移单独一个提交）**

```bash
git add lib/db/schema.ts lib/db/migrations
git commit -m "feat(db): add region and notes columns to lineage"
```

---

### Task 2: 谱系常量与 Zod 契约

**Files:**
- Create: `lib/lineage/constants.ts`
- Modify: `lib/genealogy/schemas.ts`（`generationWords`、`createLineageSchema`、`updateLineageSchema`）
- Test: `tests/lineage-schemas.test.ts`

**Interfaces:**
- Produces:
  - `MAX_LINEAGE_NAME_LENGTH = 24`、`MAX_LINEAGE_HALL_CODE_LENGTH = 60`、`MAX_LINEAGE_REGION_LENGTH = 100`、`MAX_LINEAGE_NOTES_LENGTH = 500`
  - `createLineageSchema` 解析结果类型：`{ orgId, projectId, folderId: string, name: string, hallCode?: string, region: string, notes?: string }`（**无 `surname`**）
  - `updateLineageSchema` 解析结果：`{ orgId, lineageId, folderId?, name?, hallCode?, region?, notes?, generationWords? }`（**无 `surname`**）

- [ ] **Step 1: 写失败的 schema 测试**

在 `tests/lineage-schemas.test.ts` 顶部补 import：

```ts
import { createLineageSchema, updateLineageSchema } from '@/lib/genealogy/schemas';
```

追加用例：

```ts
describe('createLineageSchema', () => {
  const base = {
    orgId: '00000000-0000-4000-8000-000000000001',
    projectId: '00000000-0000-4000-8000-000000000004',
    folderId: '00000000-0000-4000-8000-000000000009',
    name: '颍川陈氏世系',
    region: '中国/福建/漳州',
  };

  it('accepts 24 characters and rejects 25', () => {
    expect(createLineageSchema.safeParse({ ...base, name: '名'.repeat(24) }).success).toBe(true);
    const tooLong = createLineageSchema.safeParse({ ...base, name: '名'.repeat(25) });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues[0]?.message).toBe('谱系名称不能超过 24 个字符');
    }
  });

  it('accepts an empty folder id (server creates the default category) and rejects a blank region', () => {
    const parsed = createLineageSchema.safeParse({ ...base, folderId: '' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.folderId).toBeUndefined();
    expect(createLineageSchema.safeParse({ ...base, region: '   ' }).success).toBe(false);
    expect(createLineageSchema.safeParse({ ...base, region: '地'.repeat(101) }).success).toBe(false);
  });

  it('strips a forged surname so it can never reach the database', () => {
    const parsed = createLineageSchema.parse({ ...base, surname: '王' });
    expect(parsed).not.toHaveProperty('surname');
  });

  it('keeps notes optional and generation words out of creation', () => {
    const parsed = createLineageSchema.parse({ ...base, notes: '光绪年间分谱' });
    expect(parsed.notes).toBe('光绪年间分谱');
    expect(createLineageSchema.parse(base)).not.toHaveProperty('generationWords');
  });
});

describe('updateLineageSchema', () => {
  it('accepts region/notes clearing and still rejects surname', () => {
    const parsed = updateLineageSchema.parse({
      orgId: '00000000-0000-4000-8000-000000000001',
      lineageId: '00000000-0000-4000-8000-000000000002',
      region: '',
      notes: '',
      surname: '王',
    });
    expect(parsed.region).toBeNull();
    expect(parsed.notes).toBeNull();
    expect(parsed).not.toHaveProperty('surname');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- tests/lineage-schemas.test.ts`
Expected: FAIL — `region` 缺失时仍通过、`surname` 未被剥离、25 字未被拒绝。

- [ ] **Step 3: 新建常量文件**

`lib/lineage/constants.ts`：

```ts
export const MAX_LINEAGE_NAME_LENGTH = 24;
export const MAX_LINEAGE_HALL_CODE_LENGTH = 60;
export const MAX_LINEAGE_REGION_LENGTH = 100;
export const MAX_LINEAGE_NOTES_LENGTH = 500;
```

- [ ] **Step 4: 改 `lib/genealogy/schemas.ts`**

- 顶部引入：`import { MAX_LINEAGE_HALL_CODE_LENGTH, MAX_LINEAGE_NAME_LENGTH, MAX_LINEAGE_NOTES_LENGTH, MAX_LINEAGE_REGION_LENGTH } from '@/lib/lineage/constants';`
- 新增：

```ts
const requiredText = (label: string, max: number) =>
  z
    .string({ error: `请输入${label}` })
    .trim()
    .min(1, `请输入${label}`)
    .max(max, `${label}不能超过 ${max} 个字符`);

const optionalText = (max: number, message: string) => /* 保持现有实现不变 */;
```

- 把 `createLineageSchema` 改为（**R1**：`folderId` 允许空串，表示「项目还没有分类，由服务端建默认分类」）：

```ts
const optionalFolderId = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.uuid('分类无效').optional()
);

export const createLineageSchema = z.object({
  orgId,
  projectId,
  folderId: optionalFolderId,
  name: requiredText('谱系名称', MAX_LINEAGE_NAME_LENGTH),
  hallCode: optionalText(MAX_LINEAGE_HALL_CODE_LENGTH, '郡望/堂号不能超过 60 个字符'),
  region: requiredText('地区', MAX_LINEAGE_REGION_LENGTH),
  notes: optionalText(MAX_LINEAGE_NOTES_LENGTH, '备注不能超过 500 个字符'),
});
```

说明：这里用对象级 `optionalUuid('分类无效')` → 改为既有 `folderId`（必填 UUID），`surname` 与 `generationWords` 一并删除；Zod 默认为 strip，所以伪造字段自然不会出现在结果里。

- 把 `updateLineageSchema` 中的 `surname` 行删除，并新增两行：

```ts
  region: clearableText(MAX_LINEAGE_REGION_LENGTH, '地区不能超过 100 个字符'),
  notes: clearableText(MAX_LINEAGE_NOTES_LENGTH, '备注不能超过 500 个字符'),
```

（现有 `generationWords` 的预处理块保持不动。）

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test -- tests/lineage-schemas.test.ts`
Expected: PASS。

- [ ] **Step 6: 类型检查暴露的调用方**

Run: `pnpm typecheck`
Expected: 记录所有因 `createLineageSchema` 少字段而报错的位置（`lib/lineage/actions.ts`）。这些在下个任务修，不要在这里改动它们以外的文件。

- [ ] **Step 7: 提交**

```bash
git add lib/lineage/constants.ts lib/genealogy/schemas.ts tests/lineage-schemas.test.ts
git commit -m "feat(lineage): tighten create schema and drop editable surname"
```

---

### Task 3: 事务服务与 Action 改为继承项目姓氏

**Files:**
- Modify: `lib/lineage/services.ts`（`createLineageInTransaction`、`LineageUpdates`、`updateLineageInTransaction`）
- Modify: `lib/lineage/actions.ts`（`LINEAGE_ERRORS`、`createLineageAction`、`updateLineageAction`）
- Test: `tests/integration/folders-lineages.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `lineages.region/notes`；Task 2 的 schema。
- Produces:
  - `LineageFailure` 增加 `'project_surname_missing'`
  - `createLineageInTransaction(params: { userId; orgId; projectId; folderId?: string; name: string; region: string; hallCode?: string; notes?: string; ipAddress?: string }): Promise<LineageMutationResult>`（**无 `surname`**；`folderId` 省略时自动创建/复用「默认分类」）
  - `LineageUpdates` 增加 `region?: string | null`、`notes?: string | null`，删除 `surname`
  - `LINEAGE_ERRORS.project_surname_missing = '项目未填写姓氏，请先完善项目基本信息'`

- [ ] **Step 1: 写失败的服务测试**

在 `tests/integration/folders-lineages.test.ts` 的 `describe('lineage service')` 内追加：

```ts
it('inherits the project surname and stores region and notes', async () => {
  const { user, organization, project } = await setup();
  const folder = await createFolder({
    orgId: organization.id,
    projectId: project.id,
    createdBy: user.id,
    kind: 0,
  });

  const result = await createLineageInTransaction({
    userId: user.id,
    orgId: organization.id,
    projectId: project.id,
    folderId: folder.id,
    name: '颍川陈氏',
    region: '中国/福建/漳州',
    notes: '光绪年间分谱',
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.lineage.surname).toBe(project.surname);
  expect(result.lineage.region).toBe('中国/福建/漳州');
  expect(result.lineage.notes).toBe('光绪年间分谱');
});

it('refuses to create a lineage when the project has no surname', async () => {
  const { user, organization } = await setup();
  const bareProject = await createProject({
    orgId: organization.id,
    createdBy: user.id,
    surname: '',
  });
  const folder = await createFolder({
    orgId: organization.id,
    projectId: bareProject.id,
    createdBy: user.id,
    kind: 0,
  });

  const result = await createLineageInTransaction({
    userId: user.id,
    orgId: organization.id,
    projectId: bareProject.id,
    folderId: folder.id,
    name: '无姓谱系',
    region: '中国/福建',
  });

  expect(result).toEqual({ ok: false, reason: 'project_surname_missing' });
});

it('cannot change the surname through an update', async () => {
  const { user, organization, project } = await setup();
  const folder = await createFolder({
    orgId: organization.id,
    projectId: project.id,
    createdBy: user.id,
    kind: 0,
  });
  const lineage = await createLineage({
    orgId: organization.id,
    projectId: project.id,
    createdBy: user.id,
    folderId: folder.id,
    surname: '王',
  });

  const result = await updateLineageInTransaction({
    userId: user.id,
    orgId: organization.id,
    lineageId: lineage.id,
    updates: { region: '中国/浙江', surname: '李' } as never,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.lineage.surname).toBe('王');
  expect(result.lineage.region).toBe('中国/浙江');
});
```

- [ ] **Step 1b: 写「无分类时建默认分类」的失败测试**

```ts
it('creates and reuses a default category when the project has none', async () => {
  const { user, organization, project } = await setup();

  const first = await createLineageInTransaction({
    userId: user.id,
    orgId: organization.id,
    projectId: project.id,
    name: '第一本',
    region: '中国/福建',
  });
  const second = await createLineageInTransaction({
    userId: user.id,
    orgId: organization.id,
    projectId: project.id,
    name: '第二本',
    region: '中国/福建',
  });

  expect(first.ok && second.ok).toBe(true);
  if (!first.ok || !second.ok) return;
  expect(first.lineage.folderId).not.toBeNull();
  expect(second.lineage.folderId).toBe(first.lineage.folderId);

  const foldersInProject = await getFolders(user.id, organization.id, project.id, 0);
  expect(foldersInProject.map((f) => f.name)).toEqual(['默认分类']);
});
```

`getFolders` 从 `@/lib/db/queries/folders` 引入；若测试文件尚未引入则补 import。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:integration -- tests/integration/folders-lineages.test.ts`
Expected: FAIL —— `region` 为 `undefined`、`project_surname_missing` 不存在、默认分类未创建，且现有其它调用点因多 `surname` 报类型错。

- [ ] **Step 3: 改事务服务 `createLineageInTransaction`**

- 参数删 `surname`，加 `region: string`、`notes?: string`；`folderId` 改可选。
- **R1 默认分类**：项目校验通过后，若 `folderId` 为空，则在当前事务内查找 `kind=0 AND name='默认分类' AND deleted_at IS NULL` 的分类：找到就复用，否则插入一条（`kind: 0`、`parentId: null`、`sort` 取现有最大值 +1、`createdBy: userId`）。把结果 id 作为本次谱系的 `folderId`。这段逻辑抽成同文件的 `resolveFolderInTx(tx, { orgId, projectId, userId, folderId })`，签名 `Promise<string>`，便于单测与复用。
- 在项目存在性查询处把 select 扩为 `{ id: projects.id, surname: projects.surname }`。
- 项目校验通过后插入前加：

```ts
      const projectSurname = project.surname?.trim();
      if (!projectSurname) {
        return { ok: false, reason: 'project_surname_missing' as const };
      }
```

- 插入值改为 `surname: projectSurname, region, notes: notes ?? null`，并去掉 `generationWords`。

- [ ] **Step 4: 改 `LineageUpdates` 与更新白名单**

`LineageUpdates` 删 `surname`，加 `region?: string | null; notes?: string | null;`。`updateLineageInTransaction` 中若使用展开写库，改为逐个字段赋值白名单（`name`、`folderId`、`hallCode`、`region`、`notes`、`generationWords`），确保 `surname` 不可能被写入。

- [ ] **Step 5: 改 Action**

`lib/lineage/actions.ts`：

- `LINEAGE_ERRORS` 增加 `project_surname_missing: '项目未填写姓氏，请先完善项目基本信息'`。
- `createLineageAction` 调用参数改为 `{ ..., folderId: data.folderId, name: data.name, region: data.region, hallCode: data.hallCode, notes: data.notes }`（去掉 `surname` 与 `generationWords`）。
- `updateLineageAction` 删除 `if (data.surname !== undefined)` 分支，新增：

```ts
    if (data.region !== undefined) updates.region = data.region;
    if (data.notes !== undefined) updates.notes = data.notes;
```

- [ ] **Step 6: 更新既有测试调用点**

`tests/integration/folders-lineages.test.ts` 里所有 `createLineageInTransaction` 调用：删除 `surname`、补 `region: '中国/福建'`；未传 `folderId` 的用例先建一个 `kind: 0` 分类再传。若“rejects a folder from another content tree”用例原本不带 `folderId`，改为带错分类的 `folderId`。

- [ ] **Step 7: 运行测试**

Run: `pnpm test:integration -- tests/integration/folders-lineages.test.ts`
Expected: PASS（含新增三条）。

- [ ] **Step 8: 提交**

```bash
git add lib/lineage/services.ts lib/lineage/actions.ts tests/integration/folders-lineages.test.ts
git commit -m "feat(lineage): inherit project surname and persist region/notes"
```

---

### Task 4: 只读继承字段组件

**Files:**
- Create: `components/lineage/readonly-project-field.tsx`

**Interfaces:**
- Produces: `ReadonlyProjectField({ id, label, value, href, canEdit, disabledReason }: { id: string; label: string; value: string; href: string; canEdit: boolean; disabledReason: string })` —— 渲染「项目信息」标签、只读值、以及「修改所属项目基本信息」按钮；`canEdit` 为 `false` 时按钮 `disabled` 且 `title={disabledReason}`。

- [ ] **Step 1: 实现组件**

`'use client'`；用 `components/ui/label.tsx` 的 `Label`、`button.tsx` 的 `Button`（`variant="destructive"`，`size="xs"`），容器样式为灰底只读条（`rounded-md border bg-muted/40 px-3 py-2`），值用 `text-sm text-muted-foreground`。`canEdit` 时按钮用 `next/link` 包裹或 `useRouter().push(href)`；不可用时渲染 `<Button type="button" disabled title={disabledReason}>`。按钮文字固定「修改所属项目基本信息」，标签旁固定小徽标「项目信息」。

- [ ] **Step 2: 类型检查**

Run: `pnpm typecheck && pnpm check`
Expected: 通过，无裸色值告警。

- [ ] **Step 3: 提交**

```bash
git add components/lineage/readonly-project-field.tsx
git commit -m "feat(lineage): add readonly inherited project field"
```

---

### Task 5: 重写「创建谱系」弹窗

**Files:**
- Modify: `components/lineage/create-lineage-dialog.tsx`（整体重写，保留同名导出 `CreateLineageDialog`）
- Modify: `components/lineage/lineage-sidebar.tsx`（透传新 props）
- Modify: `components/lineage/lineage-workspace.tsx`（透传新 props）

**Interfaces:**
- Consumes: Task 4 的 `ReadonlyProjectField`；Task 2/3 的 Action 契约。
- Produces: `CreateLineageDialog` 新 props：

```ts
{
  orgId: string;
  projectId: string;
  projectRef: string;
  projectThemeName: string;
  projectSurname: string;
  projectRegion: string;
  canProjectWrite: boolean;
  folders: { id: string; name: string; parentId: string | null }[];
  defaultFolderId: string | null;
  onClose: () => void;
}
```

- [ ] **Step 1: 重写弹窗**

要点（实现细节由你决定，以下为必须满足的约束）：

1. 用 `components/ui/dialog.tsx` 的 `Dialog` + `DialogContent`（`showCloseButton` 用默认 `true` 即可提供右上角 X），不再用 `createPortal`。
2. `<form action={action} noValidate>` 内依次渲染七个字段，顺序与 Global Constraints 一致；`<input type="hidden" name="orgId|projectId">`。**不渲染 `surname` 输入项**。
3. 名称：`Input id="lineage-name" maxLength={MAX_LINEAGE_NAME_LENGTH}`，占位「请输入谱系名称，限长24个字」，受控 state 并在标签旁显示 `${name.length}/24`。
4. 所属分类：`Select` 受控，选项来自 `folders`（三级缩进复用文件内现有 `folderOptions()` 函数）。
   - 项目**有分类**：默认选第一个；hidden `folderId` 写其 id。
   - 项目**没有分类**：下拉禁用并显示提示「项目还没有分类，创建后将自动归入「默认分类」」；hidden `folderId` 提交空串，由服务层建默认分类（**R1**）。**不要**在这里调用 `createFolderAction` —— editor 调它会 403。
   - `canProjectWrite` 为真时，下拉上方额外提供一个「新建分类…」链接按钮，点击后进入侧栏已有的新建文件夹流程（`onClose()` 后由侧栏处理）；无权限则不渲染。
5. 主题名 / 姓氏：用 `ReadonlyProjectField`，`href` 为 `/dashboard/project/${projectRef}/settings`，`canEdit={canProjectWrite}`，`disabledReason="只有所有者或管理员可以修改项目基本信息"`。
6. 地区：`Input id="lineage-region" name="region" defaultValue={projectRegion} maxLength={100}`，占位「例如：中国/北京/东城」。
7. 郡望堂号 `name="hallCode"`（占位「请输入郡望堂号」）、备注 `Textarea name="notes"`（占位「请输入谱系备注」，`maxLength={500}`）。
8. **不渲染字辈字段**。
9. 「确定」在名称/分类/地区任一为空时 `disabled`；提交中显示「创建中…」。
10. 成功（`state.lineageId`）后 `router.refresh()`、`router.push(/dashboard/project/${projectRef}/lineages/${id})`、`onClose()`。
11. 关闭时的二次确认：**只有用户真正改过字段才提示**。用「当前值 ≠ 初始值」判定脏状态，名称、郡望堂号、备注与非默认分类都计入；**地区因为是预填默认值、且默认值本身等于项目地区，不算脏**（`region !== projectRegion` 才算脏）。标题「放弃已填内容？」，按钮「继续编辑」/「放弃」。
12. 字段错误显示在对应字段下方（`state.fieldErrors?.x`），`state.error` 显示在表单底部。

- [ ] **Step 2: 更新两个调用点**

`lineage-sidebar.tsx` 与 `lineage-workspace.tsx` 传入新 props；`defaultSurname` 不再传给弹窗（若该 prop 在别处仍被使用则保留）。

- [ ] **Step 3: 类型检查与静态检查**

Run: `pnpm typecheck && pnpm check`
Expected: 通过。

- [ ] **Step 4: 手动烟测（不写代码，只跑）**

Run: `pnpm dev`，在浏览器打开任一项谱系页，点击「新建谱系」，确认字段顺序、只读态、按钮禁用逻辑与截图一致；再确认创建一个谱系后进入画布。

- [ ] **Step 5: 提交**

```bash
git add components/lineage/create-lineage-dialog.tsx components/lineage/lineage-sidebar.tsx components/lineage/lineage-workspace.tsx
git commit -m "feat(lineage): rebuild create dialog to spec"
```

---

### Task 6: 编辑弹窗、列表展示与数据透传

**Files:**
- Modify: `components/lineage/lineage-edit-dialog.tsx`
- Modify: `components/lineage/lineage-detail.tsx`（`LineageInfo` 类型 + 编辑弹窗透传 + 空谱系自动弹始祖）
- Modify: `app/(dashboard)/dashboard/project/[projectRef]/lineages/[lineageId]/page.tsx`
- Modify: `components/lineage/lineage-workspace.tsx`（卡片展示地区）
- Modify: `app/(dashboard)/dashboard/project/[projectRef]/lineages/page.tsx`、`.../lineages/layout.tsx`、`components/lineage/lineage-shell.tsx`
- Test: `tests/lineage-auto-root.test.ts`（新建）

**Interfaces:**
- Produces:
  - `LineageInfo` 增加 `region: string | null; notes: string | null;`
  - `lib/lineage/auto-root.ts`（新建）导出 `shouldAutoOpenRoot({ nodeCount, alreadyOpened }: { nodeCount: number; alreadyOpened: boolean }): boolean` —— 当且仅当 `nodeCount === 0 && !alreadyOpened` 返回 `true`。
  - `LineageShell` 新增 props：`projectThemeName: string`、`projectRegion: string`、`canProjectWrite: boolean`。

- [ ] **Step 1: 写自动弹窗的失败测试**

`tests/lineage-auto-root.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { shouldAutoOpenRoot } from '@/lib/lineage/auto-root';

describe('shouldAutoOpenRoot', () => {
  it('opens once for an empty lineage', () => {
    expect(shouldAutoOpenRoot({ nodeCount: 0, alreadyOpened: false, canWrite: true })).toBe(true);
  });

  it('never opens again in the same visit', () => {
    expect(shouldAutoOpenRoot({ nodeCount: 0, alreadyOpened: true, canWrite: true })).toBe(false);
  });

  it('never opens for a lineage that already has people', () => {
    expect(shouldAutoOpenRoot({ nodeCount: 2, alreadyOpened: false, canWrite: true })).toBe(false);
  });

  it('never opens for users who cannot write', () => {
    expect(shouldAutoOpenRoot({ nodeCount: 0, alreadyOpened: false, canWrite: false })).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- tests/lineage-auto-root.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 创建 `lib/lineage/auto-root.ts`** 实现上述签名。

- [ ] **Step 4: 改编辑弹窗**

- 姓氏改为只读展示（`<p>` + 「创建后不可修改」），不渲染 `surname` 输入项。
- 新增地区 `Input name="region"`（`defaultValue={lineage.region ?? ''}`，`maxLength={100}`，占位「例如：中国/北京/东城」）与备注 `Textarea name="notes"`（`defaultValue={lineage.notes ?? ''}`，`maxLength={500}`）。
- `lineage` prop 类型加 `region: string | null; notes: string | null;`。
- 保留字辈字段（这是它现在唯一的维护入口）。

- [ ] **Step 5: 空谱系自动打开「录入始祖」**

在 `lineage-detail.tsx` 中：用 `useRef(false)` 记录已自动打开；`useEffect` 在挂载后调用 `shouldAutoOpenRoot({ nodeCount: nodes.length, alreadyOpened: ref.current, canWrite })`，为真时 `ref.current = true` 并 `setCreateDialog({ mode: 'root' })`。仅在 `hasRoot === false` 时进入该逻辑。

- [ ] **Step 6: 透传新字段到各处**

- `[lineageId]/page.tsx`：`region: lineage.region, notes: lineage.notes`。
- `lineages/page.tsx` 与 `layout.tsx`：给 shell / workspace 传 `projectThemeName={project.themeName ?? ''}`、`projectRegion={project.countriesRegions ?? ''}`、`canProjectWrite={hasPermission(role, 'project.write')}`。
- `lineage-shell.tsx`：接收并透传给 `LineageSidebar`。
- `lineage-workspace.tsx`：卡片展示 `region`（存在时显示在郡望之前），类型加 `region`/`notes`。

- [ ] **Step 7: 运行全部单测与类型检查**

Run: `pnpm typecheck && pnpm test`
Expected: 全绿。

- [ ] **Step 8: 提交**

```bash
git add components/lineage lib/lineage/auto-root.ts tests/lineage-auto-root.test.ts "app/(dashboard)/dashboard/project/[projectRef]/lineages"
git commit -m "feat(lineage): edit region/notes, show region, auto-open root form"
```

---

### Task 7: 搜索纳入地区

**Files:**
- Modify: `components/lineage/lineage-tree.ts`（`TreeLineageInput` + `lineageMatches`）
- Test: `tests/lineage-tree.test.ts`（新建）

**Interfaces:**
- Produces: `TreeLineageInput` 增加 `region: string | null`。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import { buildLineageTree, filterLineageTree } from '@/components/lineage/lineage-tree';

const lineage = {
  id: 'l1', name: '颍川陈氏', surname: '陈', hallCode: null,
  nodeCount: 0, folderId: null, region: '中国/福建/漳州',
};

describe('filterLineageTree', () => {
  it('matches a lineage by its region', () => {
    const tree = buildLineageTree([], [lineage]);
    expect(filterLineageTree(tree, '漳州').unfiled).toHaveLength(1);
    expect(filterLineageTree(tree, '北京').unfiled).toHaveLength(0);
  });

  it('tolerates lineages created before region existed', () => {
    const tree = buildLineageTree([], [{ ...lineage, region: null }]);
    expect(filterLineageTree(tree, '陈').unfiled).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- tests/lineage-tree.test.ts`
Expected: FAIL —— 按地区搜不到。

- [ ] **Step 3: 改 `lineage-tree.ts`**

`TreeLineageInput` 加 `region: string | null;`；`lineageMatches` 增加 `(lineage.region ?? '').toLowerCase().includes(needle)`。同步更新 `layout.tsx`、`lineage-workspace.tsx` 中构造 `TreeLineageInput` 的映射，补 `region`。

- [ ] **Step 4: 处理历史上超长名称**

存量谱系可能是 25–100 字的名称。规则：**可读、只能改短**。编辑弹窗的 `maxLength` 取 `Math.max(MAX_LINEAGE_NAME_LENGTH, 现有名称长度)`，并在名称超过 24 字时显示提示「名称超过 24 字，保存前需要缩短」；侧栏内联重命名框同样改用 24。服务端照常按 24 拒绝，错误显示在字段下方。

- [ ] **Step 5: 运行测试**

Run: `pnpm typecheck && pnpm test`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add components/lineage/lineage-tree.ts components/lineage/lineage-sidebar.tsx tests/lineage-tree.test.ts
git commit -m "feat(lineage): search by region and cap rename length"
```

---

### Task 8: 更新 E2E 关键路径

**Files:**
- Modify: `tests/e2e/critical-path.spec.ts:101-112`

- [ ] **Step 1: 改 E2E 步骤**

在建文件夹之后：

1. `page.getByRole('button', { name: '在此文件夹下新建谱系' }).click()`（不变）。
2. 弹窗断言改为 `page.getByRole('dialog', { name: '创建谱系' })`。
3. `#lineage-name` 填「E2E 谱系」；断言 `#lineage-surname` 输入框**不存在**（改为只读文本断言其值为「陈」）；`#lineage-region` 清空后「确定」禁用，填「中国/福建」后可用。
4. 点击「确定」提交。
5. 之后应**自动弹出**「录入始祖」对话框：把原来显式点击 `getByRole('button', { name: '录入始祖' })` 改为直接 `expect(rootDialog).toBeVisible()`。若自动弹出不稳定，保留点击按钮的写法（按钮仍在），但断言对话框可见。

- [ ] **Step 2: 运行 E2E**

Run: `pnpm test:e2e`
Expected: 2 条关键路径全绿（本地模式会重置 `_test` 库）。

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/critical-path.spec.ts
git commit -m "test(e2e): cover the rebuilt create-lineage dialog"
```

---

### Task 9: 文档同步与全量验证

**Files:**
- Modify: `docs/implementation-status.md`（`FR-LIN-1` 行与 §3.4 说明）
- Modify: `docs/data-model.md`（§6.1 `lineage` 表补 `region` / `notes` 列说明）
- Modify: `docs/prd.md`（`FR-LIN-1` 验收标准改为：名称 ≤24 字、分类与地区必填、姓氏与主题名继承项目不可改、创建后进入画布）
- Modify: `AGENTS.md` + `docs/implementation-status.md` 的测试计数（按实际输出填）

- [ ] **Step 1: 改文档**

按上表逐项更新；`FR-LIN-1` 状态保持 ✅ 但描述改为新行为；数据模型表格补两行：

```md
| `region` | 谱系地区，自由文本，≤100 字；可空（历史数据） |
| `notes` | 谱系备注，≤500 字；可空 |
```

- [ ] **Step 2: 更新测试计数**

Run: `pnpm test` 与 `pnpm test:integration`，把实际文件数/用例数写进 `AGENTS.md` 技术形态表与 `docs/implementation-status.md`。不要估数。

- [ ] **Step 3: 全量验证**

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: 全绿。

Run: `pnpm test:integration`
Expected: 全绿。

Run: `pnpm test:e2e`
Expected: 2 条全绿。

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 4: 提交**

```bash
git add docs/implementation-status.md docs/data-model.md docs/prd.md AGENTS.md
git commit -m "docs(lineage): document the create-lineage contract"
```

---

## Execution Handoff

执行方式已由人类伙伴指定：在本会话内按任务顺序实现（Native），使用 `superpowers:executing-plans`，最后对整个分支做一次统一评审。每个任务必须以实际命令输出作为完成证据；Task 1 的迁移必须人工 review 后才能 `db:migrate`。
