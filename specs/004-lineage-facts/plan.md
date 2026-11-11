# 谱系数据说真话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户点的性别、写下的姓和名、以及「人丁已删除」这三句话，和 PostgreSQL 里的行一致；空闲槽位上的整棵子树用一条 `UPDATE` 搬走；永远失败的配偶入口从写路径和界面消失。

**Architecture:** 不新增映射表，不新增 family 写入层。`person.sex` 的四值文本从 Zod 一直传到视图。姓进 `person.surname`，名进 `person_name.value`（`kind = 'given'`），全名只在读的时候拼接、绝不反向切分。删 `node` 的同一个事务里清掉不再被任何节点引用的 `event` / `person_name` / `person`。移树沿用基线用例 P13 已经证明的语句级更新：非延迟外键在语句结束时检查，空槽不需要临时前缀。`node-services.ts` 已在 400 行豁免天花板下，新逻辑放进新文件，该文件只许变短、不许超过 `scripts/check-file-size.mjs` 里登记的 820 行。

**Tech Stack:** Next.js 16.4.6、React 19、TypeScript、Zod 4、Drizzle ORM、`pg`、PostgreSQL 18（`ltree`）、Vitest。

## Global Constraints

以下每条都是仓库里已经写死的约束，每个任务都默认遵守：

- Node.js `>=26.0.0 <27`，运行时锚点 `26.13.0`；pnpm `>=12.0.0 <13`（当前 `12.18.0`）。
- 组织级读写在服务端做成员与角色校验；权限判定用权限串，不比较角色名；公开 ID 只定位，不当授权凭证；非成员与不存在的资源一律 404。
- 业务侧不读写 `auth` schema，只引用用户 ID。
- 业务域多步写收敛到单个事务；失败不留半成品行。
- 行为变更先写会失败的测试，确认变红，再改到变绿。涉及 SQL、约束、成员隔离、多步事务的改动跑真实 PostgreSQL 集成测试。
- 不新增后台任务、队列、定时器、独立缓存层，不引入 i18n。界面文案简体中文。
- 目标态业务表无软删列，删除是 `ON DELETE RESTRICT`。本计划不把软删加回来。
- 迁移与业务代码分开提交。提交信息 `<type>(<scope>): <描述>`。
- 单文件超过 400 行且不在豁免清单里，`pnpm arch:check` 失败。豁免是天花板：文件变长超过登记行数失败；缩到 400 行及以下时，从 `scripts/check-file-size.mjs` 的 `EXEMPT` 删掉该条。
- 已在生产应用过的 `lib/db/migrations/0000_target_schema.sql` 不回改。Drizzle 按文件哈希判断迁移是否被改过，回改会让已有库的 `pnpm db:migrate` 拒绝启动，而 `db:reset-target` 会清空库。加列用下一号迁移。
- 不交付半成品业务功能。`family` / `family_partner` / `family_child` 本计划不写入。

## 为什么不是六件事一起做

前一份评审有六条建议。本计划做前五条，它们共用 `NodeView`、谱系写入和同一组测试，做完是一条能独立上线的谱系行为。第六条（`ActionState` 去掉可选的 `nodeId` / `spouseId`）横跨认证、组织、项目、谱文，单独立项，不放进这次 diff。兄弟重排仍然返回 `not_supported`：对调两个已占用的路径会在语句中途撞上唯一约束，那是另一种操作，不借移树的空槽语句蒙混。

## Constitution Check

| 编号 | 判定 | 依据 |
| --- | --- | --- |
| I | 符合 | 新写路径仍走 `withLineageWrite` → `withOrgWrite`，事务内 `lineage.write` |
| II | 符合 | 不读 `auth` schema |
| III | 符合 | 移树、删节点、清事实行在同一个 `withLineageWrite` 事务里 |
| IV | 符合 | 每个任务先改测试并跑红 |
| V | 符合 | 姓是现有人物行上的一列，不是新表；配偶入口删掉而不是再包一层 |

---

### Task 1: 性别只保留 `person.sex` 四值

**Files:**
- Modify: `lib/genealogy/schemas.ts`（`sex` 预处理，约 54–70 行）
- Modify: `lib/db/queries/nodes.ts`（`toNodeViewRows` 的 `sex` 赋值，约 112 行）
- Modify: `components/lineage/types.ts`（`NodeView.sex`、`NodeRow.sex`）
- Create: `components/lineage/sex.ts`
- Modify: `components/lineage/derived.ts`、`components/lineage/lineage-detail.tsx`、`components/lineage/person-inspector.tsx`、`components/lineage/node-create-dialog.tsx`、`components/lineage/canvas/genealogy-canvas.tsx`
- Modify: `tests/lineage-schemas.test.ts`、`tests/integration/query-fallbacks.test.ts`、`tests/lineage-canvas-layout.test.ts`
- Test: `tests/node-view-projection.test.ts`
- Modify: `docs/modules/lineage.md` 投影表里 `sex` 那一行

**Interfaces:**
- Consumes: `PersonSex`（`lib/genealogy/constants.ts`）：`'male' | 'female' | 'other' | 'unknown'`
- Produces: `NodeView.sex: PersonSex`。`sexLabel(sex: PersonSex): string`。表单字段 `sex` 的合法值就是这四个字符串，`0` / `1` 不再被接受。

- [ ] **Step 1: Write the failing test**

新建 `tests/node-view-projection.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { toNodeViewRows } from '@/lib/db/queries/nodes';

const base = {
  id: 'n1',
  path: '0010',
  parentPath: null,
  kind: 'primary',
  displayName: null,
  primaryName: '实',
  surname: '陈',
};

describe('toNodeViewRows sex', () => {
  it('keeps the database sex value', () => {
    const [row] = toNodeViewRows([{ ...base, sex: 'male' }]);
    expect(row?.sex).toBe('male');
  });

  it('does not collapse female, other, or unknown into one flag', () => {
    const rows = toNodeViewRows([
      { ...base, id: 'f', sex: 'female' },
      { ...base, id: 'o', path: '0020', sex: 'other' },
      { ...base, id: 'u', path: '0030', sex: 'unknown' },
    ]);
    expect(rows.map((row) => row.sex)).toEqual([
      'female',
      'other',
      'unknown',
    ]);
  });
});
```

