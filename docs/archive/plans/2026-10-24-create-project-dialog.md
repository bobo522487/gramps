# 创建云谱项目弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「新建云谱空间」弹窗改造成「创建云谱项目」弹窗，按规格采集项目名、姓氏、地区、主题名、状态、重要等级与备注；姓氏与主题名使用全新字段，创建后不可修改；旧字段 `primary_name` / `primary_surname` 最终删除。

**Architecture:** 采用 expand/contract 迁移：先增量添加 `theme_name`、`surname`、`status`、`importance`、`notes` 并保持旧列可用；随后切换服务端契约与 UI 读写；最后用独立迁移删除旧列。每个任务结束时类型检查与测试都是绿的。不可修改性由三层保证：更新 schema 剥离字段、事务服务只白名单可变字段、设置页只读展示。

**Tech Stack:** Next.js 16 App Router、React 19 Client Component、Server Actions、Zod 3、Drizzle ORM + PostgreSQL 18、Radix Select、lucide-react、Vitest、Playwright。

**Spec:** 用户在 2026-10-24 提供的行内需求「优化新建 project 功能」，并追加两项决定：字段「空间名」改称「项目名」；不复用 `primary_name` / `primary_surname`，改为全新字段并删除旧列（旧数据不可恢复）。

## Global Constraints

- 弹窗标题必须为「创建云谱项目」，字段固定为：项目名、姓氏、地区、主题名、状态、重要等级、备注。
- 必填项：项目名、姓氏、地区、主题名；四项任一为空（含纯空白）时禁止提交。
- 项目名最多 24 个字符；输入框 `maxLength=24`，Zod 同步拒绝 25 字符。
- 姓氏、主题名使用新列 `project.surname` / `project.theme_name`，创建后不可修改；更新 schema 不接受这两个字段，事务服务更新时只白名单可变字段，设置页只读展示。
- 状态取值固定为 `planning`（筹备中）/ `in_progress`（进行中）/ `completed`（已完成），创建默认 `in_progress`。
- 重要等级为 1–5 的整数，默认 1；5 颗星，点击第 N 颗表示 1..N 星选中。
- 备注可选，最多 500 个字符；更新时传空字符串表示清空。
- `theme_name` / `surname` 在数据库层允许为空：迁移需要能在已有项目数据上直接执行；创建/更新契约仍要求非空。读取侧必须对 `null` 使用 `—` / `''` 兜底。
- 旧列 `primary_name` / `primary_surname` 最终删除，旧数据不可恢复（用户已确认）。
- 弹窗入口按钮与组织页文案本轮保持「新建空间 / 云谱空间」不变；只有弹窗标题与字段标签使用「项目」。
- 所有面向用户的文案使用简体中文；数据库/API/日志保持现有英文约定。
- 组织级写入仍走 `withOrg` / `app_rw`；不得直接读写 `auth.*`，不得新增 `/api/auth/*`。
- 不得在 `app/(dashboard)`、`components/console`、`components/org`、`components/project` 中新增裸色值（`tests/design-system.test.ts` 会检查）；星级组件放在 `components/ui`，沿用 `badge.tsx` 的 amber 类。
- 表结构变更必须由 `pnpm db:generate` 生成并人工 review；迁移提交与业务代码提交分开。
- 每次提交前至少通过 `pnpm check && pnpm typecheck && pnpm test`；涉及数据库的改动补 `pnpm test:integration`，涉及 UI 的改动补 `pnpm test:e2e`。
- 不修改 `docs/decisions/0001-foundation-reset.md`：ADR 是历史决策记录，当前字段以 `docs/data-model.md` 为准。

## Review Focus

- **纯空白必填项**：输入 `"   "` 时必须视为未填写，按钮保持禁用，服务端也返回「请输入…」而不是写库。测试：Task 2 的 whitespace 用例 + Task 3 的禁用按钮断言。
- **项目名长度边界**：24 个字符可提交，25 个字符被拒绝/截断。测试：Task 2 的 24/25 用例。
- **伪造不可变字段**：更新请求即使带 `themeName` / `surname` 也不得改变原值。测试：Task 2 的 schema 剥离用例 + Task 2 的伪造更新集成测试。
- **重要等级越界**：0、6、非数字不得被静默当成默认值，必须返回中文错误。测试：Task 2 的 0/6/非数字用例。
- **未知状态值**：`archived` 等非枚举值必须被拒绝，不能写入数据库。测试：Task 2 的未知状态用例。
- **旧数据为 null**：迁移后已有项目的 `theme_name` / `surname` 为 null，概览、项目卡片、谱系默认姓氏必须兜底而不是渲染 `null` 或崩溃。测试：Task 4 的读取侧改造 + 设置页 `—` 展示；集成测试覆盖新建项目写入新列。

## File Structure

| 文件 | 职责 |
|---|---|
| `lib/project/constants.ts`（新建） | 状态枚举/中文标签/默认值/长度与星级上限常量 |
| `lib/db/schema.ts`（修改） | 新增 `themeName` / `surname` / `status` / `importance` / `notes` 与 CHECK；Task 5 删除旧列 |
| `lib/db/migrations/0004_*.sql`（生成） | 增量添加新列与约束 |
| `lib/db/migrations/0005_*.sql`（生成） | 删除 `primary_name` / `primary_surname` |
| `lib/auth/schemas.ts`（修改） | 创建/更新项目 Zod 契约；更新契约排除不可变字段 |
| `lib/db/services.ts`（修改） | 创建/更新输入类型；更新仅白名单可变字段 |
| `lib/project/actions.ts`（修改） | 透传新字段；更新不再处理姓氏/主题名 |
| `components/ui/star-rating.tsx`（新建） | 1–5 星受控组件 |
| `components/project/create-project-dialog.tsx`（修改） | 新弹窗字段、必填拦截、星级与状态 |
| `components/project/project-settings-panel.tsx`（修改） | 编辑可变字段；姓氏/主题名只读 |
| `app/(dashboard)/dashboard/project/[projectRef]/settings/page.tsx`（修改） | 传入新字段 |
| `app/(dashboard)/dashboard/project/[projectRef]/page.tsx`（修改） | 概览展示主题名/姓氏/状态/重要等级/备注 |
| `components/project/project-workspace.tsx`（修改） | 主题名与姓氏分开展示、搜索 |
| `app/(dashboard)/dashboard/org/[orgSlug]/page.tsx`（修改） | 映射新字段 |
| `app/(dashboard)/dashboard/project/[projectRef]/lineages/page.tsx` / `layout.tsx`（修改） | `defaultSurname={project.surname ?? ''}` |
| `lib/db/seed.ts` / `tests/helpers/factories.ts`（修改） | 演示数据与测试工厂写入新字段 |
| `tests/project-constants.test.ts`（新建） | 状态标签映射 |
| `tests/auth-schemas.test.ts`（修改） | 创建/更新 schema 边界与不可变字段 |
| `tests/integration/projects.test.ts`（修改） | 新字段持久化、伪造不可变字段被忽略、旧列已删除 |
| `tests/integration/org-scope.test.ts`（修改） | 更新 fixture 与直接插入的字段 |
| `tests/e2e/critical-path.spec.ts`（修改） | 完整创建流程、取消、星级、概览与设置页 |
| `docs/data-model.md` / `docs/implementation-status.md` / `docs/prd.md` / `docs/api.md` / `AGENTS.md`（修改） | 同步当前字段、行为与测试计数 |

