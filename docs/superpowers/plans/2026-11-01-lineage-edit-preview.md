# 谱系录编与实时预览（录入闭环）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把谱系编辑器收敛成「建谱系 → 录始祖 → 加亲属 → 边录边看成谱 → 安全删除」的闭环：信息卡改抽屉、操作入口搬到选中态、删除谱系收紧权限、删除确认补措辞。

**Architecture:** 三处「删旧换新」+ 一处权限收紧，全部零 schema 变更。命令集写成一张纯常量表（`node-commands.ts`），底部快捷条与右键菜单只是它的两种画法；可测逻辑（命令表、子树集合、权限）留在纯函数里用 Vitest 钉住，Radix 浮层与抽屉的接线交给 E2E。

**Tech Stack:** TypeScript 7 · React 19 · Next.js 16 App Router · Radix（既有 `components/ui/sheet.tsx`、`dropdown-menu.tsx`）· Vitest（node 环境 + `renderToStaticMarkup`）· Playwright

**Spec:** [specs/001-lineage-edit-preview/spec.md](../../../specs/001-lineage-edit-preview/spec.md)（设计记录见 [plan.md](../../../specs/001-lineage-edit-preview/plan.md)）

## Global Constraints

- 单文件 ≤400 行；`lineage-detail.tsx`（865）与 `person-inspector.tsx`（606）在 `scripts/check-file-size.mjs` 豁免表里，**只许缩不许涨**。
- 权限判断一律 `hasPermission(role, '<permission>')`，禁止比较角色名。
- 面向用户的文案一律简体中文；错误不抛堆栈。
- 不新增 npm 依赖；不写裸色值（`tests/design-system.test.ts` 会失败）。
- **零 schema 变更、零迁移**：不加 `node.birth_place`，不新建表。
- 提交前 `pnpm check && pnpm typecheck && pnpm test` 全绿；文档改动后 `pnpm docs:check --strict`。
- `docs/prd.md` 是 **CRLF**：脚本改写后必须 `data.replace(b"\n", b"\r\n")` 回写。

## Review Focus

以下五类输入/条件没有任何任务级测试能完整覆盖，实施时逐一确认：

1. **未选中任何节点时**，右侧必须完全无残留（无面板、无空占位、画布占满宽度）——E2E + 手工确认。
2. **始祖被删除**：底部条与右键菜单的「删除/移动/加兄弟」必须禁用，且服务端仍返回 `root_forbidden`。
3. **查看者（viewer）**：两条入口**都不渲染**（不是渲染成禁用）；直接调 Action 被服务端拒绝。
4. **抽屉打开时选中另一人丁**：表单内容随选中切换，不得把上一个人的未保存输入带到新节点。
5. **删除确认的数字与措辞**：含配偶的子树下，N 与实际归档行数一致，且文案写明「与配偶」。

---

### Task 1: 删除谱系收紧为 `lineage.delete`

**Files:**
- Modify: `lib/auth/access-control.ts:8,21,38,47,54,71`
- Modify: `lib/auth/permissions.ts:24-34`
- Modify: `lib/lineage/services.ts:282`（`deleteLineageInTransaction` 的 `withOrgWrite` 权限串）
- Test: `tests/permissions.test.ts`、`tests/access-control.test.ts`、`tests/integration/folders-lineages.test.ts`

**Interfaces:**
- Consumes: 既有 `ORG_PERMISSIONS`、`hasPermission`、`withOrgWrite(userId, orgId, permission, fn)`
- Produces: 权限串 `'lineage.delete'`（`OrgPermission` 联合类型成员）；`PERMISSION_DENIED_MESSAGES['lineage.delete']`

- [ ] **Step 1: 写失败测试 —— 权限矩阵**

在 `tests/permissions.test.ts` 的 `expected` 表里：`admin` 数组加 `'lineage.delete'`，`editor`/`viewer` 不加。再加一条断言：

```ts
it('只允许 owner/admin 删除谱系', () => {
  expect(hasPermission('owner', 'lineage.delete')).toBe(true);
  expect(hasPermission('admin', 'lineage.delete')).toBe(true);
  expect(hasPermission('editor', 'lineage.delete')).toBe(false);
  expect(hasPermission('viewer', 'lineage.delete')).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/permissions.test.ts`