在 `tests/lineage-schemas.test.ts` 把第一条例改成断言四值，并加一条拒绝旧旗标：

```ts
it('accepts a person sex and rejects the legacy 0/1 flag', () => {
  const parsed = createRootNodeSchema.parse({
    orgId,
    lineageId,
    requestId,
    name: '元英',
    surname: '陈',
    sex: 'male',
  });
  expect(parsed.sex).toBe('male');

  const rejected = createRootNodeSchema.safeParse({
    orgId,
    lineageId,
    requestId,
    name: '元英',
    sex: '0',
  });
  expect(rejected.success).toBe(false);
});
```

同文件里其余 `sex: '0'` / `sex: 0` 改成 `sex: 'male'`，`sex: '1'` / `sex: 1` 改成 `sex: 'female'`。原来期望 `sex: '0'` 解析成 `'female'` 的断言删掉，那是双反转的锁。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/node-view-projection.test.ts tests/lineage-schemas.test.ts`

Expected: FAIL。投影测试收到 `1` / `0` 而不是 `'male'`。schema 测试里 `sex: '0'` 仍被解析成 `'female'`，`success` 为 true。

- [ ] **Step 3: Write minimal implementation**

`lib/genealogy/schemas.ts` 替换 `sex`：

```ts
const sex = z.enum(PERSON_SEX_VALUES, { error: '请选择性别' });
```

删掉 `z.preprocess` 里 `0 → female`、`1 → male` 的分支。

`lib/db/queries/nodes.ts` 的 `toNodeViewRows` 里：

```ts
sex: row.sex === 'male' ||
  row.sex === 'female' ||
  row.sex === 'other' ||
  row.sex === 'unknown'
  ? row.sex
  : 'unknown',
```

`components/lineage/types.ts`：`NodeView.sex` 与 `NodeRow.sex` 改为 `PersonSex`。从 `@/lib/genealogy/constants` 引入类型。这个文件会被客户端打包，只允许引入类型和常量，不要引入 `lib/db`。

新建 `components/lineage/sex.ts`：

```ts
import type { PersonSex } from '@/lib/genealogy/constants';

export function sexLabel(sex: PersonSex): string {
  switch (sex) {
    case 'male':
      return '男';
    case 'female':
      return '女';
    case 'other':
      return '其他';
    case 'unknown':
      return '不详';
  }
}

export function rankSuffix(sex: PersonSex): '子' | '女' | '人' {
  if (sex === 'male') return '子';
  if (sex === 'female') return '女';
  return '人';
}
```

`components/lineage/derived.ts` 的 `rankLabel`：

```ts
const labels =
  node.sex === 'female'
    ? RANK_LABELS.female
    : node.sex === 'male'
      ? RANK_LABELS.male
      : null;
const suffix = rankSuffix(node.sex);
return labels?.[order] ?? `第${order + 1}${suffix}`;
```

`RANK_LABELS` 只给男、女。`other` / `unknown` 走「第 N 人」，不要再显示成子或女。

界面上所有 `sex === 1 ? '女' : '男'` 改成 `sexLabel(node.sex)`。涉及：

- `components/lineage/lineage-detail.tsx` 的 `SexLabel`
- `components/lineage/person-inspector.tsx` 标题行和 `<select>`

`<select>` 改成四个选项，值就是库存文本：

```tsx
<select id="inspector-sex" name="sex" defaultValue={node.sex}>
  <option value="male">男</option>
  <option value="female">女</option>
  <option value="other">其他</option>
  <option value="unknown">不详</option>
</select>
```

`components/lineage/node-create-dialog.tsx` 的性别 state 改为 `PersonSex`，默认 `'male'`。单选框：

```tsx
<input type="radio" name="sex" value="male" checked={sex === 'male'} onChange={() => setSex('male')} />
<input type="radio" name="sex" value="female" checked={sex === 'female'} onChange={() => setSex('female')} />
```

`tests/lineage-canvas-layout.test.ts` 里 `NodeView` 夹具的 `sex: 0` 改成 `sex: 'male'`，`sex: 1` 改成 `sex: 'female'`。`spouseOf` 里 `blood.sex === 0 ? 1 : 0` 改成 `blood.sex === 'male' ? 'female' : 'male'`。本任务不删配偶布局分支，只让夹具类型能通过。

`tests/integration/query-fallbacks.test.ts` 里 `expect(parent?.sex).toBe(1)` 改成 `toBe('male')`，子节点 `toBe(0)` 改成 `toBe('female')`（该夹具的 sex 是 `'female'`）。

`docs/modules/lineage.md` 投影表 `sex` 行改成：`` `person.sex` 原值（`male` / `female` / `other` / `unknown`），缺失时 `unknown` ``。不要在这里再写一份枚举说明。

拖拽瓦片本任务只改到能编译，不改成「女眷 = 添加女儿」。那是 Task 6。`components/lineage/canvas/genealogy-canvas.tsx` 里：

```ts
type DragTemplate = { sex: 'male' | 'female' };
```

放下时：

```ts
if (template.sex === 'female') {
  onCreateSpouse(nearest.id);
} else {
  onCreateChild(nearest.id);
}
```

两个瓦片的 `setData` 分别改为 `JSON.stringify({ sex: 'male' })` 与 `JSON.stringify({ sex: 'female' })`。`onCreateChild` 的参数列表本任务不变。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/node-view-projection.test.ts tests/lineage-schemas.test.ts tests/lineage-canvas-layout.test.ts && pnpm typecheck`

Expected: PASS，`tsc` 无错误。