---

### Task 1: 项目元数据常量、新列与增量迁移

**Files:**
- Create: `lib/project/constants.ts`
- Create: `tests/project-constants.test.ts`
- Modify: `lib/db/schema.ts:215-241`
- Create: `lib/db/migrations/0004_*.sql`（由 `pnpm db:generate` 生成，文件名以实际输出为准）

**Interfaces:**
- Produces:
  - `PROJECT_STATUS_VALUES = ['planning', 'in_progress', 'completed'] as const`
  - `type ProjectStatus = 'planning' | 'in_progress' | 'completed'`
  - `PROJECT_STATUS_OPTIONS: ReadonlyArray<{ value: ProjectStatus; label: string }>`
  - `DEFAULT_PROJECT_STATUS: ProjectStatus`（`'in_progress'`）
  - `DEFAULT_PROJECT_IMPORTANCE = 1`
  - `MAX_PROJECT_NAME_LENGTH = 24`
  - `MAX_PROJECT_SURNAME_LENGTH = 30`
  - `MAX_PROJECT_THEME_NAME_LENGTH = 60`
  - `MAX_PROJECT_REGIONS_LENGTH = 100`
  - `MAX_PROJECT_NOTES_LENGTH = 500`
  - `PROJECT_IMPORTANCE_MAX = 5`
  - `projectStatusLabel(value: string): string`
  - `project` 表新增可空 `theme_name` / `surname` / `notes`，以及 `status text NOT NULL DEFAULT 'in_progress'`、`importance smallint NOT NULL DEFAULT 1`

**本轮不删除旧列**：`primaryName` / `primarySurname` 保持在 schema 与数据库里，保证每个任务结束时类型检查是绿的；Task 5 再删除。

- [ ] **Step 1: 写失败的常量测试**

```ts
// tests/project-constants.test.ts
import { describe, expect, it } from 'vitest';
import {
  PROJECT_STATUS_OPTIONS,
  projectStatusLabel,
} from '@/lib/project/constants';

describe('project status constants', () => {
  it('maps statuses to Chinese labels in display order', () => {
    expect(
      PROJECT_STATUS_OPTIONS.map(({ value, label }) => [value, label])
    ).toEqual([
      ['planning', '筹备中'],
      ['in_progress', '进行中'],
      ['completed', '已完成'],
    ]);
  });

  it('falls back to the raw value for unknown statuses', () => {
    expect(projectStatusLabel('in_progress')).toBe('进行中');
    expect(projectStatusLabel('archived')).toBe('archived');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/project-constants.test.ts`
Expected: FAIL，`Cannot find module '@/lib/project/constants'`。

- [ ] **Step 3: 创建 `lib/project/constants.ts`**

```ts
export const PROJECT_STATUS_VALUES = [
  'planning',
  'in_progress',
  'completed',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUS_VALUES)[number];

export const PROJECT_STATUS_OPTIONS: ReadonlyArray<{
  value: ProjectStatus;
  label: string;
}> = [
  { value: 'planning', label: '筹备中' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: '筹备中',
  in_progress: '进行中',
  completed: '已完成',
};

export const DEFAULT_PROJECT_STATUS: ProjectStatus = 'in_progress';
export const DEFAULT_PROJECT_IMPORTANCE = 1;
export const MAX_PROJECT_NAME_LENGTH = 24;
export const MAX_PROJECT_SURNAME_LENGTH = 30;
export const MAX_PROJECT_THEME_NAME_LENGTH = 60;
export const MAX_PROJECT_REGIONS_LENGTH = 100;
export const MAX_PROJECT_NOTES_LENGTH = 500;
export const PROJECT_IMPORTANCE_MAX = 5;

export function projectStatusLabel(value: string): string {
  return PROJECT_STATUS_LABELS[value as ProjectStatus] ?? value;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/project-constants.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5: 在 `lib/db/schema.ts` 增加列与约束**

在文件顶部加入 type-only 导入（相对路径，避免 drizzle-kit 解析别名）：

```ts
import type { ProjectStatus } from '../project/constants';
```

在 `projects` 表定义中，保留现有 `primaryName` / `primarySurname`，并加入：

```ts
themeName: text('theme_name'),
surname: text('surname'),
status: text('status').$type<ProjectStatus>().notNull().default('in_progress'),
importance: smallint('importance').notNull().default(1),
notes: text('notes'),
```

在表配置的返回数组中追加：

```ts
check(
  'ck_project_status',
  sql`${t.status} in ('planning', 'in_progress', 'completed')`
),
check(
  'ck_project_importance',
  sql`${t.importance} between 1 and 5`
),
```

不要给 `name` 加数据库长度 CHECK：旧数据可能超过 24，迁移必须能在现有库上直接执行；24 字符由 Zod 和输入框 `maxLength` 保证。`project` 的 RLS 与 `app_rw` 权限是表级授权，新增列不需要新策略。

- [ ] **Step 6: 生成并 review 迁移**

Run: `pnpm db:generate`
Expected: 生成新的 `0004_*.sql`，内容等价于：

```sql
ALTER TABLE "project" ADD COLUMN "theme_name" text;
ALTER TABLE "project" ADD COLUMN "surname" text;
ALTER TABLE "project" ADD COLUMN "status" text DEFAULT 'in_progress' NOT NULL;
ALTER TABLE "project" ADD COLUMN "importance" smallint DEFAULT 1 NOT NULL;
ALTER TABLE "project" ADD COLUMN "notes" text;
ALTER TABLE "project" ADD CONSTRAINT "ck_project_status"
  CHECK ("project"."status" in ('planning', 'in_progress', 'completed'));
ALTER TABLE "project" ADD CONSTRAINT "ck_project_importance"
  CHECK ("project"."importance" between 1 and 5);