Expected: FAIL —— TS/运行时报 `'lineage.delete'` 不在 `ORG_PERMISSIONS`/`OrgPermission` 里（`expect(false).toBe(true)` 或类型错误）

- [ ] **Step 3: 实现权限串**

`lib/auth/access-control.ts`：`statement.lineage` → `['write', 'delete']`；`roles.owner.lineage`/`roles.admin.lineage` → `['write', 'delete']`；`ORG_PERMISSIONS` 加 `'lineage.delete'`；`PERMISSION_REQUESTS` 加 `'lineage.delete': { lineage: ['delete'] }`。
`lib/auth/permissions.ts`：`PERMISSION_DENIED_MESSAGES` 加 `'lineage.delete': '只有所有者或管理员可以删除谱系'`。
`lib/lineage/services.ts`：`deleteLineageInTransaction` 里的 `withOrgWrite(userId, orgId, 'lineage.write', …)` 改为 `'lineage.delete'`（**人丁级写不动**）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/permissions.test.ts tests/access-control.test.ts`
Expected: PASS（含既有矩阵断言）

- [ ] **Step 5: 集成测试 —— 编辑者被拒**

在 `tests/integration/folders-lineages.test.ts` 加一条：以 `editor` 身份调 `deleteLineageInTransaction`，期望 `{ ok: false, reason: 'forbidden' }`，且谱系行仍在（`deleted_at IS NULL`）。

Run: `pnpm test:integration -- folders-lineages`
Expected: PASS。若测试库未初始化，先跑一次 `pnpm db:setup`；若 Postgres 不可达，记录到 ledger 并继续（unit + typecheck 为准）。

- [ ] **Step 6: 提交**

```bash
git add lib/auth/access-control.ts lib/auth/permissions.ts lib/lineage/services.ts tests/permissions.test.ts tests/access-control.test.ts tests/integration/folders-lineages.test.ts
git commit -m "feat(lineage): 删除谱系收紧为 lineage.delete，编辑者不可删"
```

---

### Task 2: 抽出子树集合与删除确认文案

**Files:**
- Create: `lib/lineage/subtree.ts`
- Modify: `components/lineage/lineage-detail.tsx:90-119,449-465`
- Test: `tests/lineage-subtree.test.ts`（新建）

**Interfaces:**
- Consumes: `NodeView`（`components/lineage/types.ts`）
- Produces:
  - `collectSubtreeIds(node: NodeView, nodes: NodeView[]): Set<string>` —— 血亲广度遍历 + 归并这些血亲的配偶（与服务端 `deleteNodeInTransaction` 集合一致）
  - `buildDeleteConfirmMessage(node: NodeView, count: number): string` —— `count > 1` 时 `删除「X」及其子孙与配偶？共 N 位人丁会归档。`，否则 `删除「X」？该人丁会归档。`

- [ ] **Step 1: 写失败测试**

新建 `tests/lineage-subtree.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildDeleteConfirmMessage, collectSubtreeIds } from '@/lib/lineage/subtree';
import type { NodeView } from '@/components/lineage/types';

const node = (over: Partial<NodeView>): NodeView => ({
  id: 'n', parentId: null, spouseOfId: null, role: 'blood', generation: 1, sort: 0,
  name: '实', surname: '陈', fullName: '陈实', sex: 0, courtesy: null, namePrefix: null,
  isAlive: true, birthText: null, deathText: null, birthYear: null, deathYear: null,
  burialPlace: null, biography: null, ...over,
});

const root = node({ id: 'r' });
const sonA = node({ id: 'a', parentId: 'r', generation: 2 });
const sonB = node({ id: 'b', parentId: 'r', generation: 2 });
const wifeOfA = node({ id: 'wa', role: 'spouse', spouseOfId: 'a' });

describe('collectSubtreeIds', () => {
  it('把血亲子树与其配偶一并计入', () => {
    const ids = collectSubtreeIds(root, [root, sonA, sonB, wifeOfA]);
    expect([...ids].sort()).toEqual(['a', 'b', 'r', 'wa']);
  });

  it('不把旁支算进来', () => {
    const other = node({ id: 'x', parentId: 'other' });
    expect(collectSubtreeIds(sonA, [root, sonA, sonB, wifeOfA, other]).has('x')).toBe(false);
  });
});