- [ ] **Step 5: Commit**

```bash
git add lib/genealogy/schemas.ts lib/db/queries/nodes.ts components/lineage docs/modules/lineage.md tests/node-view-projection.test.ts tests/lineage-schemas.test.ts tests/lineage-canvas-layout.test.ts tests/integration/query-fallbacks.test.ts
git commit -m "fix(ui): 性别沿用 person.sex，去掉 0/1 双反转"
```

---

### Task 2: 给 `person` 加可空 `surname` 列

**Files:**
- Modify: `lib/db/schema/person.ts`
- Create: `lib/db/migrations/0001_person_surname.sql`（由 `pnpm db:generate` 生成后核对正文）
- Modify: `lib/db/migrations/meta/0000_snapshot.json`、`lib/db/migrations/meta/_journal.json`（generate 改）
- Modify: `scripts/verify-target-schema.mjs` 的 `verifyDdl`
- Modify: `docs/data-model.md` 人物表那一行
- Modify: `docs/adr/README.md` §3 追加 `0023`
- Test: `tests/integration/person-surname-column.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `persons.surname`，TypeScript 字段 `surname: string | null`。列可空。非空时 `btrim(surname) <> ''`。已有行保持 `NULL`，不做按末字拆姓的回填。

- [ ] **Step 1: Write the failing test**

新建 `tests/integration/person-surname-column.test.ts`。错误码用已有的 `pgErrorCode`（`tests/helpers/db.ts`），语句用 `getTestSql`，和 `tests/integration/fact-person.test.ts` 相同：

```ts
import { describe, expect, it } from 'vitest';
import { getTestSql, pgErrorCode } from '../helpers/db';
import { createProject, createUser, getPersonalOrg } from '../helpers/factories';

async function sqlState(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return pgErrorCode(error);
  }
}