```

人工确认：没有删除 `primary_name` / `primary_surname`，没有夹带数据修复，没有重建表。文件名使用 drizzle-kit 的实际输出，不手工改名。

- [ ] **Step 7: 执行迁移**

Run: `pnpm db:migrate`
Expected: 迁移成功；`project` 已有五列且新插入行默认 `in_progress` / `1`。

- [ ] **Step 8: 类型检查与单测**

Run: `pnpm typecheck`
Expected: PASS。

Run: `pnpm test`
Expected: PASS（现有用例 + 2 个常量用例）。

- [ ] **Step 9: 提交**

```bash
git add lib/project/constants.ts tests/project-constants.test.ts lib/db/schema.ts lib/db/migrations
git commit -m "feat(db): add project identity and metadata columns"
```

---

### Task 2: Zod 契约、事务服务、Action 与创建弹窗字段切换

**Files:**
- Modify: `lib/auth/schemas.ts:145-194`
- Modify: `lib/db/services.ts:10-116`
- Modify: `lib/project/actions.ts:25-71`
- Modify: `components/project/create-project-dialog.tsx`
- Modify: `tests/auth-schemas.test.ts`
- Modify: `tests/integration/projects.test.ts`
- Modify: `tests/integration/org-scope.test.ts:28-32`
- Modify: `tests/helpers/factories.ts:83-108`
- Modify: `lib/db/seed.ts:92-118`
- Modify: `tests/e2e/critical-path.spec.ts:31-38`

**Interfaces:**
- Consumes: Task 1 的常量与 `ProjectStatus`。
- Produces:
  - `createProjectSchema` 输出 `{ orgId: string; name: string; surname: string; themeName: string; countriesRegions: string; status: ProjectStatus; importance: number; notes?: string }`
  - `updateProjectSchema` 输出 `{ orgId: string; projectId: string; name?: string; countriesRegions?: string | null; hallCode?: string | null; status?: ProjectStatus; importance?: number; notes?: string | null }`，**不包含** `themeName` / `surname`
  - `type ProjectCreateInput = { name: string; surname: string; themeName: string; countriesRegions: string; status: ProjectStatus; importance: number; notes?: string | null }`
  - `type ProjectMutableInput = { name: string; countriesRegions: string; hallCode?: string | null; status: ProjectStatus; importance: number; notes?: string | null }`
  - `type ProjectUpdates = Partial<ProjectMutableInput>`
  - 创建弹窗字段 id：`project-name`、`project-surname`、`project-regions`、`project-theme-name`；本轮尚无状态/星级/备注控件，服务端使用默认值。

**过渡期双写**：旧列仍是 `NOT NULL`，`createProjectInTransaction` 必须临时把 `themeName` / `surname` 同时写入 `primary_name` / `primary_surname`；Task 5 删除旧列时一并移除。

- [ ] **Step 1: 写失败的 schema 测试**

在 `tests/auth-schemas.test.ts` 顶部导入：

```ts
import { createProjectSchema, updateProjectSchema } from '@/lib/auth/schemas';
```

追加：

```ts
const PROJECT_ORG_ID = '0190a5b0-0000-7000-8000-000000000001';
const PROJECT_ID = '0190a5b0-0000-7000-8000-000000000002';
const validProject = {
  orgId: PROJECT_ORG_ID,
  name: '义门陈氏云谱',
  surname: '陈',
  themeName: '义门陈氏宗谱',
  countriesRegions: '中国江西',
};

describe('project create schema', () => {
  it('applies defaults and coerces rating/notes', () => {
    expect(createProjectSchema.parse(validProject)).toMatchObject({
      status: 'in_progress',
      importance: 1,
    });
    expect(
      createProjectSchema.parse({
        ...validProject,
        status: 'planning',
        importance: '3',
        notes: '  始修于光绪年间  ',
      })
    ).toMatchObject({
      status: 'planning',
      importance: 3,
      notes: '始修于光绪年间',
    });
  });

  it('enforces the 24-character name boundary', () => {
    expect(
      createProjectSchema.safeParse({ ...validProject, name: '谱'.repeat(24) })
        .success
    ).toBe(true);
    expect(
      createProjectSchema.safeParse({ ...validProject, name: '谱'.repeat(25) })
        .error?.issues[0].message
    ).toBe('项目名不能超过 24 个字符');
  });

  it('rejects whitespace-only required fields', () => {
    const cases = [
      ['name', '请输入项目名'],
      ['surname', '请输入姓氏'],
      ['countriesRegions', '请输入地区'],
      ['themeName', '请输入主题名'],
    ] as const;
    for (const [field, message] of cases) {
      expect(
        createProjectSchema.safeParse({ ...validProject, [field]: '   ' })
          .error?.issues[0].message
      ).toBe(message);
    }
  });

  it('rejects invalid rating, unknown status and overlong notes', () => {
    expect(
      createProjectSchema.safeParse({ ...validProject, importance: '0' })
        .error?.issues[0].message
    ).toBe('重要等级最低为 1 星');
    expect(
      createProjectSchema.safeParse({ ...validProject, importance: '6' })
        .error?.issues[0].message
    ).toBe('重要等级最高为 5 星');
    expect(
      createProjectSchema.safeParse({ ...validProject, importance: 'abc' })
        .success
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({ ...validProject, status: 'archived' })
        .success
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({
        ...validProject,
        notes: '注'.repeat(501),
      }).success
    ).toBe(false);
  });
});