describe('buildDeleteConfirmMessage', () => {
  it('多人时写明子孙与配偶', () => {
    expect(buildDeleteConfirmMessage(root, 4)).toBe('删除「陈实」及其子孙与配偶？共 4 位人丁会归档。');
  });
  it('单人时不给人数', () => {
    expect(buildDeleteConfirmMessage(root, 1)).toBe('删除「陈实」？该人丁会归档。');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/lineage-subtree.test.ts`
Expected: FAIL —— `Cannot find module '@/lib/lineage/subtree'`

- [ ] **Step 3: 实现 `lib/lineage/subtree.ts`**

`collectSubtreeIds` 就是把 `lineage-detail.tsx:90-119` 的 `subtreeIds` **原样搬过来**（逻辑不改，配偶归并保留）；`buildDeleteConfirmMessage` 返回上面两条模板之一。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/lineage-subtree.test.ts`
Expected: PASS

- [ ] **Step 5: 接线 `lineage-detail.tsx`**

删掉本地 `subtreeIds`（90-119），改为 `import { buildDeleteConfirmMessage, collectSubtreeIds } from '@/lib/lineage/subtree'`；`handleDelete` 里 `const ids = collectSubtreeIds(node, nodes)`、`const message = buildDeleteConfirmMessage(node, ids.size)`。

- [ ] **Step 6: 运行测试与类型检查**

Run: `npx vitest run tests/lineage-subtree.test.ts && pnpm typecheck`
Expected: PASS，且 `pnpm arch:check` 中 `lineage-detail.tsx` 行数下降

- [ ] **Step 7: 提交**

```bash
git add lib/lineage/subtree.ts components/lineage/lineage-detail.tsx tests/lineage-subtree.test.ts
git commit -m "feat(lineage): 删除确认写明子孙与配偶，子树集合抽为纯函数"
```

---

### Task 3: 节点命令表（唯一真相）

**Files:**
- Create: `components/lineage/node-commands.ts`
- Test: `tests/node-commands.test.ts`（新建）

**Interfaces:**
- Consumes: `NodeView`
- Produces:
  - `type NodeCommandId = 'add-child' | 'add-sibling' | 'add-spouse' | 'move' | 'delete'`
  - `type NodeCommand = { id: NodeCommandId; label: string; isEnabled(node: NodeView): boolean; isDestructive?: boolean }`
  - `NODE_COMMANDS: readonly NodeCommand[]`（顺序：加子女 / 加兄弟 / 加配偶 / 移动 / 删除）
  - `enabledCommands(node: NodeView, canWrite: boolean): NodeCommand[]` —— `canWrite === false` 返回 `[]`；否则返回 `isEnabled(node)` 为真的命令

- [ ] **Step 1: 写失败测试**

新建 `tests/node-commands.test.ts`，断言：① `NODE_COMMANDS.map(c => c.id)` 等于五元序列；② 始祖（`parentId: null`）下 `enabledCommands` 只含 `add-child`/`add-spouse`；③ 非始祖血亲含全部五项；④ `canWrite=false` 返回 `[]`；⑤ 配偶节点（`role: 'spouse'`）禁用 `add-spouse`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/node-commands.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现命令表**

纯常量 + 一个过滤函数；`label` 用中文（加子女/加兄弟/加配偶/移动/删除）；`delete` 标 `isDestructive: true`。**不含「查看档案」**（选中即开抽屉）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/node-commands.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add components/lineage/node-commands.ts tests/node-commands.test.ts
git commit -m "feat(lineage): 节点命令表，底部条与右键菜单共用一个真相"
```

---

### Task 4: 底部快捷按钮条

**Files:**
- Create: `components/lineage/node-action-bar.tsx`
- Test: `tests/node-action-bar.test.tsx`（新建）

**Interfaces:**
- Consumes: `NODE_COMMANDS` / `enabledCommands`（Task 3）、`NodeView`
- Produces: `NodeActionBar({ node, canWrite, onCommand }: { node: NodeView; canWrite: boolean; onCommand: (id: NodeCommandId) => void })` —— 客户端组件；`canWrite === false` 或 `enabledCommands` 为空时返回 `null`

- [ ] **Step 1: 写失败测试**

新建 `tests/node-action-bar.test.tsx`，用 `renderToStaticMarkup`：

```tsx
const html = renderToStaticMarkup(<NodeActionBar node={sonA} canWrite onCommand={() => {}} />);
expect(html).toContain('当前选中');
expect(html).toContain('加子女');
expect(html).not.toContain('查看档案');
const rootHtml = renderToStaticMarkup(<NodeActionBar node={root} canWrite onCommand={() => {}} />);
expect(rootHtml).not.toContain('删除');          // 始祖禁用
expect(renderToStaticMarkup(<NodeActionBar node={sonA} canWrite={false} onCommand={() => {}} />)).toBe('');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/node-action-bar.test.tsx`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现底部条**

固定底栏（`sticky bottom-0`），左侧身份提示 `当前选中：{node.fullName} · 第 {node.generation} 代`，右侧按 `enabledCommands` 渲染按钮；`delete` 用 `variant="destructive"`。样式只用既有 `components/ui/button.tsx` 与语义 token，不写裸色值。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/node-action-bar.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add components/lineage/node-action-bar.tsx tests/node-action-bar.test.tsx
git commit -m "feat(lineage): 底部快捷按钮条，随选中态出现"
```

---

### Task 5: 移除卡片下拉菜单，接上两条入口

**Files:**
- Modify: `components/lineage/lineage-detail.tsx:146-230`（删 `NodeActions`）、`:313`、`:545` 附近接线
- Modify: `components/lineage/canvas/genealogy-canvas.tsx`（透传 `onNodeContextMenu`）
- Modify: `components/lineage/canvas/nodes/book-person-node.tsx`（节点卡片 `onContextMenu`）
- Create: `components/lineage/node-context-menu.tsx`
- Test: `tests/e2e/lineage-node-actions.spec.ts`（新建）

**Interfaces:**
- Consumes: `NODE_COMMANDS` / `enabledCommands`、`NodeActionBar`
- Produces: `NodeContextMenu({ node, canWrite, open, position, onCommand, onOpenChange })`；`lineage-detail` 新增状态 `contextMenu: { node: NodeView; x: number; y: number } | null`

- [ ] **Step 1: 写失败 E2E**

`tests/e2e/lineage-node-actions.spec.ts`：进入谱系 → 不选节点时**看不到**「当前选中」→ 点节点 → 底部条出现且含「加子女」→ 节点卡片上**没有**「人丁操作」按钮 → 右键节点 → 出现与底部条相同的命令集。

Run: `pnpm test:e2e -- lineage-node-actions`
Expected: FAIL（底部条不存在、卡片菜单仍在）

- [ ] **Step 2: 实现 `node-context-menu.tsx`**

Radix `DropdownMenu` 受控（`open`/`onOpenChange`），用 `Trigger` 的 `asChild` 包一个零尺寸锚点并按 `x/y` 定位；菜单项由 `enabledCommands` 生成。不接管画布空白处的 `contextmenu`。

- [ ] **Step 3: 接线并删除旧菜单**

`lineage-detail.tsx`：删 `NodeActions`（146-230）与其在 `NodeRows`/表格里的渲染；选中态渲染 `<NodeActionBar …/>`；节点右键时 `setContextMenu({node, x, y})` 并 `setSelectedNode(node.id)`；`onCommand` 分派到既有 `openCreate` / `handleMove` / `handleDelete`。
`genealogy-canvas.tsx` + `book-person-node.tsx`：新增 `onNodeContextMenu(nodeId, x, y)` 回调，卡片 `onContextMenu` 里 `preventDefault()` 后调用。

- [ ] **Step 4: 运行 E2E 与门禁**

Run: `pnpm test:e2e -- lineage-node-actions && pnpm typecheck && pnpm arch:check`
Expected: E2E PASS；`lineage-detail.tsx` 行数从 865 下降；`person-inspector.tsx` 不涨

- [ ] **Step 5: 提交**

```bash
git add components/lineage/node-context-menu.tsx components/lineage/lineage-detail.tsx components/lineage/canvas tests/e2e/lineage-node-actions.spec.ts
git commit -m "feat(lineage): 取消卡片操作菜单，改由底部快捷条与右键菜单触发"
```

---

### Task 6: 信息卡改抽屉

**Files:**
- Modify: `components/lineage/person-inspector.tsx:33-47`（删 `EmptyInspector`）、`:55-74,112-132`（删 `width`/`isResizing`/`onResizeStart`）
- Modify: `components/lineage/lineage-detail.tsx:368,522-545`（改用 `Sheet`，删 `useResizable` 接线）
- Test: `tests/e2e/lineage-inspector.spec.ts`（新建）

**Interfaces:**
- Consumes: `components/ui/sheet.tsx` 的 `Sheet` / `SheetContent` / `SheetHeader` / `SheetClose`
- Produces: `PersonInspector` 去掉 `width` / `isResizing` / `onResizeStart` 三个 props，其余不变；抽屉由 `lineage-detail` 用 `<Sheet open={selectedNode != null}>` 承载

- [ ] **Step 1: 写失败 E2E**

`tests/e2e/lineage-inspector.spec.ts`：进入谱系 → **右侧无面板**（`未选择族人` 不可见、无 `[role=dialog]`）→ 点节点 → 抽屉出现并可编辑 → `Esc` → 抽屉消失且无残留。

Run: `pnpm test:e2e -- lineage-inspector`
Expected: FAIL（常驻面板与空占位仍在）

- [ ] **Step 2: 改造 `person-inspector.tsx`**

删 `EmptyInspector` 与 `node == null` 分支（组件只接受 `node: NodeView`）；删三个宽度 props 与拖拽把手；保留 `onClose`。

- [ ] **Step 3: 改造 `lineage-detail.tsx`**

`selectedNode` 为空时**不渲染任何右侧内容**；有值时渲染 `<Sheet open onOpenChange={(o) => !o && setSelectedNode(null)}><SheetContent side="right">…<PersonInspector …/></SheetContent></Sheet>`；删除 `useResizable`（368）与相关 props。

- [ ] **Step 4: 运行 E2E 与门禁**

Run: `pnpm test:e2e -- lineage-inspector && pnpm typecheck && pnpm arch:check && pnpm test`
Expected: E2E PASS；`person-inspector.tsx` 行数下降；单测全绿

- [ ] **Step 5: 提交**

```bash
git add components/lineage/person-inspector.tsx components/lineage/lineage-detail.tsx tests/e2e/lineage-inspector.spec.ts
git commit -m "feat(lineage): 信息卡改抽屉，未选中不占位"
```

---

### Task 7: 文档同步与全量门禁

**Files:**
- Modify: `docs/prd.md`（§3.2 权限矩阵拆行、§3.3 `admin` 数组加 `'lineage.delete'`）—— **CRLF**
- Modify: `docs/implementation-status.md`（若抽屉/入口计入已交付）
- Test: 全量命令

- [ ] **Step 1: 改权限矩阵**

§3.2 把「删除内容」行拆成「删除内容（人丁/谱文/谱书）」✅✅✅— 与「删除谱系」✅✅——；§3.3 给 `admin` 加 `'lineage.delete'`。用 python 按字节读、`replace(b"\n", b"\r\n")` 回写。

- [ ] **Step 2: 验证 CRLF 未被破坏**

Run: `git diff --stat docs/prd.md`
Expected: 只有个位数行变动（不是整文件重写）

- [ ] **Step 3: 全量门禁**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm arch:check && pnpm docs:check --strict`
Expected: 全部 0 issue

- [ ] **Step 4: 集成与 E2E（若环境可用）**

Run: `pnpm test:integration && pnpm test:e2e`
Expected: PASS；若 Postgres/E2E 环境不可用，记录 ledger ruling 并说明哪一项没跑

- [ ] **Step 5: 提交**

```bash
git add docs/prd.md docs/implementation-status.md
git commit -m "docs(prd): 权限矩阵加入 lineage.delete，编辑者不可删谱系"
```