describe('person.surname', () => {
  it('allows a null surname and rejects a blank one', async () => {
    const user = await createUser();
    const personal = await getPersonalOrg(user.id);
    if (!personal) throw new Error('missing personal org');
    const project = await createProject({
      orgId: personal.organization.id,
      createdBy: user.id,
    });
    const sql = getTestSql();
    expect(
      await sqlState(
        () => sql`
          insert into person (organization_id, project_id)
          values (${personal.organization.id}, ${project.id})
        `
      )
    ).toBeUndefined();
    expect(
      await sqlState(
        () => sql`
          update person
          set surname = '   '
          where project_id = ${project.id}
        `
      )
    ).toBe('23514');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration -- tests/integration/person-surname-column.test.ts`

Expected: FAIL。列不存在时 INSERT/UPDATE 报 `42703`（undefined_column），不是 `23514`。

- [ ] **Step 3: Write minimal implementation**

`lib/db/schema/person.ts` 的 `persons` 列，放在 `sex` 与 `createdAt` 之间：

```ts
surname: text('surname'),
```

同一张表的约束数组追加：

```ts
check(
  'person_surname_not_blank',
  sql`${t.surname} is null or btrim(${t.surname}) <> ''`
),
```

然后生成迁移，不要手改 `0000_target_schema.sql`：

Run: `pnpm db:generate`

Expected: 新文件 `lib/db/migrations/0001_*.sql`，journal 多一条，snapshot 的 `public.person.columns` 出现 `surname`。

打开生成的 SQL。正文必须等价于：

```sql
ALTER TABLE "person" ADD COLUMN "surname" text;
ALTER TABLE "person" ADD CONSTRAINT "person_surname_not_blank" CHECK ("person"."surname" is null or btrim("person"."surname") <> '');
```

若 generate 另起了表或改了无关对象，删掉该迁移，只保留上面两句，journal 与 snapshot 仍用 generate 的结果。不回填旧的 `person_name.value`。

`scripts/verify-target-schema.mjs` 的 `verifyDdl`：在执行完 `0000_target_schema.sql` 且没有错误之后，按文件名排序执行 `lib/db/migrations/` 下其余 `*.sql`（跳过 `0000`）。每一份都 `sql.unsafe`。任一失败仍走现在的 `fail('T37 ...')` 并 return false。对象计数断言保持在全部 SQL 执行完之后。这样 parity 看得到 `surname`，已部署的库也不必重放被改过的 `0000`。

`docs/data-model.md` 人物表 `person` 行的关键列加上 `surname`（可空，非空则 trim 后非空）。不要把 DDL 再抄一遍。

`docs/adr/README.md` §3 表追加一行，旧行不改：

```text
| `0023` | `person.surname` 存录入的姓，`person_name.value`（kind=given）只存名；已应用的 0000 不回改，用下一号迁移加列 | `accepted` | 2026-11-11 | 单向门 | 回改 0000 会让已迁移库拒绝启动；按末字拆旧全名会写错复姓 |
```

提交信息标题含 `ADR 0023`，正文写：考虑过回改 `0000` 并 `db:reset-target`，否决，因为变更记录里生产库已经应用过该基线，清空库才能加一列可空字段不值得。也考虑过把姓塞进 `person_name.kind = 'other'`，否决，因为 `other` 不是姓。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:integration -- tests/integration/person-surname-column.test.ts`

Expected: PASS。

再跑：`pnpm db:generate`

Expected: 不再产生新的迁移文件。若提示要生成，说明 snapshot 和 `person.ts` 不一致，修到这条命令为空操作。

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema/person.ts lib/db/migrations scripts/verify-target-schema.mjs docs/data-model.md docs/adr/README.md tests/integration/person-surname-column.test.ts
git commit -m "feat(db): ADR 0023 — person.surname 用下一号迁移，不回改 0000"
```

---

### Task 3: 姓和名分开存，读路径不再切最后一个字

**Files:**
- Modify: `lib/lineage/node-services.ts` 的 `recordNode` 与 `updateNodeInTransaction`
- Modify: `lib/db/queries/nodes.ts` 的查询列与 `toNodeViewRows`
- Modify: `docs/modules/lineage.md` 投影表 `fullName` / `surname` / `name` 行
- Test: `tests/node-view-projection.test.ts`、`tests/integration/node-services.test.ts`

**Interfaces:**
- Consumes: `persons.surname`（Task 2）、`CreateInput.surname` / `CreateInput.name`（已有）
- Produces: `NodeProjectionInput.surname: string | null`。`toNodeViewRows` 的 `surname` 来自该列，`name` 来自 primary `person_name.value`，`fullName` 是两者直接拼接。`node.display_name` 不再写入，也不再作为回退。

- [ ] **Step 1: Write the failing test**

在 `tests/node-view-projection.test.ts` 追加：

```ts
it('does not invent a surname by cutting the last character', () => {
  const [row] = toNodeViewRows([
    {
      ...base,
      surname: '司马',
      primaryName: '相如',
      sex: 'male',
    },
  ]);
  expect(row?.surname).toBe('司马');
  expect(row?.name).toBe('相如');
  expect(row?.fullName).toBe('司马相如');
});
```

在 `tests/integration/node-services.test.ts` 追加（`createParams` 已经传 `surname: '陈'`、`name: '实'`）：

```ts
it('stores the surname on person and the given name on person_name', async () => {
  const ctx = await setup();
  const created = await createRootNodeInTransaction(
    createParams(ctx, { surname: '司马', name: '相如' })
  );
  if (!created.ok) throw new Error('create failed');
  const db = getTestDb();
  const [person] = await db.select().from(persons);
  const [given] = await db
    .select()
    .from(personNames)
    .where(eq(personNames.isPrimary, true));
  expect(person?.surname).toBe('司马');
  expect(given?.value).toBe('相如');
  expect(created.node.displayName).toBeNull();

  const views = await getNodes(ctx.user.id, ctx.orgId, ctx.lineage.id);
  expect(views[0]).toMatchObject({
    surname: '司马',
    name: '相如',
    fullName: '司马相如',
  });
});
```

从 `@/lib/db/schema` 引入 `persons`、`personNames`，从 `drizzle-orm` 引入 `eq`。文件顶部已有 `getNodes` 则复用，没有就从 `@/lib/db/queries/nodes` 引入。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/node-view-projection.test.ts && pnpm test:integration -- tests/integration/node-services.test.ts`

Expected: 单元测试 FAIL（`surname` 仍是「司马相」、`name` 是「如」，或字段尚未从列读取）。集成测试 FAIL（`person_name.value` 仍是 `司马相如`，或 `displayName` 不是 null）。

- [ ] **Step 3: Write minimal implementation**

`recordNode` 去掉 `const displayName = ...` 拼接。插入人物：

```ts
const surname = input.surname.trim();
const [person] = await tx
  .insert(persons)
  .values({
    orgId,
    projectId,
    sex: input.sex,
    surname: surname || null,
  })
  .returning({ id: persons.id });
```

`person_name.value` 改为 `input.name`，不要拼姓。`nodes` 插入时不要带 `displayName`（列默认空，Drizzle 省略即 NULL）。

`updateNodeInTransaction` 同样：

```ts
const surname = updates.surname.trim();
await tx
  .update(persons)
  .set({ sex: updates.sex, surname: surname || null })
  .where(
    and(eq(persons.projectId, lineage.projectId), eq(persons.id, current.personId))
  );
await tx
  .update(personNames)
  .set({ value: updates.name })
  .where(
    and(
      eq(personNames.projectId, lineage.projectId),
      eq(personNames.personId, current.personId),
      eq(personNames.isPrimary, true)
    )
  );
```

后面的 `update(nodes).set({ displayName })` 整段删除。返回值仍用 `loadNode` 或 `returning()` 读到的行，只是 `displayName` 保持 null。若 `current.personId` 为空（批注节点），不要更新 person。现有代码已有这个判断，保留。

`getNodes` 的 select 增加 `surname: persons.surname`。`NodeProjectionInput` 增加 `surname?: string | null`。

`toNodeViewRows`：

```ts
const surname = row.surname?.trim() ?? '';
const name = row.primaryName ?? '';
const fullName = `${surname}${name}`;
```

删除 `fullName.slice(0, -1)` 和 `slice(-1)`。`displayName` 不再参与姓名。姓为空时 `fullName === name`，这是没有姓的人，不是启发式。

`docs/modules/lineage.md`：

- 三表写入第 2 步改为 `` `INSERT person (sex, surname)`；`person_name.value` 只写名 ``
- 投影表 `fullName` 改为「`surname` 与 primary `person_name.value` 直接拼接」
- `surname` / `name` 行改为「列与主名，不切分」
- 编辑一节删掉「更新 `node.display_name`」

现有集成测试若断言 `displayName` 为「陈实」，改成 `toBeNull()`，并断言 `person_name.value` 为名、`person.surname` 为姓。不要为了让旧断言继续绿而把拼接写回去。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/node-view-projection.test.ts && pnpm test:integration -- tests/integration/node-services.test.ts tests/integration/query-fallbacks.test.ts && pnpm arch:check`

Expected: PASS。`node-services.ts` 行数不超过 820。

- [ ] **Step 5: Commit**

```bash
git add lib/lineage/node-services.ts lib/db/queries/nodes.ts docs/modules/lineage.md tests/node-view-projection.test.ts tests/integration/node-services.test.ts tests/integration/query-fallbacks.test.ts
git commit -m "fix(lineage): 姓存 person.surname，名存 person_name，不再切最后一个字"
```

---

### Task 4: 删除节点时，同一事务清掉失去引用的事实行

**Files:**
- Create: `lib/lineage/delete-facts.ts`
- Modify: `lib/lineage/node-services.ts` 的 `deleteNodeInTransaction`
- Modify: `lib/lineage/services.ts` 的 `deleteLineageInTransaction`
- Modify: `docs/modules/lineage.md` §2.6
- Test: `tests/integration/node-services.test.ts`、`tests/integration/folders-lineages.test.ts`（若已有删谱系用例则补断言，否则只加在 node-services 测试）

**Interfaces:**
- Consumes: `DbTransaction`、`events` / `personNames` / `persons` / `nodes`
- Produces:

```ts
export async function deleteUnreferencedPersons(
  tx: DbTransaction,
  scope: { orgId: string; projectId: string },
  personIds: readonly string[]
): Promise<number>
```

返回实际删掉的 `person` 行数。`personIds` 为空时返回 0，不发 SQL。

- [ ] **Step 1: Write the failing test**

在 `tests/integration/node-services.test.ts` 已有的删除用例旁追加：

```ts
it('removes the person, names, and events when the last node is deleted', async () => {
  const ctx = await setup();
  const root = await createRootNodeInTransaction(createParams(ctx));
  if (!root.ok) throw new Error('root failed');
  const child = await addChildInTransaction({
    ...createParams(ctx, { name: '二', surname: '陈' }),
    parentId: root.node.id,
  });
  if (!child.ok) throw new Error('child failed');

  const deleted = await deleteNodeInTransaction({
    userId: ctx.user.id,
    orgId: ctx.orgId,
    lineageId: ctx.lineage.id,
    nodeId: child.node.id,
  });
  expect(deleted.ok).toBe(true);

  const db = getTestDb();
  const people = await db.select().from(persons);
  const names = await db.select().from(personNames);
  const factEvents = await db.select().from(events);
  expect(people).toHaveLength(1);
  expect(names.every((row) => row.personId === people[0]?.id)).toBe(true);
  expect(factEvents.every((row) => row.personId === people[0]?.id)).toBe(true);
});
```

始祖不可删，所以删的是子女。删完后库里只剩始祖那一位 person。现在的实现会留下子女的 person，测试 FAIL。

再补一条谱系删除：

```ts
it('drops every person of a lineage when that lineage is deleted', async () => {
  const ctx = await setup();
  const root = await createRootNodeInTransaction(createParams(ctx));
  if (!root.ok) throw new Error('root failed');
  const result = await deleteLineageInTransaction({
    userId: ctx.user.id,
    orgId: ctx.orgId,
    lineageId: ctx.lineage.id,
  });
  expect(result.ok).toBe(true);
  expect(await getTestDb().select().from(persons)).toEqual([]);
});
```

从 `lib/lineage/services.ts` 引入 `deleteLineageInTransaction`。权限是 `lineage.delete`，测试用户是组织 owner，已有权限。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration -- tests/integration/node-services.test.ts`

Expected: FAIL。`people` 长度大于 1；删谱系后 `persons` 仍有行。

- [ ] **Step 3: Write minimal implementation**

新建 `lib/lineage/delete-facts.ts`：

```ts
import 'server-only';

import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/drizzle';
import { events, nodes, personNames, persons } from '@/lib/db/schema';

export async function deleteUnreferencedPersons(
  tx: DbTransaction,
  scope: { orgId: string; projectId: string },
  personIds: readonly string[]
): Promise<number> {
  const ids = [...new Set(personIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return 0;

  const stillUsed = await tx
    .select({ personId: nodes.personId })
    .from(nodes)
    .where(
      and(
        eq(nodes.orgId, scope.orgId),
        eq(nodes.projectId, scope.projectId),
        inArray(nodes.personId, ids)
      )
    );
  const used = new Set(
    stillUsed
      .map((row) => row.personId)
      .filter((id): id is string => id !== null)
  );
  const orphanIds = ids.filter((id) => !used.has(id));
  if (orphanIds.length === 0) return 0;

  await tx
    .delete(events)
    .where(
      and(
        eq(events.orgId, scope.orgId),
        eq(events.projectId, scope.projectId),
        inArray(events.personId, orphanIds)
      )
    );
  await tx
    .delete(personNames)
    .where(
      and(
        eq(personNames.orgId, scope.orgId),
        eq(personNames.projectId, scope.projectId),
        inArray(personNames.personId, orphanIds)
      )
    );
  const removed = await tx
    .delete(persons)
    .where(
      and(
        eq(persons.orgId, scope.orgId),
        eq(persons.projectId, scope.projectId),
        inArray(persons.id, orphanIds)
      )
    )
    .returning({ id: persons.id });
  return removed.length;
}
```

上面的 `notExists` 与 `sql` 若未使用，不要留下未使用的 import。Biome 会因此失败。

`deleteNodeInTransaction` 在删除节点时 `returning({ id: nodes.id, personId: nodes.personId })`。`withLineageWrite` 的回调已经拿到 `lineage`，用 `lineage.projectId`。节点删完后：

```ts
await deleteUnreferencedPersons(
  tx,
  { orgId, projectId: lineage.projectId },
  deleted.flatMap((row) => (row.personId ? [row.personId] : []))
);
```

函数签名把现在的 `async (tx) =>` 改成 `async (tx, lineage) =>`。始祖仍返回 `root_forbidden`，不删事实行。

`deleteLineageInTransaction` 的 select 带上 `projectId`。删节点时 `returning({ personId: nodes.personId })`，然后调用同一个 helper。谱系行仍在节点之后删除。

不要在这里删 `folder`。项目删除仍会因分类、空谱系以外的子表拒绝，那是另一条路径。本任务只保证：节点没了，且没有别的节点引用这个人，人就没了。`family_*` 若将来引用了这个人，`RESTRICT` 会让整个事务失败并回滚节点删除，不要 catch 后假装成功。

`docs/modules/lineage.md` §2.6 改成：删的是子树上的 `node`，然后同一事务删除不再被任何 `node.person_id` 引用的 `event`、`person_name`、`person`。删掉「事实行不会被级联清理」那句。成功文案「人丁已一并删除」到此与库一致，文案本身不用改。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:integration -- tests/integration/node-services.test.ts && pnpm arch:check`

Expected: PASS。`delete-facts.ts` 低于 400 行。`node-services.ts` 不超过 820 行。

- [ ] **Step 5: Commit**

```bash
git add lib/lineage/delete-facts.ts lib/lineage/node-services.ts lib/lineage/services.ts docs/modules/lineage.md tests/integration/node-services.test.ts
git commit -m "fix(lineage): 删除最后一处节点时，同一事务清掉人物事实"
```

---

### Task 5: 空槽移树用一条 UPDATE

**Files:**
- Create: `lib/lineage/move-node.ts`
- Modify: `lib/lineage/node-services.ts`（删掉本地 `moveNodeInTransaction` 桩，改为 re-export）
- Modify: `docs/modules/lineage.md` §2.7
- Test: `tests/integration/node-services.test.ts`

**Interfaces:**
- Consumes: `withLineageWrite`、`nextPath` 的步长规则（尾段最大数字 + 10，四位补零）。`nextPath` 目前是 `node-services.ts` 的私有函数。把它和 `segment` / `PATH_STEP` 挪到 `lib/lineage/path.ts` 并导出，两处引用，避免 move 文件复制一套分配逻辑。
- Produces: `moveNodeInTransaction` 签名保持不变，仍从 `lib/lineage/node-services.ts` 导出，测试与 Action 的 import 不改。成功时 `{ ok: true, node }`，`node.path` 是新路径。失败原因只用已有的 `not_found` | `root_forbidden` | `invalid_parent` | `cycle`。`reorderSiblingsInTransaction` 仍返回 `not_supported`。

- [ ] **Step 1: Write the failing test**

替换 `tests/integration/node-services.test.ts` 里「reports subtree moves as unsupported」：

```ts
it('moves a subtree onto a free slot with one path rewrite', async () => {
  const ctx = await setup();
  const root = await createRootNodeInTransaction(createParams(ctx));
  if (!root.ok) throw new Error('root failed');
  const child = await addChildInTransaction({
    ...createParams(ctx, { name: '二' }),
    parentId: root.node.id,
  });
  if (!child.ok) throw new Error('child failed');
  const grandchild = await addChildInTransaction({
    ...createParams(ctx, { name: '三' }),
    parentId: child.node.id,
  });
  if (!grandchild.ok) throw new Error('grandchild failed');
  const uncle = await addChildInTransaction({
    ...createParams(ctx, { name: '叔', surname: '陈' }),
    parentId: root.node.id,
  });
  if (!uncle.ok) throw new Error('uncle failed');

  const moved = await moveNodeInTransaction({
    userId: ctx.user.id,
    orgId: ctx.orgId,
    lineageId: ctx.lineage.id,
    nodeId: child.node.id,
    newParentId: uncle.node.id,
  });
  expect(moved.ok).toBe(true);
  if (!moved.ok) return;

  const rows = await getTestDb().select().from(nodes);
  const byId = new Map(rows.map((row) => [row.id, row.path]));
  expect(byId.get(child.node.id)).toBe(`${uncle.node.path}.0010`);
  expect(byId.get(grandchild.node.id)).toBe(`${uncle.node.path}.0010.0010`);
  expect(byId.get(root.node.id)).toBe(root.node.path);
});

it('refuses to move the root', async () => {
  const ctx = await setup();
  const root = await createRootNodeInTransaction(createParams(ctx));
  if (!root.ok) throw new Error('root failed');
  const child = await addChildInTransaction({
    ...createParams(ctx, { name: '二' }),
    parentId: root.node.id,
  });
  if (!child.ok) throw new Error('child failed');
  const moved = await moveNodeInTransaction({
    userId: ctx.user.id,
    orgId: ctx.orgId,
    lineageId: ctx.lineage.id,
    nodeId: root.node.id,
    newParentId: child.node.id,
  });
  expect(moved).toEqual({ ok: false, reason: 'root_forbidden' });
});
```

第二条测的是始祖：始祖 `parentPath` 为空，必须 `root_forbidden`，树不变。再写一条真正的环：

```ts
it('refuses to move a node under its descendant', async () => {
  const ctx = await setup();
  const root = await createRootNodeInTransaction(createParams(ctx));
  if (!root.ok) throw new Error('root failed');
  const child = await addChildInTransaction({
    ...createParams(ctx, { name: '二' }),
    parentId: root.node.id,
  });
  if (!child.ok) throw new Error('child failed');
  const grandchild = await addChildInTransaction({
    ...createParams(ctx, { name: '三' }),
    parentId: child.node.id,
  });
  if (!grandchild.ok) throw new Error('grandchild failed');
  expect(
    await moveNodeInTransaction({
      userId: ctx.user.id,
      orgId: ctx.orgId,
      lineageId: ctx.lineage.id,
      nodeId: child.node.id,
      newParentId: grandchild.node.id,
    })
  ).toEqual({ ok: false, reason: 'cycle' });
});
```

上一步的「始祖」用例和这条「子孙」用例都要留。兄弟重排用例保持 `not_supported`，不要改绿。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration -- tests/integration/node-services.test.ts`

Expected: 移树用例 FAIL，返回 `not_supported`。环用例同样 FAIL。

- [ ] **Step 3: Write minimal implementation**

新建 `lib/lineage/path.ts`，从 `node-services.ts` 搬出 `PATH_STEP`、`segment`、`nextPath`，并 `export`。`node-services.ts` 改为从这里 import。`nextPath` 的 SQL 与现在一字不差，只是换文件。

新建 `lib/lineage/move-node.ts`：

```ts
import 'server-only';

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/drizzle';
import { nodes } from '@/lib/db/schema';
import { withLineageWrite } from './lineage-write';
import type { NodeMutationResult } from './node-services';
import { nextPath } from './path';

async function loadNode(
  tx: DbTransaction,
  orgId: string,
  lineageId: string,
  nodeId: string
) {
  const [node] = await tx
    .select()
    .from(nodes)
    .where(
      and(eq(nodes.id, nodeId), eq(nodes.orgId, orgId), eq(nodes.lineageId, lineageId))
    )
    .limit(1);
  return node ?? null;
}
```

补上 `and`、`eq` 的 import。不要从 `node-services.ts` 再引 `loadNode`，那会和 `moveNodeInTransaction` 的 re-export 成环。

`moveNodeInTransaction`：

```ts
export async function moveNodeInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  nodeId: string;
  newParentId: string;
  ipAddress?: string;
}): Promise<NodeMutationResult> {
  const { userId, orgId, lineageId, nodeId, newParentId } = params;
  return withLineageWrite({ userId, orgId, lineageId }, async (tx) => {
    const current = await loadNode(tx, orgId, lineageId, nodeId);
    if (!current) return { ok: false, reason: 'not_found' as const };
    if (!current.parentPath) return { ok: false, reason: 'root_forbidden' as const };

    const parent = await loadNode(tx, orgId, lineageId, newParentId);
    if (!parent) return { ok: false, reason: 'invalid_parent' as const };
    if (parent.path === current.path || parent.path.startsWith(`${current.path}.`)) {
      return { ok: false, reason: 'cycle' as const };
    }
    if (parent.path === current.parentPath) {
      return { ok: true as const, node: current };
    }

    const newPath = await nextPath(tx, orgId, lineageId, parent.path);
    const cut = current.path.length + 1;
    await tx.execute(sql`
      update ${nodes}
      set path = (${newPath} || substring(${nodes.path}::text from ${cut}))::ltree
      where ${nodes.orgId} = ${orgId}
        and ${nodes.lineageId} = ${lineageId}
        and ${nodes.path} <@ ${current.path}::ltree
    `);
    const moved = await loadNode(tx, orgId, lineageId, nodeId);
    if (!moved) throw new Error('moved node disappeared');
    return { ok: true as const, node: moved };
  });
}
```

这就是 P13 的形状：`('0030' || substring(path::text from 5))::ltree`，只是新前缀来自 `nextPath`，切割点来自旧路径长度。节点自身的后缀是空串，子孙保留 `.0010` 这样的尾巴。语句结束前外键与唯一约束都不拦。不要拆成先改父、再改子的两条 `UPDATE`。

`lib/lineage/node-services.ts` 删除原来的桩函数，文件末尾：

```ts
export { moveNodeInTransaction } from './move-node';
```

确认 `node-services.ts` 不再自己声明同名函数。`NodeMutationResult` 若被 `move-node.ts` 引用，而 `node-services.ts` 又在顶层 import `move-node.ts`，会成环。所以 re-export 用文件末尾的 `export { } from`，不要在 `node-services.ts` 顶层 import 移树函数。`move-node.ts` 只 import 类型 `NodeMutationResult` 时使用 `import type`，类型导入在运行时擦掉，环就断了。

`docs/modules/lineage.md` §2.7：移到空槽是一条 `UPDATE`；目标是自己的子孙返回 `cycle`；始祖返回 `root_forbidden`；兄弟重排仍是 `not_supported`。删掉「三阶段临时前缀是当前唯一做法」那句。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:integration -- tests/integration/node-services.test.ts && pnpm arch:check`

Expected: PASS。`move-node.ts` 与 `path.ts` 都低于 400 行。`node-services.ts` 不超过 820 行。

- [ ] **Step 5: Commit**

```bash
git add lib/lineage/path.ts lib/lineage/move-node.ts lib/lineage/node-services.ts docs/modules/lineage.md tests/integration/node-services.test.ts
git commit -m "feat(lineage): 空槽移树用一条 UPDATE，子孙路径随生成列联动"
```

---

### Task 6: 删掉永远失败的配偶入口

**Files:**
- Modify: `lib/genealogy/schemas.ts`（删 `spouseName` / `spouseSurname` / `addSpouseSchema` / 成对校验）
- Modify: `lib/lineage/actions.ts`（删 `addSpouseAction`，以及创建动作里对 `spouseName` 的提前返回）
- Modify: `lib/lineage/node-services.ts`（删 `OptionalSpouse`、`addSpouseInTransaction`、`NodeCreateParams.spouse`）
- Modify: `components/lineage/node-create-dialog.tsx`、`components/lineage/canvas/genealogy-canvas.tsx`、`components/lineage/lineage-detail.tsx`
- Modify: `tests/lineage-schemas.test.ts`、`tests/lineage-spouse-guard.test.ts`、`tests/integration/node-services.test.ts`、`tests/integration/spouse-sort-index.test.ts`
- Modify: `docs/modules/lineage.md` 配偶那几行
- Modify: `CHANGELOG.md` 的 `[未发布]` 顶部加一条

**Interfaces:**
- Consumes: Task 1 的 `PersonSex`
- Produces: 模块导出里不再有 `addSpouseAction`、`addSpouseSchema`、`addSpouseInTransaction`。`GenealogyCanvas` 的 `onCreateChild: (parentId: string, sex: 'male' | 'female') => void`。不再有 `onCreateSpouse`。

- [ ] **Step 1: Write the failing test**

`tests/lineage-schemas.test.ts`：

```ts
it('does not accept a co-recorded spouse', () => {
  const parsed = createRootNodeSchema.parse({
    orgId,
    lineageId,
    requestId,
    name: '元英',
    surname: '陈',
    sex: 'male',
    spouseName: '氏',
    spouseSurname: '王',
  });
  expect(parsed).not.toHaveProperty('spouseName');
  expect(parsed).not.toHaveProperty('spouseSurname');
});
```

Zod 默认剥掉未知键。这条在实现前会 FAIL，因为现在的 schema 仍声明这两个键，`parsed.spouseName` 是 `'氏'`。

删除本文件对 `addSpouseSchema` 的 import 和所有调用。那些用例测的是一个要删掉的入口。

`tests/integration/node-services.test.ts` 里若断言 `addSpouseInTransaction` 返回 `not_supported`，整段删除。不要改成「仍导出一个永远失败的函数」。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/lineage-schemas.test.ts`

Expected: FAIL。`spouseName` 仍在解析结果上。

- [ ] **Step 3: Write minimal implementation**

`lib/genealogy/schemas.ts` 删除 `spouseName`、`spouseSurname`、`spouseFieldsTogether`（成对 superRefine）、`addSpouseSchema`，以及创建 schema 上的这两个字段。`addSpouseSchema` 的 export 删除后，全仓库引用必须一起消失，否则 `tsc` 失败。用搜索 `addSpouse` 清完。

`lib/lineage/actions.ts` 删除 `addSpouseAction`，以及 `createRootNodeAction` / `addChildAction` / `addSiblingAction` / `addPersonAction` 开头的：

```ts
if (data.spouseName || data.spouseSurname) {
  return lineageError('not_supported');
}
```

`lib/lineage/node-services.ts` 删除 `OptionalSpouse`、`addSpouseInTransaction`、`NodeCreateParams` 的 `spouse` 字段，以及文件头注释里「配偶输入接受但不落库」那一段。

`components/lineage/canvas/genealogy-canvas.tsx`：

```ts
type DragTemplate = { sex: 'male' | 'female' };

onCreateChild: (parentId: string, sex: 'male' | 'female') => void;
```

从 props 类型和解构里删除 `onCreateSpouse`。放下瓦片时两种性别都调用 `onCreateChild(nearest.id, template.sex)`。瓦片数据改为 `{ sex: 'male' }` 与 `{ sex: 'female' }`。文案仍是「男丁」「女眷」。

`components/lineage/lineage-detail.tsx` 的 `onCreateChild` 使用第二个参数作为新对话框的初始性别。`onCreateSpouse` 回调删除。若创建对话框的 `mode: 'spouse'` 只被这条回调使用，从对话框的 mode 联合类型里删掉 `'spouse'`，并删掉配偶表单区块（姓名对面的配偶姓、配偶名、性别取反）。女眷拖拽打开的是「添加子女」，性别初始为 `'female'`。

`components/lineage/node-create-dialog.tsx` 若删掉配偶模式后行数降到 400 及以下，从 `scripts/check-file-size.mjs` 的 `EXEMPT` 移除该文件。不要把天花板改大。

`tests/lineage-spouse-guard.test.ts`：若整文件只守护 `addSpouseAction`，删除该文件。若还守护别的 action，只删配偶用例和对应 mock。

`tests/integration/spouse-sort-index.test.ts` 顶部注释若写「addSpouse 返回 invalid_target」，改成「配偶写入已不存在；本文件只断言 path / display_name 列仍在」。测试体里对 `addSpouseInTransaction` 的调用删除。

`docs/modules/lineage.md` 删除 `addSpouseInTransaction` 行，以及「表单接受配偶然后失败」的描述。写一句：配偶不在本切片；`family_partner` 仍无写入。

`CHANGELOG.md` 的 `[未发布]` 列表最上方加一条：

```markdown
- **谱系性别、姓名与删除（2026-11-11）**：性别不再经 0/1 双反转，界面与 `person.sex` 使用同一套 `male` / `female` / `other` / `unknown`。姓写入 `person.surname`，名写入 `person_name.value`，读路径不再按最后一个字切分。删除节点或谱系时，同一事务清掉不再被节点引用的人物、名字与事件。空槽移树改为一条 `UPDATE`。配偶录入入口删除，不写入 `family`。决策见 ADR 0023。
```

布局函数 `buildLineageIndex` 里 `role === 'spouse'` 的分支本任务保留。没有任何写路径再产出 `role: 'spouse'`，投影仍恒为 `'blood'`。删布局分支会牵动 `tests/lineage-canvas-layout.test.ts` 的一整组夹具，不属于「去掉失败入口」。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test && pnpm typecheck && pnpm arch:check && pnpm docs:check`

Expected: 全部 PASS。`pnpm test` 不含集成测试。再跑：

Run: `pnpm test:integration -- tests/integration/node-services.test.ts tests/integration/person-surname-column.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/genealogy/schemas.ts lib/lineage components/lineage tests docs/modules/lineage.md CHANGELOG.md scripts/check-file-size.mjs
git commit -m "fix(lineage): 删除不落库的配偶入口，女眷拖拽改为添加女儿"
```

`scripts/check-file-size.mjs` 只有在某个豁免文件掉到 400 行以下时才加入这次提交。

---

## 明确不做

- 不改 `ActionState` 的可选 ID 字段。那是跨域的返回契约，另写计划。
- 不实现兄弟重排，不把唯一约束改成 `DEFERRABLE`。
- 不写 `family` / `family_partner` / `family_child`。
- 不删 `node.display_name` 列。写路径停止使用它；删列是另一次迁移。
- 不按最后一个字回填历史全名。旧行的 `surname` 保持 NULL，主名保持原字符串，直到有人打开编辑并保存。
- 不收窄 `revalidateWholeConsole`。谱文保存继续不调用它。
- 不把项目删除扩展成自动清空分类。事实行清掉之后，空的 `folder` 仍会让 `deleteProject` 返回 `not_empty`，这是现有探测清单的行为。

## Self-review

- 评审第 1 条（性别）→ Task 1。第 2 条（姓名）→ Task 2 与 Task 3。第 3 条（删除）→ Task 4。第 4 条（空槽移树）→ Task 5。第 5 条（配偶入口）→ Task 6。第 6 条（ActionState）写在「为什么不是六件事一起做」。
- `PersonSex`、`persons.surname`、`deleteUnreferencedPersons`、`moveNodeInTransaction` 的名字在后文任务里与定义任务一致。
- 没有留下「适当处理错误」或「类似 Task N」这种步骤。环检测、空白姓、始祖禁移都有具体断言。