describe('project update schema', () => {
  it('drops immutable fields and accepts mutable metadata', () => {
    const result = updateProjectSchema.parse({
      orgId: PROJECT_ORG_ID,
      projectId: PROJECT_ID,
      name: '新项目名',
      themeName: '李氏宗谱',
      surname: '李',
      status: 'completed',
      importance: '5',
    });

    expect(result).not.toHaveProperty('themeName');
    expect(result).not.toHaveProperty('surname');
    expect(result).toMatchObject({
      name: '新项目名',
      status: 'completed',
      importance: 5,
    });
  });

  it('enforces the name boundary and turns empty notes into null', () => {
    expect(
      updateProjectSchema.safeParse({
        orgId: PROJECT_ORG_ID,
        projectId: PROJECT_ID,
        name: '谱'.repeat(25),
      }).error?.issues[0].message
    ).toBe('项目名不能超过 24 个字符');
    expect(
      updateProjectSchema.parse({
        orgId: PROJECT_ORG_ID,
        projectId: PROJECT_ID,
        notes: '',
      }).notes
    ).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/auth-schemas.test.ts`
Expected: FAIL，现有 schema 要求 `primaryName` / `primarySurname`，且缺少 `status` / `importance` / `notes`。

- [ ] **Step 3: 改写 `lib/auth/schemas.ts` 中的项目 schema**

在文件顶部加入：

```ts
import {
  DEFAULT_PROJECT_IMPORTANCE,
  DEFAULT_PROJECT_STATUS,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_NOTES_LENGTH,
  MAX_PROJECT_REGIONS_LENGTH,
  MAX_PROJECT_SURNAME_LENGTH,
  MAX_PROJECT_THEME_NAME_LENGTH,
  PROJECT_IMPORTANCE_MAX,
  PROJECT_STATUS_VALUES,
} from '@/lib/project/constants';
```

在 `createProjectSchema` 前定义：

```ts
const projectStatus = z.enum(PROJECT_STATUS_VALUES, {
  required_error: '请选择项目状态',
  invalid_type_error: '请选择项目状态',
});

const projectImportance = z.coerce
  .number({
    required_error: '请选择重要等级',
    invalid_type_error: '请选择重要等级',
  })
  .int('重要等级必须是整数')
  .min(1, '重要等级最低为 1 星')
  .max(PROJECT_IMPORTANCE_MAX, `重要等级最高为 ${PROJECT_IMPORTANCE_MAX} 星`);
```

把 `createProjectSchema` 替换为：

```ts
export const createProjectSchema = z.object({
  orgId,
  name: z
    .string({ required_error: '请输入项目名' })
    .trim()
    .min(1, '请输入项目名')
    .max(
      MAX_PROJECT_NAME_LENGTH,
      `项目名不能超过 ${MAX_PROJECT_NAME_LENGTH} 个字符`
    ),
  surname: z
    .string({ required_error: '请输入姓氏' })
    .trim()
    .min(1, '请输入姓氏')
    .max(
      MAX_PROJECT_SURNAME_LENGTH,
      `姓氏不能超过 ${MAX_PROJECT_SURNAME_LENGTH} 个字符`
    ),
  themeName: z
    .string({ required_error: '请输入主题名' })
    .trim()
    .min(1, '请输入主题名')
    .max(
      MAX_PROJECT_THEME_NAME_LENGTH,
      `主题名不能超过 ${MAX_PROJECT_THEME_NAME_LENGTH} 个字符`
    ),
  countriesRegions: z
    .string({ required_error: '请输入地区' })
    .trim()
    .min(1, '请输入地区')
    .max(
      MAX_PROJECT_REGIONS_LENGTH,
      `地区不能超过 ${MAX_PROJECT_REGIONS_LENGTH} 个字符`
    ),
  status: projectStatus.default(DEFAULT_PROJECT_STATUS),
  importance: projectImportance.default(DEFAULT_PROJECT_IMPORTANCE),
  notes: optionalText(
    MAX_PROJECT_NOTES_LENGTH,
    `备注不能超过 ${MAX_PROJECT_NOTES_LENGTH} 个字符`
  ),
});
```

把 `updateProjectSchema` 替换为：

```ts
export const updateProjectSchema = z.object({
  orgId,
  projectId,
  name: z
    .string()
    .trim()
    .min(1, '请输入项目名')
    .max(
      MAX_PROJECT_NAME_LENGTH,
      `项目名不能超过 ${MAX_PROJECT_NAME_LENGTH} 个字符`
    )
    .optional(),
  countriesRegions: clearableText(
    MAX_PROJECT_REGIONS_LENGTH,
    `地区不能超过 ${MAX_PROJECT_REGIONS_LENGTH} 个字符`
  ),
  hallCode: clearableText(60, '郡望/堂号不能超过 60 个字符'),
  status: projectStatus.optional(),
  importance: projectImportance.optional(),
  notes: clearableText(
    MAX_PROJECT_NOTES_LENGTH,
    `备注不能超过 ${MAX_PROJECT_NOTES_LENGTH} 个字符`
  ),
});
```

不要在 update schema 中保留 `themeName` / `surname`；Zod 默认会剥离未知键，这是服务端不可修改性的第一道保证。

- [ ] **Step 4: 运行 schema 测试确认通过**

Run: `pnpm test tests/auth-schemas.test.ts`
Expected: PASS（原有 + 新增用例全绿）。

- [ ] **Step 5: 更新集成测试与 fixture（失败测试）**

把 `tests/integration/projects.test.ts` 的 `projectInput` 改为：

```ts
const projectInput = {
  name: '颍川陈氏云谱',
  surname: '陈',
  themeName: '颍川陈氏宗谱',
  countriesRegions: '中国福建',
  status: 'in_progress' as const,
  importance: 3,
  notes: '测试备注',
};
```

在第一个创建用例中追加：

```ts
expect(result.project).toMatchObject({
  name: '颍川陈氏云谱',
  surname: '陈',
  themeName: '颍川陈氏宗谱',
  countriesRegions: '中国福建',
  status: 'in_progress',
  importance: 3,
  notes: '测试备注',
});
```

新增更新用例（同文件）：

```ts
describe('updateProjectInTransaction metadata', () => {
  it('updates mutable fields and ignores crafted immutable fields', async () => {
    const { user, organization } = await setup();
    const created = await createProjectInTransaction({
      userId: user.id,
      orgId: organization.id,
      input: projectInput,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const crafted = {
      name: '颍川陈氏新谱',
      countriesRegions: '中国广东',
      status: 'completed',
      importance: 5,
      notes: '已完成续修',
      surname: '李',
      themeName: '李氏宗谱',
    } as unknown as ProjectUpdates;

    const result = await updateProjectInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: created.project.id,
      updates: crafted,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toMatchObject({
      name: '颍川陈氏新谱',
      countriesRegions: '中国广东',
      status: 'completed',
      importance: 5,
      notes: '已完成续修',
      surname: '陈',
      themeName: '颍川陈氏宗谱',
    });
  });
});
```

导入 `updateProjectInTransaction` 与 `type ProjectUpdates`。

把 `tests/integration/org-scope.test.ts` 第 28–32 行的 fixture 改为：

```ts
const projectInput = {
  name: '颍川陈氏云谱',
  surname: '陈',
  themeName: '陈实',
  countriesRegions: '中国福建',
  status: 'in_progress' as const,
  importance: 1,
};
```

- [ ] **Step 6: 运行集成测试确认失败**

Run: `pnpm test:integration tests/integration/projects.test.ts`
Expected: FAIL——现有服务的 `ProjectInput` 不接受 `surname` / `themeName`，且更新会直接展开 `updates`。

- [ ] **Step 7: 修改 `lib/db/services.ts` 类型与写入**

```ts
import type { ProjectStatus } from '@/lib/project/constants';

export type ProjectCreateInput = {
  name: string;
  surname: string;
  themeName: string;
  countriesRegions: string;
  status: ProjectStatus;
  importance: number;
  notes?: string | null;
};

export type ProjectMutableInput = {
  name: string;
  countriesRegions: string;
  hallCode?: string | null;
  status: ProjectStatus;
  importance: number;
  notes?: string | null;
};

export type ProjectUpdates = Partial<ProjectMutableInput>;
```

把 `createProjectInTransaction` 的 `input` 参数类型改成 `ProjectCreateInput`，插入改为显式字段：

```ts
const [project] = await tx
  .insert(projects)
  .values({
    name: input.name,
    surname: input.surname,
    themeName: input.themeName,
    countriesRegions: input.countriesRegions,
    status: input.status,
    importance: input.importance,
    notes: input.notes,
    // 旧列在 Task 5 删除前仍是 NOT NULL，暂时镜像新字段。
    primaryName: input.themeName,
    primarySurname: input.surname,
    orgId,
    ref: generatePublicId(),
    createdBy: userId,
  })
  .onConflictDoNothing()
  .returning();
```

- [ ] **Step 8: 让更新只写白名单字段**

在 `updateProjectInTransaction` 内，把直接 `set({ ...updates, ... })` 改成：

```ts
const mutable: ProjectUpdates = {};
if (updates.name !== undefined) mutable.name = updates.name;
if (updates.countriesRegions !== undefined) {
  mutable.countriesRegions = updates.countriesRegions;
}
if (updates.hallCode !== undefined) mutable.hallCode = updates.hallCode;
if (updates.status !== undefined) mutable.status = updates.status;
if (updates.importance !== undefined) mutable.importance = updates.importance;
if (updates.notes !== undefined) mutable.notes = updates.notes;

const [project] = await tx
  .update(projects)
  .set({ ...mutable, updatedAt: new Date() })
  .where(
    and(
      eq(projects.id, projectId),
      eq(projects.orgId, orgId),
      isNull(projects.deletedAt)
    )
  )
  .returning();
```

这样即使调用方在运行时塞入 `surname` / `themeName`，也不会进入 SQL。

- [ ] **Step 9: 修改 `lib/project/actions.ts`**

创建 action 的 `input` 改为：

```ts
input: {
  name: data.name,
  surname: data.surname,
  themeName: data.themeName,
  countriesRegions: data.countriesRegions,
  status: data.status,
  importance: data.importance,
  notes: data.notes,
},
```

更新 action 的 `updates` 只保留：

```ts
const updates: ProjectUpdates = {};
if (data.name !== undefined) updates.name = data.name;
if (data.countriesRegions !== undefined) {
  updates.countriesRegions = data.countriesRegions;
}
if (data.hallCode !== undefined) updates.hallCode = data.hallCode;
if (data.status !== undefined) updates.status = data.status;
if (data.importance !== undefined) updates.importance = data.importance;
if (data.notes !== undefined) updates.notes = data.notes;
```

删除 `data.primaryName` 与 `data.primarySurname` 两个赋值分支。

- [ ] **Step 10: 更新弹窗字段与测试工厂/种子数据**

`components/project/create-project-dialog.tsx`：

- `DialogTitle` 改为「创建云谱项目」。
- `DialogDescription` 改为「项目隶属于当前组织；姓氏与主题名创建后不可修改。」
- 删除「郡望 / 堂号」输入（本轮弹窗字段固定为七个，堂号仍在设置页维护）。
- 字段标签、id、name 改为：

| 标签 | id | name | maxLength |
|---|---|---|---|
| 项目名 * | `project-name` | `name` | `MAX_PROJECT_NAME_LENGTH` |
| 姓氏 * | `project-surname` | `surname` | `MAX_PROJECT_SURNAME_LENGTH` |
| 地区 * | `project-regions` | `countriesRegions` | `MAX_PROJECT_REGIONS_LENGTH` |
| 主题名 * | `project-theme-name` | `themeName` | `MAX_PROJECT_THEME_NAME_LENGTH` |

- 姓氏与主题名下方加提示「创建后不可修改」。
- `state.fieldErrors` 读取 `name` / `surname` / `countriesRegions` / `themeName`。
- 提交按钮文案改为 `确定`（pending 时 `创建中…`）。
- 保留 `noValidate` 与隐藏 `orgId`。

`tests/helpers/factories.ts` 的 `createProject` 参数改为 `themeName?` / `surname?`，并同时写新旧列：

```ts
const name = params.name ?? '测试云谱';
const themeName = params.themeName ?? name;
const surname = params.surname ?? '陈';
// ...
.values({
  orgId: params.orgId,
  createdBy: params.createdBy,
  name,
  themeName,
  surname,
  primaryName: themeName,
  primarySurname: surname,
  hallCode: params.hallCode ?? null,
  countriesRegions: params.countriesRegions ?? null,
  ref: params.ref ?? generatePublicId(),
})
```

`lib/db/seed.ts` 的两条演示项目同时写入新旧列：`themeName` / `surname` 填现有 `primaryName` / `primarySurname` 的值（`陈寔` / `陈`、`陈元光` / `陈`）。

`tests/integration/org-scope.test.ts` 第 331–332、349–350 行的直接插入继续使用旧列（Task 5 再切换），本轮不改。

- [ ] **Step 11: 更新 E2E 创建步骤（去掉星级/备注，保持可运行）**

把 `tests/e2e/critical-path.spec.ts` 第 31–38 行替换为：

```ts
await page.getByRole('button', { name: '新建空间' }).click();
const projectDialog = page.getByRole('dialog', { name: '创建云谱项目' });
await expect(projectDialog).toBeVisible();
await page.locator('#project-name').fill('E2E 云谱');
await page.locator('#project-surname').fill('陈');
await page.locator('#project-regions').fill('中国福建');
await page.locator('#project-theme-name').fill('E2E 陈氏宗谱');
await projectDialog.getByRole('button', { name: '确定' }).click();
await expect(page).toHaveURL(/\/dashboard\/project\/[^/]+$/);
```

- [ ] **Step 12: 运行全部验证**

Run: `pnpm test:integration`
Expected: PASS，含新字段持久化与不可变字段被忽略，`org-scope` 用例也通过。

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: PASS。

Run: `pnpm exec playwright test tests/e2e/critical-path.spec.ts -g "critical path"`
Expected: PASS。

- [ ] **Step 13: 提交**

```bash
git add lib/auth/schemas.ts lib/db/services.ts lib/project/actions.ts components/project/create-project-dialog.tsx tests/auth-schemas.test.ts tests/integration/projects.test.ts tests/integration/org-scope.test.ts tests/helpers/factories.ts lib/db/seed.ts tests/e2e/critical-path.spec.ts
git commit -m "feat(project): switch project identity to surname and theme name"
```

---

### Task 3: 星级组件与完整「创建云谱项目」弹窗

**Files:**
- Create: `components/ui/star-rating.tsx`
- Modify: `components/project/create-project-dialog.tsx`（补齐状态、星级、备注与提交拦截）
- Modify: `tests/e2e/critical-path.spec.ts:31-45`

**Interfaces:**
- Consumes: `createProjectAction`；Task 1 的常量。
- Produces:
  - `StarRating({ value, onChange, label = '重要等级', disabled = false }: { value: number; onChange: (value: number) => void; label?: string; disabled?: boolean })`
  - 弹窗新增稳定 id：`project-status`、`project-notes`；星级按钮可访问名称为 `"1 星"` … `"5 星"`，选中态用 `aria-pressed`。

- [ ] **Step 1: 先把 E2E 改成规格流程（失败测试）**

把 `tests/e2e/critical-path.spec.ts` 第 31–45 行的创建段替换为：

```ts
await page.getByRole('button', { name: '新建空间' }).click();
const projectDialog = page.getByRole('dialog', { name: '创建云谱项目' });
await expect(projectDialog).toBeVisible();

const submitProject = projectDialog.getByRole('button', { name: '确定' });
await expect(submitProject).toBeDisabled();

await projectDialog.getByRole('button', { name: '取消' }).click();
await expect(projectDialog).toBeHidden();
await page.getByRole('button', { name: '新建空间' }).click();
await expect(projectDialog).toBeVisible();

await page.locator('#project-name').fill('E2E 云谱');
await page.locator('#project-surname').fill('陈');
await page.locator('#project-regions').fill('中国福建');
await page.locator('#project-theme-name').fill('E2E 陈氏宗谱');

await expect(page.locator('#project-status')).toContainText('进行中');
await expect(
  projectDialog.getByRole('button', { name: '1 星' })
).toHaveAttribute('aria-pressed', 'true');
await projectDialog.getByRole('button', { name: '3 星' }).click();
for (const star of ['1 星', '2 星', '3 星']) {
  await expect(
    projectDialog.getByRole('button', { name: star })
  ).toHaveAttribute('aria-pressed', 'true');
}
await expect(
  projectDialog.getByRole('button', { name: '4 星' })
).toHaveAttribute('aria-pressed', 'false');

await page.locator('#project-notes').fill('E2E 备注');
await expect(submitProject).toBeEnabled();
await submitProject.click();
await expect(page).toHaveURL(/\/dashboard\/project\/[^/]+$/);
```

- [ ] **Step 2: 运行目标 E2E 确认失败**

Run: `pnpm exec playwright test tests/e2e/critical-path.spec.ts -g "critical path"`
Expected: FAIL，找不到 `#project-status` / `#project-notes` 或星级按钮。

- [ ] **Step 3: 创建 `components/ui/star-rating.tsx`**

```tsx
'use client';

import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const STARS = [1, 2, 3, 4, 5] as const;

export function StarRating({
  value,
  onChange,
  label = '重要等级',
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      {STARS.map((star) => {
        const selected = star <= value;
        return (
          <button
            key={star}
            type="button"
            aria-label={`${star} 星`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(star)}
            className="rounded-sm p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Star
              className={cn(
                'size-5',
                selected
                  ? 'fill-amber-500 text-amber-500'
                  : 'text-muted-foreground'
              )}
            />
          </button>
        );
      })}
      <span className="ml-2 text-xs text-muted-foreground">{value} 星</span>
    </div>
  );
}
```

- [ ] **Step 4: 补齐 `components/project/create-project-dialog.tsx`**

把 `import { useActionState, useEffect } from 'react'` 改为 `import { useActionState, useEffect, useState } from 'react'`，并新增：

```ts
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StarRating } from '@/components/ui/star-rating';
import {
  DEFAULT_PROJECT_IMPORTANCE,
  DEFAULT_PROJECT_STATUS,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_NOTES_LENGTH,
  MAX_PROJECT_REGIONS_LENGTH,
  MAX_PROJECT_SURNAME_LENGTH,
  MAX_PROJECT_THEME_NAME_LENGTH,
  PROJECT_STATUS_OPTIONS,
  type ProjectStatus,
} from '@/lib/project/constants';
```

在组件内维护受控状态：

```ts
const [name, setName] = useState('');
const [surname, setSurname] = useState('');
const [countriesRegions, setCountriesRegions] = useState('');
const [themeName, setThemeName] = useState('');
const [status, setStatus] = useState<ProjectStatus>(DEFAULT_PROJECT_STATUS);
const [importance, setImportance] = useState(DEFAULT_PROJECT_IMPORTANCE);
const [notes, setNotes] = useState('');

const canSubmit =
  name.trim().length > 0 &&
  surname.trim().length > 0 &&
  countriesRegions.trim().length > 0 &&
  themeName.trim().length > 0;
```

表单结构要求：

- 字段顺序：项目名、姓氏、地区、主题名、状态、重要等级、备注。
- 四个文本输入使用 `value` + `onChange` 受控，`maxLength` 使用常量；姓氏和主题名下方展示「创建后不可修改」。
- 必填标记：`<span aria-hidden="true" className="ml-0.5 text-destructive">*</span>`。
- 状态与星级不是原生表单控件，必须各有一个隐藏输入：

```tsx
<input type="hidden" name="status" value={status} />
<input type="hidden" name="importance" value={importance} />
```

- 状态选择器：

```tsx
<Select
  value={status}
  onValueChange={(value) => setStatus(value as ProjectStatus)}
>
  <SelectTrigger id="project-status" aria-label="状态">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {PROJECT_STATUS_OPTIONS.map((option) => (
      <SelectItem key={option.value} value={option.value}>
        {option.label}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

- 重要等级：`<StarRating value={importance} onChange={setImportance} />`。
- 备注：`<Textarea id="project-notes" name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={MAX_PROJECT_NOTES_LENGTH} />`。
- 在对应字段下展示 `state.fieldErrors?.name`、`surname`、`countriesRegions`、`themeName`、`notes`；底部保留 `state.error`。
- 提交按钮：`disabled={isPending || !canSubmit}`，文案 `isPending ? '创建中…' : '确定'`。
- 取消按钮保持 `DialogClose` + `取消`。
- 保留 `<form action={action} noValidate>` 与隐藏 `orgId`。

- [ ] **Step 5: 运行目标 E2E 与静态检查**

Run: `pnpm exec playwright test tests/e2e/critical-path.spec.ts -g "critical path"`
Expected: PASS，创建流程进入项目概览。

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add components/ui/star-rating.tsx components/project/create-project-dialog.tsx tests/e2e/critical-path.spec.ts
git commit -m "feat(project): build create-project dialog with status and rating"
```

---

### Task 4: 读取侧切换、设置页与概览元数据

**Files:**
- Modify: `components/project/project-settings-panel.tsx`
- Modify: `app/(dashboard)/dashboard/project/[projectRef]/settings/page.tsx`
- Modify: `app/(dashboard)/dashboard/project/[projectRef]/page.tsx`
- Modify: `components/project/project-workspace.tsx:23-35,91-106,199-207`
- Modify: `app/(dashboard)/dashboard/org/[orgSlug]/page.tsx:15-25`
- Modify: `app/(dashboard)/dashboard/project/[projectRef]/lineages/page.tsx:29`
- Modify: `app/(dashboard)/dashboard/project/[projectRef]/lineages/layout.tsx:27`
- Modify: `tests/e2e/critical-path.spec.ts`（创建成功后追加概览/设置断言）

**Interfaces:**
- Consumes: Task 1 的列与标签、Task 2 的更新契约、Task 3 的 `StarRating`。
- Produces: 设置页不再渲染姓氏/主题名输入框；概览显示主题名、姓氏、状态、重要等级、备注；所有读取侧对 null 兜底。

- [ ] **Step 1: 追加 E2E 断言（失败测试）**

在 `tests/e2e/critical-path.spec.ts` 创建成功并断言 URL 之后，把项目 ID 提取与谱系跳转改为：

```ts
const projectRef =
  new URL(page.url()).pathname.split('/').filter(Boolean).at(-1) ?? '';
expect(projectRef).not.toBe('');

await expect(page.getByText('进行中', { exact: true })).toBeVisible();
await expect(page.getByText('3 / 5', { exact: true })).toBeVisible();
await expect(page.getByText('E2E 备注', { exact: true })).toBeVisible();

await page.goto(`/dashboard/project/${projectRef}/settings`);
await expect(page.locator('input#project-surname')).toHaveCount(0);
await expect(page.locator('input#project-theme-name')).toHaveCount(0);
await expect(page.locator('#project-surname')).toHaveText('陈');
await expect(page.locator('#project-theme-name')).toHaveText('E2E 陈氏宗谱');
await expect(page.locator('#project-name')).toHaveValue('E2E 云谱');
await expect(page.locator('#project-notes')).toHaveValue('E2E 备注');
await expect(page.locator('#project-status')).toContainText('进行中');
await expect(
  page.getByRole('button', { name: '3 星' })
).toHaveAttribute('aria-pressed', 'true');

await page.goto(`/dashboard/project/${projectRef}/lineages`);
```

- [ ] **Step 2: 运行目标 E2E 确认失败**

Run: `pnpm exec playwright test tests/e2e/critical-path.spec.ts -g "critical path"`
Expected: FAIL，概览没有「进行中」/「3 / 5」/备注，设置页没有 `#project-surname` 只读展示。

- [ ] **Step 3: 更新设置页 props 与描述**

在 `app/(dashboard)/dashboard/project/[projectRef]/settings/page.tsx` 传给 `ProjectSettingsPanel`：

```tsx
surname={context.project.surname}
themeName={context.project.themeName}
status={context.project.status}
importance={context.project.importance}
notes={context.project.notes}
```

删除 `primaryName` / `primarySurname` 两个 prop，并把 `PageHeader` 描述改为：

```tsx
description="维护项目名、地区、状态、重要等级与备注；姓氏、主题名和项目 ID 创建后不可更改。"
```

- [ ] **Step 4: 改造 `ProjectSettingsPanel`**

Props 改为：

```ts
surname: string | null;
themeName: string | null;
status: ProjectStatus;
importance: number;
notes: string | null;
```

在解构参数时把两个初始值改名，避免与状态同名：

```ts
status: initialStatus,
importance: initialImportance,
```

新增受控状态：

```ts
const [status, setStatus] = useState<ProjectStatus>(initialStatus);
const [importance, setImportance] = useState(initialImportance);
```

导入 `Textarea`、`Select*`、`StarRating`、`projectStatusLabel` 不需要；需要的常量与类型：

```ts
import {
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_NOTES_LENGTH,
  MAX_PROJECT_REGIONS_LENGTH,
  PROJECT_STATUS_OPTIONS,
  type ProjectStatus,
} from '@/lib/project/constants';
```

表单要求：

- 姓氏与主题名改为只读展示，不再渲染输入框；只读值使用稳定 id 供 E2E 断言：

```tsx
<div>
  <p className="text-sm font-medium">姓氏</p>
  <p id="project-surname" className="text-sm text-muted-foreground">
    {surname ?? '—'}
  </p>
  <p className="text-xs text-muted-foreground">创建后不可修改</p>
</div>
<div>
  <p className="text-sm font-medium">主题名</p>
  <p id="project-theme-name" className="text-sm text-muted-foreground">
    {themeName ?? '—'}
  </p>
  <p className="text-xs text-muted-foreground">创建后不可修改</p>
</div>
```

- 项目名 `maxLength={MAX_PROJECT_NAME_LENGTH}`；地区 `maxLength={MAX_PROJECT_REGIONS_LENGTH}`。
- 保留 `hallCode` 输入（不影响创建流程）。
- 状态用 Radix `Select`，`id="project-status"`，`disabled={!canManage}`，选项来自 `PROJECT_STATUS_OPTIONS`。
- 重要等级用 `<StarRating value={importance} onChange={setImportance} disabled={!canManage} />`。
- 备注用 `<Textarea id="project-notes" name="notes" defaultValue={notes ?? ''} maxLength={MAX_PROJECT_NOTES_LENGTH} disabled={!canManage} />`。
- 增加隐藏输入：

```tsx
<input type="hidden" name="status" value={status} />
<input type="hidden" name="importance" value={importance} />
```

- 保存按钮逻辑保持不变。

- [ ] **Step 5: 更新项目概览**

在 `app/(dashboard)/dashboard/project/[projectRef]/page.tsx` 导入 `projectStatusLabel`，把 facts 改为：

```ts
const facts: { label: string; value: string; mono?: boolean }[] = [
  { label: '项目 ID', value: project.ref, mono: true },
  { label: '主题名', value: project.themeName ?? '—' },
  { label: '姓氏', value: project.surname ?? '—' },
  { label: '地区', value: project.countriesRegions ?? '—' },
  { label: '状态', value: projectStatusLabel(project.status) },
  { label: '重要等级', value: `${project.importance} / 5` },
  { label: '备注', value: project.notes ?? '—' },
  { label: '郡望 / 堂号', value: project.hallCode ?? '—' },
  { label: '创建时间', value: formatDate(project.createdAt), mono: true },
  { label: '最近更新', value: formatDate(project.updatedAt), mono: true },
];
```

- [ ] **Step 6: 修正项目卡片、搜索与组织页映射**

`components/project/project-workspace.tsx` 的 `ProjectView` 改为：

```ts
themeName: string | null;
surname: string | null;
```

删除 `primaryName` / `primarySurname`。搜索条件改为：

```ts
project.name.toLowerCase().includes(needle) ||
project.ref.toLowerCase().includes(needle) ||
project.themeName?.toLowerCase().includes(needle) ||
project.surname?.toLowerCase().includes(needle)
```

卡片正文改为：

```tsx
<p className="text-sm">
  {project.themeName ?? '未填写主题名'}
  {project.hallCode ? ` · ${project.hallCode}` : ''}
</p>
<p className="text-xs text-muted-foreground">
  {project.surname ? `${project.surname}氏` : '未填写姓氏'} ·{' '}
  {project.countriesRegions ?? '未填写地区'} ·{' '}
  <span className="font-mono">{project.ref}</span>
</p>
```

`app/(dashboard)/dashboard/org/[orgSlug]/page.tsx` 的映射改为：

```ts
themeName: project.themeName,
surname: project.surname,
```

删除 `primaryName` / `primarySurname`。

- [ ] **Step 7: 修正谱系默认姓氏**

`app/(dashboard)/dashboard/project/[projectRef]/lineages/page.tsx` 与 `layout.tsx`：

```tsx
defaultSurname={project.surname ?? ''}
```

- [ ] **Step 8: 运行目标 E2E 与检查**

Run: `pnpm exec playwright test tests/e2e/critical-path.spec.ts -g "critical path"`
Expected: PASS，含概览元数据与设置页只读断言。

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: PASS。

Run: `pnpm test:integration`
Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add components/project/project-settings-panel.tsx "app/(dashboard)/dashboard/project/[projectRef]/settings/page.tsx" "app/(dashboard)/dashboard/project/[projectRef]/page.tsx" components/project/project-workspace.tsx "app/(dashboard)/dashboard/org/[orgSlug]/page.tsx" "app/(dashboard)/dashboard/project/[projectRef]/lineages/page.tsx" "app/(dashboard)/dashboard/project/[projectRef]/lineages/layout.tsx" tests/e2e/critical-path.spec.ts
git commit -m "feat(project): show metadata and lock immutable settings"
```

---

### Task 5: 删除旧列（contract）

**Files:**
- Modify: `lib/db/schema.ts`（移除 `primaryName` / `primarySurname`）
- Modify: `lib/db/services.ts`（移除过渡期双写）
- Modify: `lib/db/seed.ts`
- Modify: `tests/helpers/factories.ts`
- Modify: `tests/integration/org-scope.test.ts:326-354`
- Modify: `tests/integration/projects.test.ts`（新增旧列已删除断言）
- Create: `lib/db/migrations/0005_*.sql`（由 `pnpm db:generate` 生成）

**Interfaces:**
- Consumes: Task 2–4 的所有读写已切到 `theme_name` / `surname`。
- Produces: `project` 表不再包含 `primary_name` / `primary_surname`。

**数据丢失**：该迁移永久删除两列及其数据，用户已确认接受。迁移必须在空库与已有库上都能一次执行。

- [ ] **Step 1: 写失败的“旧列已删除”集成测试**

在 `tests/integration/projects.test.ts` 追加（把 `getTestSql` 加入 `../helpers/db` 的导入）：

```ts
describe('project schema contract', () => {
  it('stores identity fields in theme_name/surname and drops legacy columns', async () => {
    const { user, organization } = await setup();
    const created = await createProjectInTransaction({
      userId: user.id,
      orgId: organization.id,
      input: projectInput,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.project.themeName).toBe('颍川陈氏宗谱');
    expect(created.project.surname).toBe('陈');

    const rows = await getTestSql()<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'project'
    `;
    const names = rows.map((row) => row.column_name);
    expect(names).not.toContain('primary_name');
    expect(names).not.toContain('primary_surname');
    expect(names).toEqual(expect.arrayContaining(['theme_name', 'surname']));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:integration tests/integration/projects.test.ts -t "drops legacy columns"`
Expected: FAIL，`primary_name` / `primary_surname` 仍在 `information_schema` 中。

- [ ] **Step 3: 移除 schema 旧列与双写**

`lib/db/schema.ts` 删除：

```ts
primaryName: text('primary_name').notNull(),
primarySurname: text('primary_surname').notNull(),
```

`lib/db/services.ts` 删除创建插入中的两行过渡双写：

```ts
primaryName: input.themeName,
primarySurname: input.surname,
```

`lib/db/seed.ts` 删除两条演示项目里的 `primaryName` / `primarySurname`。

`tests/helpers/factories.ts` 删除 `.values(...)` 中的 `primaryName` / `primarySurname`。

`tests/integration/org-scope.test.ts` 两处直接插入（越权项目、只读越权）改为：

```ts
themeName: '陈实',
surname: '陈',
```

- [ ] **Step 4: 生成并 review 删除迁移**

Run: `pnpm db:generate`
Expected: 生成新的 `0005_*.sql`，内容等价于：

```sql
ALTER TABLE "project" DROP COLUMN "primary_name";
ALTER TABLE "project" DROP COLUMN "primary_surname";
```

人工确认没有其他列被误删、没有数据修复语句。文件名使用 drizzle-kit 的实际输出。

- [ ] **Step 5: 执行迁移**

Run: `pnpm db:migrate`
Expected: 迁移成功。旧列数据不可恢复。

- [ ] **Step 6: 运行全部验证**

Run: `pnpm test:integration`
Expected: PASS，含旧列已删除断言。

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: PASS。

Run: `pnpm exec playwright test tests/e2e/critical-path.spec.ts -g "critical path"`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add lib/db/schema.ts lib/db/services.ts lib/db/seed.ts tests/helpers/factories.ts tests/integration/org-scope.test.ts tests/integration/projects.test.ts lib/db/migrations
git commit -m "refactor(db): drop legacy project primary columns"
```

---

### Task 6: 文档同步与全量验证

**Files:**
- Modify: `docs/data-model.md:311-345`
- Modify: `docs/implementation-status.md:36,49,90,154`
- Modify: `docs/prd.md:185`
- Modify: `docs/api.md:340-341`
- Modify: `AGENTS.md`（测试计数行，使用实际输出）

**Interfaces:**
- Consumes: Task 1–5 的最终行为与测试输出。

- [ ] **Step 1: 更新数据模型文档**

`docs/data-model.md` 的 `CREATE TABLE project` 改为：

```sql
CREATE TABLE project (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  ref               text NOT NULL DEFAULT public.generate_public_id(),
  name              text NOT NULL,
  surname           text,
  theme_name        text,
  countries_regions text,
  hall_code         text,
  status            text NOT NULL DEFAULT 'in_progress',
  importance        smallint NOT NULL DEFAULT 1,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_at        timestamptz,
  deleted_at        timestamptz,
  UNIQUE (organization_id, id),
  CHECK (status in ('planning', 'in_progress', 'completed')),
  CHECK (importance between 1 and 5)
);
```

列说明表替换 `primary_name` / `primary_surname` 两行：

| 列 | 说明 |
|---|---|
| `name` | 项目名，创建时 ≤24 字符 |
| `surname` | 姓氏「陈」，创建后不可修改；历史行可空 |
| `theme_name` | 主题名「陈氏族谱」，创建后不可修改；历史行可空 |
| `status` | 项目状态：`planning`（筹备中）/ `in_progress`（进行中）/ `completed`（已完成） |
| `importance` | 重要等级 1–5，默认 1 |
| `notes` | 备注，可空 |
| `hall_code` | 郡望堂号「颍川堂」，仅在设置页维护 |

- [ ] **Step 2: 更新实现状态、PRD 与 API 文档**

`docs/implementation-status.md`：

- 第 49 行 `project` 行字段改为 `name`/`surname`/`theme_name`/`hall_code`/`countries_regions`/`status`/`importance`/`notes`。
- 第 154 行 `FR-PROJ-1` 改为：弹窗采集项目名、姓氏、地区、主题名、状态、重要等级、备注；姓氏与主题名创建后不可修改；项目名 ≤24 字符；20 位 `ref` 由服务端生成。
- 第 36、90 行的测试文件/用例数改为实际输出。

`docs/prd.md` 的 `FR-PROJ-1` 验收标准改为同一口径：

```md
| FR-PROJ-1 | 创建云谱空间 | 填项目名、姓氏、地区、主题名，设置状态、重要等级与可选备注；姓氏与主题名创建后不可修改；项目名 ≤24 字符；服务端自动生成 20 位 `ref` 作为 URL 第二段 |
```

`docs/api.md`：

```md
| `createProject` | `{ orgSlug, name, surname, themeName, countriesRegions, status?, importance?, notes? }` | `Project` | `project.write` |
| `updateProject` | `{ orgSlug, projectId, name?, countriesRegions?, hallCode?, status?, importance?, notes? }`（`surname` / `themeName` 不可修改） | `Project` | `project.write` |
```

不要修改 `docs/decisions/0001-foundation-reset.md` 与 `docs/.backup-2026-10-22/`。

- [ ] **Step 3: 更新测试计数**

运行 `pnpm test` 与 `pnpm test:integration`，把 `AGENTS.md` 技术形态表中的测试文件/用例数与 `docs/implementation-status.md` 的测试行更新为实际输出。不要凭空估数。

- [ ] **Step 4: 全量验证**

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: 全绿。

Run: `pnpm test:integration`
Expected: 全绿（需要 `_test` 数据库）。

Run: `pnpm test:e2e`
Expected: 2 条关键路径全绿。

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 5: 提交**

```bash
git add docs/data-model.md docs/implementation-status.md docs/prd.md docs/api.md AGENTS.md
git commit -m "docs(project): document project creation metadata"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-24-create-project-dialog.md`.

用户已选择 **Native** 执行方式：在当前会话按任务顺序实现，使用 `superpowers:executing-plans`，最后对整个分支做一次统一评审。执行时每个任务必须以实际测试输出作为完成证据；Task 5 的旧列删除是破坏性迁移，只在本计划批准后执行。
