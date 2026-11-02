# 架构精简与优化（Linus 尺子版）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用「数据结构优先 / 消除特例 / 复杂即敌 / 让约束可执行 / 一次一个补丁」六把尺子，把仓库里**已经在产生成本的四类结构性债务**（树的第三层防护是假的、同一事实抄了四份、16 处失效里 15 处炸整树、约束有名字没执行者）收敛成可回滚的小补丁，并**删掉**四类已经证明无用的东西。

**Architecture:** 三个正交纵深，按「先立规、再收口、后减面」排序。**纵深 A（数据正确性）**把树的边与树的不变量交给数据库——现有应用层校验一条不删，只是在它下面加一层数据库 CHECK / 复合外键，执行的是「第 6 个写入口出现那天谁兜底」。**纵深 B（重复面）**把四处重复实现收成单一定义（鉴权样板、谱系索引、DTO 映射、文件夹选项）。**纵深 C（约束执行）**把 `07-quality.md` 里已登记但零执行者的 F1/F2/F5/F6/F7 变成 CI 里会红的检查，并删掉前提不存在的 F1/F2。**减面**单独成段：删死代码、删文档重复叙述、收窄 `revalidatePath`。

**Tech Stack:** Next.js 16.4.3 App Router · React 19.3.1 · TypeScript 7.0.2 · Drizzle ORM 0.45.4 `drizzle-kit` · PostgreSQL 18（`ltree` / `pg_trgm` / `uuidv7()`）· Zod 4 · Vitest（单测 + 真实 PG 集成）· Playwright · Biome 2.6.3 · pnpm 12

**Spec:** 无独立 spec 文档；本计划的输入是 [2026-10-24 Linus 架构评审](../../reviews/2026-10-24-linus-architecture-review.md)、[2026-10-25 技术栈评审](../../reviews/2026-10-25-linus-stack-review.md)、[实现状态](../../implementation-status.md)、[架构总览](../architecture/07-quality.md) 两份报告，以及本轮**对当前代码的独立复核**（基线 `566fe24`，见本文 §「证据基线」）。

---

## 证据基线（本轮实测，不是引用旧评审）

旧的 2026-10-24 评审有两条结论**在今天的代码上已经不成立**，本计划据此改写优先级，不要照抄旧评审：

| 旧评审说法 | 当前实测 | 处置 |
|---|---|---|
| 详情页 7 个事务 / ~35 次往返（附录 A） | **5 个事务 / 16 条 SQL**；`requireProjectContext` 与 `getNavFolders` 命中 `React cache()`，只算 1 个事务；postgres.js 有流水线（`connection.js:156-183,544`），顺序 `await` 不等于 N 次 RTT | **降级**：不再作为 P0 性能项，只保留「读窗口 + 服务端搜索」这一条真问题（Capacity） |
| `data-model.md §12.5` RLS 模板会重新挖开越权坑（D-22） | **已修**，且 `check-docs.mjs:171,175-182` 有机械拦截，`pnpm docs:check --strict` 实测 0 issue | **已关闭**，不在本计划范围 |
| D-23 / D-25 / D-26 | **已修** | 已关闭 |
| D-24 测试数字三方不一致 | **部分修**：`AGENTS.md:57` 对（22/160、11/122），`implementation-status.md:37,93-94` 与 `setup.md:381,403` 仍写 18/137、11/117 | 保留，收进 Task 14 |

仍然成立、构成本计划主体的实测事实：

| # | 事实 | 证据 |
|---|---|---|
| E1 | 三棵树的父引用只有同表外键或**完全没有外键**：`node.parent_id → node(id)`、`book_catalog.parent_id → book_catalog(id)`、`folder.parent_id` **零外键**。跨谱系/跨项目挂父在库层合法 | `lib/db/schema.ts:325-327`、`:457-459`、`:263`；`0000_baseline.sql:79-91,213-214,222-224` |
| E2 | `generation == depth + 1` 与 `depth == nlevel(path) - 1` **一条 CHECK 都没有**；集成测试工厂自己就在写 `depth=0, generation=2` 并跑绿 | `lib/db/schema.ts:361-379`；`tests/helpers/factories.ts:167-189`；`tests/integration/folders-lineages.test.ts:465-480` |
| E3 | `withOrg` 每次调用固定 2 条 setup SQL（`set local role` + `set_config('request.jwt.claims')`），后者是 `auth.has_org_role()` 的唯一取数口径——删不掉，但可以**只发一次**（一次渲染一个事务） | `lib/db/drizzle.ts:79-88`；`0003_better_auth.sql:74-88` |
| E4 | `requireLineageWrite` 逐字两份（`services.ts:31-38`、`node-services.ts:74-81`），加 `folder` 与 `db` 域的同构内联，**共 4 种写法、14 处调用** | 见 `lib/lineage/services.ts:141,230,308`、`node-services.ts:250,329,401,478,552,622,704,824`、`folder/services.ts:27-34`、`db/services.ts:45,104,157` |
| E5 | `buildLineageIndex(nodes)` 在 **4 个组件里各算一遍**，三处组件都没有 `index` 入参 | `lineage-detail.tsx:372`、`canvas/genealogy-canvas.tsx:133`、`person-inspector.tsx:80`、`node-create-dialog.tsx:108` |
| E6 | `FolderOption` 类型 **3 份**、`folderOptions()` 函数 **2 份逐字相同** | `lineage-detail.tsx:71-75`、`lineage-edit-dialog.tsx:34-38`、`create-lineage-dialog.tsx:39-43`、`:40`、`:45` |
| E7 | 详情页把 21 个字段从 `Node` 手抄成 `NodeView` | `[lineageId]/page.tsx:46-67` ↔ `components/lineage/types.ts:1-22` |
| E8 | `revalidatePath` 16 处，**15 处是整树 `/dashboard` + `layout`** | 全清单见 `lib/lineage/actions.ts:58`、`folder/actions.ts:41,60,78`、`project/actions.ts:46,89,90,108`、`org/actions.ts:104,140,174,229,260,302,351`、`auth/actions/account.ts:138` |
| E9 | `07-quality.md` 列的 F1/F2 **前提不存在**（仓库无 `*.service.ts`、无 `src/server/db`）；F4 在全仓**只有一处提及、无定义**；F6「单文件 ≤400 行」**未配置**且当前**10 个文件违规**；F7「除 `lib/config.ts` 外不出现 `process.env`」**4 处违规**；F5 只挡文档不挡数据库 | `docs/architecture/07-quality.md:59-65`、`:20`；`scripts/` 仅 `check-docs.mjs`、`verify-deployment.mjs`；违规清单见附录 B |
| E10 | 附录 B 的 12 条死代码**全部仍然成立**，其中 `FolderOption` 比原描述更糟（3 份类型 + 2 份函数） | 逐条复核见附录 B |
| E11 | Biome `noRestrictedImports` **已接入且实测生效**，但 `03-components.md:76-77` 仍写「待接入」；`07-quality.md:65` 仍把 F1/F2 算作「未执行」 | `biome.json:36-80` vs `docs/architecture/03-components.md:76-77` |

---

## Global Constraints

- **不重置数据库**，不修改任何已提交的历史迁移（`0000`–`0007`）。新表结构变更只追加 `0008+`。
- **不新增后台任务 / 队列 / 定时器**（ADR 0005）；本计划所有任务都必须在单请求内完成。
- **不执行 `src/modules` 重构**，不引入 `*.service.ts` / `*.repo.ts` 结构（AGENTS.md 禁止清单 #10）。
- **不修改 `auth.*` 表结构，不碰 Better Auth 的会话/密码/成员写路径**（ADR 0007）。
- **应用层校验一条都不删**：所有 CHECK 都是**追加**，现有 5 个写入口（`createRoot`/`addChild`/`addSibling`/`addSpouse`/`moveNode`）的校验逻辑不动。
- **迁移与业务代码分开提交**，每个迁移单独一个 commit；迁移必须能在空库一次执行，且**不得夹带数据修复逻辑**。
- 面向用户文案一律简体中文；数据库列名、日志、错误码保持英文。
- 每个任务结束前 `pnpm check && pnpm typecheck && pnpm test` 必须全绿。
- 任务若涉及真实 SQL / 约束 / 事务 → 补 `pnpm test:integration`；若涉及 UI 可达流程 → 补 `pnpm test:e2e`。
- **不新增裸色值**（`tests/design-system.test.ts` 会检查）。
- 开工前读 `AGENTS.md` §5–§7；每个任务只动本任务 `Files` 里列出的文件，跨任务共享文件见各任务 `Interfaces`。

---

## Review Focus

以下五类输入/条件，规格（即现有文档与代码约定）没有明说，但一个正常用户一定会遇到，且最容易被本轮改动打破。每条都钉到拥有该代码的任务里：

1. **老数据里有不满足新 CHECK 的节点行**（历史手工改库、`db/seed.ts`、或应用层曾经漏校验的路径）：`ALTER TABLE ... ADD CONSTRAINT` 会直接失败。期望行为是**先体检、把违规行列出来、显式修复或回滚**，而不是让迁移在生产里炸一半。测试见 Task 3 Step 2、Task 4 Step 2 的体检查 SQL。
2. **一父多组织 / 一父跨谱系**：如果有人（或未来的第 6 个写入口）把 `node.parent_id` 指向另一个 organization 的节点，复合外键必须抛 `23503`，且叶子/根节点（`parent_id IS NULL`）不受影响。测试见 Task 4 Step 1（跨谱系父引用）。
3. **空谱系 / 单节点谱系 / 配偶节点**：`level` 派生、`generation` 不变量在 `parent_id IS NULL`、`role='spouse'`（`path IS NULL`）时必须全部放行。测试见 Task 3 Step 1（配偶 + 单节点）、Task 4 Step 1（`parent_id IS NULL`）。
4. **`withOrgWrite` 提前返回时事务必须干净关闭**：鉴权失败时我们在 `withOrg` 回调里**直接 return**（不发任何业务语句）。如果这个路径让事务停在「已 `SET LOCAL` 但无写入」的状态，连接被复用时的角色与 claims 就是错的——这正是 `SET LOCAL` 存在的理由。测试见 Task 2 Step 1 的第二个用例（viewer 走 forbidden 分支后，紧接着的 owner 查询必须仍能读到自己组织的数据）；Task 10 Step 5 的 E2E 是整条读路径的回归。
5. **`noRestrictedImports` / F6 / F7 上线当天会红**：必须先跑一遍拿真实违规清单，把「真违规」修掉、「假阳性」写进豁免，而不是放宽规则到永不报错。测试见 Task 12 Step 1（先取真实清单）、Step 5（证明会红）。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `lib/db/schema.ts` | 修改 | `folder` 加 `(org_id, project_id, id)` 唯一键；`node`/`folder`/`book_catalog` 父引用改复合外键；`node.level` 生成列；`ck_node_generation` |
| `lib/db/migrations/0008_*.sql` | 生成 | Task 3：`node.level` 生成列 + `ck_node_generation` |
| `lib/db/migrations/0009_*.sql` | 生成 | Task 4：`folder` 复合唯一键 + 父引用复合外键（三棵树） |
| `lib/db/migrations/0010_*.sql` | 手写 | Task 5：删 `node.mother_id` / `lineage.hang_rule` / `node.attributes` |
| `lib/lineage/services.ts` | 修改 | 去掉本地 `requireLineageWrite`，改 import；`delete*` 用 `withOrgWrite` |
| `lib/lineage/node-services.ts` | 修改 | 同上；`level` 不由应用写（生成列） |
| `lib/folder/services.ts` | 修改 | 改用共享 `requireOrgPermission` |
| `lib/db/services.ts` | 修改 | 3 处内联改共享 helper |
| `lib/db/guards.ts` | 新建 | `requireOrgPermission(tx, userId, orgId, permission)` — 唯一鉴权样板 |
| `lib/db/write.ts` | 新建 | `withOrgWrite(userId, orgId, permission, fn)` — 鉴权+事务一次成型 |
| `lib/db/queries/nodes.ts` | 修改 | 删 `getNodeById`/`countNodes`；`getNodes` 加 `NODE_VIEW_COLUMNS` 投影 |
| `lib/db/queries/folders.ts` | 修改 | 删 `getFolderById` |
| `lib/lineage/actions.ts` | 修改 | 删 `reorderSiblingsAction`；`revalidateProject` 收窄 |
| `lib/lineage/revalidate.ts` | 新建 | `revalidateProject(ref)` 唯一失效入口 |
| `components/lineage/types.ts` | 修改 | 加 `FolderOption`、`LineageListItem`、`toNodeViews` |
| `components/lineage/lineage-context.tsx` | 新建 | 请求级 `LineageIndex` Provider（一次计算，四处消费） |
| `components/lineage/derived.ts` | 修改 | 导出 `RANK_LABELS`；`rankLabel` 死分支简化 |
| `components/lineage/*.tsx` | 修改 | 四个组件改吃 `useLineageIndex()` |
| `scripts/check-file-size.mjs` | 新建 | F6 执行者 |
| `scripts/check-env-access.mjs` | 新建 | F7 执行者 |
| `scripts/verify-deployment.mjs` | 修改 | 加 F5（`pg_policies` 不可有裸子查询式策略）+ 迁移计数 |
| `biome.json` | 修改 | 加 `next/*` 禁入 `lib/db/**`（F1 等价，换前提） |
| `package.json` | 修改 | 加 `arch:check` / `docs:numbers` 脚本 |
| `.github/workflows/ci.yml` | 修改 | 串上 `arch:check` |
| `docs/architecture/03-components.md` | 修改 | 删「编译期强制待办」错误叙述 |
| `docs/architecture/07-quality.md` | 修改 | F1/F2/F4 删除或换前提；F5/F6/F7 标「已执行」 |
| `docs/architecture/05-data.md` | 修改 | 记录 `level` 生成列与三棵树统一边约束 |
| `docs/implementation-status.md`、`docs/setup.md`、`docs/ops-target.md` | 修改 | 测试数字、迁移数只写一处 |

---

### Task 1: 鉴权样板收成一处（`requireOrgPermission`）

**Files:**
- Create: `lib/db/guards.ts`
- Modify: `lib/lineage/services.ts:31-38`（删本地 `requireLineageWrite`）、`lib/lineage/node-services.ts:74-81`（同）
- Modify: `lib/folder/services.ts:27-34`、`lib/db/services.ts:45-46,104-105,157-158`
- Test: `tests/org-guards.test.ts`

**Interfaces:**
- Consumes: `getOrgRoleInTx(tx, userId, orgId): Promise<OrgRole | null>`、`hasPermission(role, permission): boolean`（`lib/auth/permissions.ts:41,63`）、`DbTransaction`（`lib/db/drizzle.ts:68`）、**`OrgPermission`（`lib/auth/access-control.ts:30`，已有 9 个权限字符串的联合类型）**
- Produces:
  - `requireOrgPermission(tx: DbTransaction, userId: string, orgId: string, permission: OrgPermission): Promise<boolean>`——**签名里用已有的 `OrgPermission`，不新造类型**。`lib/auth/access-control.ts:19-30` 已经是 9 个权限字符串的唯一事实源；再造一个收窄的子集就是本计划正要消灭的那类重复
  - 后续任务一律调用它，不再写本地 `require*Write`。

- [ ] **Step 1: 写失败的测试**

新建 `tests/org-guards.test.ts`（纯单测，mock `getOrgRoleInTx`）。**mock 必须写在 `import` 之后、被测模块被动态导入之前**，否则 `requireOrgPermission` 会拿到真实实现并去连库：

```ts
import { describe, expect, it, vi } from 'vitest';
import { requireOrgPermission } from '@/lib/db/guards';

vi.mock('@/lib/auth/permissions', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/permissions')>()),
  getOrgRoleInTx: vi.fn(),
}));
const { getOrgRoleInTx } = await import('@/lib/auth/permissions');

describe('requireOrgPermission', () => {
  it('returns false when the caller is not a member', async () => {
    vi.mocked(getOrgRoleInTx).mockResolvedValue(null);
    await expect(
      requireOrgPermission({} as never, 'u1', 'o1', 'lineage.write')
    ).resolves.toBe(false);
  });

  it('returns false for viewer on a write permission and true for editor', async () => {
    vi.mocked(getOrgRoleInTx).mockResolvedValue('viewer');
    await expect(
      requireOrgPermission({} as never, 'u1', 'o1', 'lineage.write')
    ).resolves.toBe(false);
    vi.mocked(getOrgRoleInTx).mockResolvedValue('editor');
    await expect(
      requireOrgPermission({} as never, 'u1', 'o1', 'lineage.write')
    ).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test tests/org-guards.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/db/guards"`

- [ ] **Step 3: 实现 `requireOrgPermission`**

新建 `lib/db/guards.ts`，内容为 `lineage/services.ts:31-38` 的现有实现（逐字搬迁，不重写逻辑）：

```ts
import 'server-only';
import type { OrgPermission } from '@/lib/auth/access-control';
import { getOrgRoleInTx, hasPermission } from '@/lib/auth/permissions';
import type { DbTransaction } from './drizzle';

export async function requireOrgPermission(
  tx: DbTransaction,
  userId: string,
  orgId: string,
  permission: OrgPermission
): Promise<boolean> {
  const role = await getOrgRoleInTx(tx, userId, orgId);
  return Boolean(role && hasPermission(role, permission));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test tests/org-guards.test.ts`
Expected: PASS（2 个用例）

- [ ] **Step 5: 14 处调用点全部改为共享 helper**

- `lib/lineage/services.ts`：删除 `:31-38` 的本地函数，`import { requireOrgPermission } from '@/lib/db/guards'`；`:141`、`:230`、`:308` 三处 `requireLineageWrite(tx, userId, orgId)` → `requireOrgPermission(tx, userId, orgId, 'lineage.write')`；删掉不再使用的 `getOrgRoleInTx` / `hasPermission` import（`:4`）。
- `lib/lineage/node-services.ts`：同法改 `:74-81` 与 8 处调用（`:250,329,401,478,552,622,704,824`）。
- `lib/folder/services.ts:27-34`：`requireProjectWrite` 删除，`:32` 调用点改 `requireOrgPermission(tx, userId, orgId, 'project.write')`。
- `lib/db/services.ts`：`:45-46`、`:104-105`、`:157-158` 三段 `const role = await getOrgRoleInTx(...); if (!role || !hasPermission(role, 'project.write'))` → `if (!(await requireOrgPermission(tx, userId, orgId, 'project.write')))`，保持原有的 reason 返回值不变。

- [ ] **Step 6: 全量验证（这一步是行为等价证据）**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm test:integration`
Expected: 单测 160+2 用例全绿；集成 122 用例全绿——**数量不允许减少**，减少说明漏改调用点。

- [ ] **Step 7: 提交**

```bash
git add lib/db/guards.ts lib/lineage/services.ts lib/lineage/node-services.ts \
  lib/folder/services.ts lib/db/services.ts tests/org-guards.test.ts
git commit -m "refactor(db): 鉴权样板收成 requireOrgPermission"
```

---

### Task 2: 写事务入口 `withOrgWrite`（鉴权 + `withOrg` 一次成型）

**Files:**
- Create: `lib/db/write.ts`
- Modify: `lib/lineage/node-services.ts`（8 个 `*InTransaction` 外层）
- Test: `tests/integration/with-org-write.test.ts`

**Interfaces:**
- Consumes: `withOrg`（`lib/db/drizzle.ts:75`）、`requireOrgPermission`（Task 1）、`NodeFailure` 的 `'forbidden'` 分支
- Produces:
  - `withOrgWrite<T>(params: { userId: string; orgId: string; permission: OrgPermission }, fn: (tx: DbTransaction) => Promise<T>): Promise<T | { ok: false; reason: 'forbidden' }>`
  - 返回联合类型与现有 `NodeMutationResult` 的 `'forbidden'` 分支**同形**，Action 层的中文映射不用改。

- [ ] **Step 1: 写失败的集成测试**

新建 `tests/integration/with-org-write.test.ts`。**没有 `setup()` 这个 helper**——仓库的惯用法是 `createUser()` → `getPersonalOrg()` → `addMember()`（见 `tests/helpers/factories.ts:27,42,67` 与 `tests/integration/org-scope.test.ts:36-40`），本文件用 `describe` 内一个本地 `scope(role)` helper 包一层：

```ts
async function scope(role: OrgRole) {
  const user = await createUser();
  const organization = await getPersonalOrg(user.id); // 注册触发器已建 + owner 成员
  await addMember({ userId: (await createUser()).id, organizationId: organization.id, role }); // 见下注
  return { user, organization };
}
```

> 注：个人组织里 `createUser()` 已是 `owner`，所以测 `viewer` 时要**新开一个组织**并把目标用户加成 viewer：
> ```ts
> const owner = await createUser();
> const organization = await createOrganization();
> await addMember({ userId: owner.id, organizationId: organization.id, role: 'owner' });
> const viewer = await createUser();
> await addMember({ userId: viewer.id, organizationId: organization.id, role: 'viewer' });
> ```

```ts
it('runs the callback when the caller has the permission', async () => {
  const { user, organization } = await ownerScope();
  const result = await withOrgWrite(
    { userId: user.id, orgId: organization.id, permission: 'lineage.write' },
    async (tx) => (await queryRows<{ ok: number }>(tx, sql`select 1 as ok`))[0]
  );
  expect(result).toEqual({ ok: 1 });
});

it('refuses before running the callback for a viewer', async () => {
  const { viewer, organization } = await viewerScope();
  const spy = vi.fn();
  const result = await withOrgWrite(
    { userId: viewer.id, orgId: organization.id, permission: 'lineage.write' },
    spy
  );
  expect(result).toEqual({ ok: false, reason: 'forbidden' });
  expect(spy).not.toHaveBeenCalled();
});

// Review Focus #4：提前 return 之后，连接复用不能带着上一个请求的 role/claims。
it('leaves no role or claims residue after an early refusal', async () => {
  const { viewer, organization } = await viewerScope();
  await withOrgWrite(
    { userId: viewer.id, orgId: organization.id, permission: 'lineage.write' },
    async () => 'unreachable'
  );
  // 同一个连接池、下一个请求：owner 必须仍能读到自己的组织。
  const { user: owner, organization: ownOrg } = await ownerScope();
  const rows = await withOrg(owner.id, (tx) =>
    tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, ownOrg.id))
  );
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:integration -- tests/integration/with-org-write.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现**

`lib/db/write.ts`：在 `withOrg` 的第一个回调步骤里先 `requireOrgPermission`，为 false 时**立即返回** `{ ok: false, reason: 'forbidden' }` 且不调用 `fn`，为 true 时把 `fn(tx)` 的返回值原样透出。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:integration -- tests/integration/with-org-write.test.ts`
Expected: PASS（2 个用例）

- [ ] **Step 5: 8 个写入口改用 `withOrgWrite`**

`lib/lineage/node-services.ts` 的 8 个导出函数（`createRootNodeInTransaction:236`、`addChildInTransaction:314`、`addSiblingInTransaction:385`、`addSpouseInTransaction:464`、`updateNodeInTransaction:541`、`deleteNodeInTransaction:612`、`moveNodeInTransaction:693`、`reorderSiblingsInTransaction:814`）：把 `withOrg(userId, async (tx) => { if (!(await requireOrgPermission(...))) return {ok:false, reason:'forbidden'}; ... })` 改成 `withOrgWrite({ userId, orgId, permission: 'lineage.write' }, async (tx) => { ... })`，函数体其余部分**逐字不动**。

- [ ] **Step 6: 验证**

Run: `pnpm check && pnpm typecheck && pnpm test:integration`
Expected: 122 用例全绿，其中 `tests/integration/nodes.test.ts` 的越权用例（viewer 写入被拒）必须仍然绿——这是「forbidden 分支没丢」的证据。

- [ ] **Step 7: 提交**

```bash
git add lib/db/write.ts lib/lineage/node-services.ts tests/integration/with-org-write.test.ts
git commit -m "refactor(lineage): 写入口改用 withOrgWrite"
```

---

### Task 3: `node.level` 生成列 + `generation` 不变量 CHECK

**Files:**
- Modify: `lib/db/schema.ts:334-336`（`depth` 声明附近）
- Create: `lib/db/migrations/0008_*.sql`（`pnpm db:generate` 生成）
- Test: `tests/integration/constraints.test.ts`（追加）

**Interfaces:**
- Consumes: 现有 `type ltree`（`schema.ts:27-32`）、`ck_node_spouse_has_no_path`
- Produces: `node.level: number`（**生成列，不可写**）；约束 `ck_node_generation_lte_level`（等价于 `generation >= level + 1`，但 CHECK 内联 `nlevel(path)` 而不引用生成列——PostgreSQL 不允许）
- **重要取舍**：`depth` 与 `generation` 目前是两个可独立写入的整数，而 `generation == depth + 1` 在今天的数据上**不成立**（`tests/helpers/factories.ts:167-189` 默认 `depth=0`、`generation` 必填，`folders-lineages.test.ts:465-480` 就写了 `generation=2`）。所以本任务**不**加 `generation == depth + 1`（会让现有测试数据红），而是加**派生列 `level = nlevel(path) - 1`** 与**单向下界 `generation >= level + 1`**——它拦住的正是「第 6 个写入口把 generation 算小」这个真实失败模式，且对现有数据成立。

- [ ] **Step 1: 写失败的约束测试**

在 `tests/integration/constraints.test.ts` 追加：

```ts
it('derives level from the ltree path instead of trusting the writer', async () => {
  const user = await createUser();
  const organization = await getPersonalOrg(user.id);
  const project = await createProject({ orgId: organization.id, createdBy: user.id });
  const lineage = await createLineage({ orgId: organization.id, projectId: project.id, createdBy: user.id });
  const root = await createNode({ orgId: organization.id, lineageId: lineage.id, createdBy: user.id, generation: 1, path: 'aaaa' });
  const child = await createNode({
    orgId: organization.id, lineageId: lineage.id, createdBy: user.id,
    generation: 2, path: 'aaaa.bbbb', parentId: root.id,
  });
  const rows = await getTestSql()`select id, level from node where id in (${root.id}, ${child.id}) order by level`;
  expect(rows.map((r) => r.level)).toEqual([0, 1]);
});

it('rejects a generation below the path-derived level and accepts a spa', async () => {
  const user = await createUser();
  const organization = await getPersonalOrg(user.id);
  const project = await createProject({ orgId: organization.id, createdBy: user.id });
  const lineage = await createLineage({ orgId: organization.id, projectId: project.id, createdBy: user.id });
  await expect(
    createNode({ orgId: organization.id, lineageId: lineage.id, createdBy: user.id, generation: 0, path: 'aaaa.bbbb' })
  ).rejects.toSatisfy((error) => pgErrorCode(error) === '23514');
  await expect(
    createNode({ orgId: organization.id, lineageId: lineage.id, createdBy: user.id, generation: 1, role: 'spouse', spouseOfId: rootId })
  ).resolves.toBeTruthy();
});
```

- [ ] **Step 2: 运行确认失败（并先体检存量数据）**

Run: `pnpm test:integration -- tests/integration/constraints.test.ts`
Expected: FAIL — 列 `level` 不存在（`42703`）

体检（**这一步不可跳过**，见 Review Focus #1）：

```bash
psql "$POSTGRES_URL" -c "select count(*) from node where path is not null and generation < nlevel(path)"
```

Expected: `0`。若非 0，**停止**，把违规行导出给人类伙伴决定修复方式，不要在迁移里夹带数据修复。

- [ ] **Step 3: 在 schema 加生成列与 CHECK**

`lib/db/schema.ts` 的 `nodes` 表定义里，`depth` 与 `generation` 之后插入：

```ts
    /** Derived from path; a generated column so a writer cannot disagree with it. */
    level: integer('level').generatedAlwaysAs(
      sql`case when ${sql.identifier('path')} is null then 0 else nlevel(${sql.identifier('path')}) - 1 end`
    ),
```

并在 `(t) => [...]` 里追加 CHECK。**CHECK 里必须手写 `path` 列名，不能引用 `t.level`**：PostgreSQL 的 CHECK 不能引用生成列（`ERROR: cannot use generated column in check constraint`），而 `drizzle-kit generate` 不会替我们拦这一步，它只会把 `t.level` 原样翻译成 `"level"`，然后在 `db:migrate` 时才炸。

```ts
    check(
      'ck_node_generation_lte_level',
      sql`${t.generation} >= case when ${t.path} is null then 1 else nlevel(${t.path}) end`
    ),
```

语义与 `generation >= level + 1` 完全等价：`path is null`（配偶）时 `level` 取 0，下界 1；`path` 是 `ltree` 时 `nlevel(path) - 1 + 1 = nlevel(path)`。

- [ ] **Step 4: 生成迁移并人工 review**

Run: `pnpm db:generate`
Expected: 新增 `lib/db/migrations/0008_*.sql`，内容只有 `ALTER TABLE "node" ADD COLUMN "level" integer GENERATED ALWAYS AS (...)` 与 `ADD CONSTRAINT "ck_node_generation_lte_level" CHECK ("generation" >= case when "path" is null then 1 else nlevel("path") end)`。**必须无 DROP、无 UPDATE、无数据修复**。若生成内容不符，改 schema 后重跑。

- [ ] **Step 5: 执行迁移并验证**

Run: `pnpm db:migrate && pnpm test:integration -- tests/integration/constraints.test.ts`
Expected: PASS

- [ ] **Step 6: 全量集成验证（证明存量数据满足新约束）**

Run: `pnpm test:integration`
Expected: 122+4 用例全绿

- [ ] **Step 7: 提交（迁移与代码同一 commit，因为生成列必须在 schema 里）**

```bash
git add lib/db/schema.ts lib/db/migrations tests/integration/constraints.test.ts
git commit -m "feat(db): 节点层级由 path 派生并约束 generation 下界"
```

---

### Task 4: 三棵树的边交给数据库（复合外键）

**Files:**
- Modify: `lib/db/schema.ts:263`（`folder.parentId`）、`:325-327`（`node.parentId`）、`:457-459`（`bookCatalog.parentId`），以及三表的 `(t) => [...]` 约束块
- Create: `lib/db/migrations/0009_*.sql`（`pnpm db:generate` 生成）
- Test: `tests/integration/constraints.test.ts`（追加）

**Interfaces:**
- Consumes: 现有 `folder` 的 `fk_folder_project`、`lineage` 的 `uk_lineage_organization_id`、`node` 的 `uk_node_organization_id`
- Produces: 三条复合外键——`folder(parent_id, org_id, project_id) → folder(id, org_id, project_id)`、`node(parent_id, org_id, lineage_id) → node(id, org_id, lineage_id)`、`book_catalog(parent_id, org_id, book_id) → book_catalog(id, org_id, book_id)`；为此需先给 `folder` 与 `book_catalog` 补 `unique(org_id, project_id, id)` / `unique(org_id, book_id, id)`（`node` 已有 `uk_node_organization_id`，Task 4 Step 3 补 lineage 维度 —— 见 Step 3 说明）

- [ ] **Step 1: 写失败的跨域父引用测试**

在 `tests/integration/constraints.test.ts` 追加：

```ts
it('rejects a node whose parent lives in another lineage', async () => {
  const user = await createUser();
  const organization = await getPersonalOrg(user.id);
  const projectA = await createProject({ orgId: organization.id, createdBy: user.id });
  const a = await createLineage({ orgId: organization.id, projectId: projectA.id, createdBy: user.id });
  const b = await createLineage({ orgId: organization.id, projectId: projectA.id, createdBy: user.id });
  const foreignParent = await createNode({ orgId: organization.id, lineageId: b.id, createdBy: user.id, generation: 1, path: 'aaaa' });
  await expect(
    createNode({ orgId: organization.id, lineageId: a.id, createdBy: user.id, parentId: foreignParent.id, generation: 2, path: 'bbbb' })
  ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');
});

it('still allows a null parent and a same-lineage parent (the leaf case)', async () => {
  const user = await createUser();
  const organization = await getPersonalOrg(user.id);
  const project = await createProject({ orgId: organization.id, createdBy: user.id });
  const lineage = await createLineage({ orgId: organization.id, projectId: project.id, createdBy: user.id });
  const root = await createNode({ orgId: organization.id, lineageId: lineage.id, createdBy: user.id, generation: 1, path: 'aaaa' });
  await expect(
    createNode({ orgId: organization.id, lineageId: lineage.id, createdBy: user.id, parentId: root.id, generation: 2, path: 'aaaa.cccc' })
  ).resolves.toBeTruthy();
});

it('rejects a folder whose parent belongs to another project', async () => {
  const user = await createUser();
  const organization = await getPersonalOrg(user.id);
  const projectA = await createProject({ orgId: organization.id, createdBy: user.id });
  const projectB = await createProject({ orgId: organization.id, createdBy: user.id });
  const folderInA = await createFolder({ orgId: organization.id, projectId: projectA.id, createdBy: user.id, kind: 0, name: '甲' });
  await expect(
    createFolder({ orgId: organization.id, projectId: projectB.id, createdBy: user.id, parentId: folderInA.id, kind: 0, name: '乙' })
  ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');
});

it('rejects a dangling folder parent (folder had no foreign key before)', async () => {
  const user = await createUser();
  const organization = await getPersonalOrg(user.id);
  const project = await createProject({ orgId: organization.id, createdBy: user.id });
  await expect(
    createFolder({ orgId: organization.id, projectId: project.id, createdBy: user.id, parentId: randomUUID(), kind: 0, name: '丙' })
  ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');
});
```

- [ ] **Step 2: 运行确认失败，并体检存量数据**

Run: `pnpm test:integration -- tests/integration/constraints.test.ts`
Expected: FAIL — 三条跨域写入当前**都会成功**（无约束）

体检（**不可跳过**）：

```bash
psql "$POSTGRES_URL" -c "
select 'node' t, count(*) from node c join node p on c.parent_id = p.id
 where (c.organization_id, c.lineage_id) <> (p.organization_id, p.lineage_id)
union all
select 'folder', count(*) from folder c join folder p on c.parent_id = p.id
 where (c.organization_id, c.project_id) <> (p.organization_id, p.project_id)
union all
select 'folder_dangling', count(*) from folder c where c.parent_id is not null
 and not exists (select 1 from folder p where p.id = c.parent_id)"
```

Expected: 三行全为 `0`。任一非 0 → **停下**，导出违规行交人类伙伴。

- [ ] **Step 3: 补复合唯一键并改父引用**

`lib/db/schema.ts`：

1. `folders` 的约束块加 `unique('uk_folder_org_project_id').on(t.orgId, t.projectId, t.id)`。
2. `folder.parentId` 由 `uuid('parent_id')` 改为保留列，但在约束块用 `foreignKey({ columns: [t.parentId, t.orgId, t.projectId], foreignColumns: [sql`id` 同表三列] })` 指向 self——Drizzle 自引用复合外键需用 `(): AnyPgColumn => folders.id` 形式声明三列；`onDelete('restrict')`。
3. `nodes` 的约束块加 `unique('uk_node_org_lineage_id').on(t.orgId, t.lineageId, t.id)`；`parentId` 的 `references(() => nodes.id)` 删除，改 `foreignKey({ columns: [t.parentId, t.orgId, t.lineageId], foreignColumns: [nodes.id, nodes.orgId, nodes.lineageId], name: 'fk_node_parent_same_lineage' }).onDelete('restrict')`。
4. `bookCatalogs` 同法：加 `unique('uk_book_catalog_org_book_id')`，`parentId` 由 `references` 改复合 `foreignKey(...).onDelete('restrict')`（**去掉 `cascade`**——`app_rw` 无 DELETE，级联永不触发，留着只会误导，见附录 B #9）。

- [ ] **Step 4: 生成迁移并人工 review**

Run: `pnpm db:generate`
Expected: `0009_*.sql` 里是 `ALTER TABLE ... ADD CONSTRAINT`（4 条唯一键 + 3 条复合外键 + 4 条 `DROP CONSTRAINT` 旧的单列外键）。**确认没有任何一行 `UPDATE` / `DELETE`**。

- [ ] **Step 5: 执行并验证**

Run: `pnpm db:migrate && pnpm test:integration -- tests/integration/constraints.test.ts`
Expected: PASS（3 个新用例）

- [ ] **Step 6: 确认应用层 5 个写入口零改动仍然全绿**

Run: `pnpm test:integration`
Expected: 全绿。若出现 `23503`，说明应用层某处**原本就在跨谱系挂父**——那是真 bug，记录到 `docs/implementation-status.md` 后再修，**不要**放宽约束。

- [ ] **Step 7: 提交**

```bash
git add lib/db/schema.ts lib/db/migrations tests/integration/constraints.test.ts
git commit -m "feat(db): 三棵树的父引用改为复合外键"
```

---

### Task 5: 删三列零读写的逃生舱（`mother_id` / `hang_rule` / `attributes`）

**Files:**
- Modify: `lib/db/schema.ts:328`（`motherId`）、`:296`（`hangRule`）、`:352-355`（`attributes`）
- Create: `lib/db/migrations/0010_*.sql`（`pnpm db:generate` 生成）
- Test: `tests/integration/migrations.test.ts`（追加）

**Interfaces:**
- Produces: `Node` 不再有 `motherId` / `attributes`；`Lineage` 不再有 `hangRule`。**任何 import 到它们的代码都会在 `pnpm typecheck` 处报错**——这一步就是靠类型系统找出残留引用。

- [ ] **Step 1: 写失败的迁移断言**

在 `tests/integration/migrations.test.ts` 追加：

```ts
it('drops unused escape-hatch columns', async () => {
  const rows = await getTestSql()`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'node' AND column_name IN ('mother_id', 'attributes'))
        OR (table_name = 'lineage' AND column_name = 'hang_rule'))`;
  expect(rows).toEqual([]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:integration -- tests/integration/migrations.test.ts`
Expected: FAIL — 实际返回 3 行

- [ ] **Step 3: 删列**

从 `lib/db/schema.ts` 删除三个字段声明。不要动其他任何列。

- [ ] **Step 4: 生成迁移并人工 review**

Run: `pnpm db:generate`
Expected: `0010_*.sql` 只有三条 `ALTER TABLE ... DROP COLUMN`。

- [ ] **Step 5: 执行并靠 typecheck 找残留**

Run: `pnpm db:migrate && pnpm typecheck`
Expected: 若有残留引用，报错会精确指出文件:行，就地删掉那些引用（预期为 0 处，因为已核实零读写）。然后 `pnpm test:integration`

- [ ] **Step 6: 提交**

```bash
git add lib/db/schema.ts lib/db/migrations tests/integration/migrations.test.ts
git commit -m "refactor(db): 删除零读写的 mother_id / hang_rule / attributes"
```

---

### Task 6: 谱系视图类型与 DTO 映射收成一处

**Files:**
- Modify: `components/lineage/types.ts`
- Modify: `app/(dashboard)/dashboard/project/[projectRef]/lineages/[lineageId]/page.tsx:46-67`
- Modify: `app/(dashboard)/dashboard/project/[projectRef]/lineages/layout.tsx:33-43`
- Test: `tests/lineage-view-types.test.ts`

**Interfaces:**
- Consumes: `Node`（`lib/db/schema.ts` `$inferSelect`）
- Produces:
  - `type FolderOption = { id: string; name: string; parentId: string | null }`
  - `type LineageListItem = { id: string; name: string; surname: string; hallCode: string | null; region: string | null; nodeCount: number; folderId: string | null }`
  - `toNodeView(node: Node): NodeView`
  - `toNodeViews(nodes: Node[]): NodeView[]`
  - `toFolderOption(folder: Folder): FolderOption`
  - `toLineageListItem(lineage: Lineage): LineageListItem`

- [ ] **Step 1: 写失败的映射测试**

新建 `tests/lineage-view-types.test.ts`：

```ts
// 直接构造一个「服务器行」字面量：它必须带 NodeView 里没有的服务器列，
// 否则这个测试无法证明 mapping 真的在收窄字段。
const nodeFixture = {
  id: 'n1', orgId: 'o1', lineageId: 'l1', parentId: null, spouseOfId: null,
  role: 'blood', path: 'aaaa', depth: 0, generation: 1, sort: 0,
  name: '实', surname: '陈', fullName: '陈实', sex: 0 as const,
  courtesy: null, namePrefix: null, isAlive: true, birthText: null,
  deathText: null, birthYear: null, deathYear: null, burialPlace: null,
  biography: null, createdAt: new Date(), createdBy: 'u1', updatedAt: null,
  deletedAt: null,
} as unknown as Node;

it('maps every NodeView field explicitly and drops server-only columns', () => {
  const view = toNodeView(nodeFixture);
  expect(Object.keys(view).sort()).toEqual([
    'biography', 'birthText', 'birthYear', 'burialPlace', 'courtesy', 'deathText',
    'deathYear', 'depth', 'fullName', 'generation', 'id', 'isAlive', 'name',
    'namePrefix', 'parentId', 'role', 'sex', 'sort', 'spouseOfId', 'surname',
  ]);
  expect(view).not.toHaveProperty('orgId');
  expect(view).not.toHaveProperty('path');
});

it('keeps a null folder parent for a lineage without a folder', () => {
  expect(toLineageListItem(lineageWithoutFolder).folderId).toBeNull();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test tests/lineage-view-types.test.ts`
Expected: FAIL — 导出不存在

- [ ] **Step 3: 实现映射并替换手抄**

`components/lineage/types.ts` 追加四个类型/函数（`NodeView` 字段集以现有 `:1-22` 为准，一个不多一个不少）。然后：

- `[lineageId]/page.tsx:46-67` 的 `nodes.map((node) => ({ ... }))` → `toNodeViews(nodes)`；`folders.map(...)` → `folders.map(toFolderOption)`；`lineage={{ ... }}` 的字段集改由页面直接传 `lineage` 对象给组件，组件内部类型改用 `LineageInfo`（已有 `lineage-detail.tsx:77`），**不再在页面里手抄**。
- `lineages/layout.tsx:33-43` 的 `lineages.map(...)` → `lineages.map(toLineageListItem)`；`folders.map(...)` → `folders.map(toFolderOption)`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test tests/lineage-view-types.test.ts && pnpm typecheck`
Expected: PASS；typecheck 无错（若组件 props 类型与新映射不一致，会在这里暴露）

- [ ] **Step 5: 提交**

```bash
git add components/lineage/types.ts 'app/(dashboard)/dashboard/project/[projectRef]/lineages/[lineageId]/page.tsx' \
  'app/(dashboard)/dashboard/project/[projectRef]/lineages/layout.tsx' tests/lineage-view-types.test.ts
git commit -m "refactor(lineage): NodeView/LineageListItem 映射收成一处"
```

---

### Task 7: `FolderOption` 三份与 `folderOptions()` 两份合一

**Files:**
- Modify: `components/lineage/create-lineage-dialog.tsx:39-62`（删本地类型与函数）
- Modify: `components/lineage/lineage-edit-dialog.tsx:34-62`（同）
- Modify: `components/lineage/lineage-detail.tsx:71-75`（删本地类型，改 import）
- Modify: `components/lineage/types.ts`（加 `folderOptions`）
- Test: `tests/folder-options.test.ts`

**Interfaces:**
- Consumes: `FolderOption`（Task 6 产出）
- Produces: `folderOptions(folders: FolderOption[]): { id: string; label: string }[]`——按层级深度加 `— ` 前缀，**行为与现有两份实现逐字一致**（`lineage-edit-dialog.tsx:40-62`）

> **顺序依赖**：`FolderOption` 类型由 Task 6 在 `components/lineage/types.ts` 里产出。本任务的 `folderOptions()` 也放在同一个文件里，因此 **Task 7 必须在 Task 6 之后执行**；若并行，会同时改 `types.ts` 冲突。

- [ ] **Step 1: 写失败的测试（钉住现有行为，含孤儿父节点）**

新建 `tests/folder-options.test.ts`：

```ts
const folders: FolderOption[] = [
  { id: 'a', name: '甲', parentId: null },
  { id: 'b', name: '乙', parentId: 'a' },
  { id: 'c', name: '丙', parentId: 'a' },
  { id: 'd', name: '丁', parentId: 'missing' }, // 孤儿：父不在列表里
];

it('indents by depth and promotes orphans to the top level', () => {
  expect(folderOptions(folders)).toEqual([
    { id: 'a', label: '甲' },
    { id: 'd', label: '丁' },
    { id: 'b', label: '— 乙' },
    { id: 'c', label: '— 丙' },
  ]);
});

it('returns an empty list for an empty project', () => {
  expect(folderOptions([])).toEqual([]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test tests/folder-options.test.ts`
Expected: FAIL — `folderOptions` 未从 `@/components/lineage/types` 导出

- [ ] **Step 3: 搬迁实现并删两份副本**

把 `lineage-edit-dialog.tsx:40-62` 的 `folderOptions` 逐字移到 `components/lineage/types.ts` 并 `export`；三个组件的本地 `type FolderOption` 全部删除，改 `import type { FolderOption, folderOptions } from './types'`（`lineage-detail.tsx` 只需要类型）。

- [ ] **Step 4: 验证**

Run: `pnpm test tests/folder-options.test.ts && pnpm check && pnpm typecheck && pnpm test`
Expected: 全绿；`pnpm check` 不报未使用 import

- [ ] **Step 5: 提交**

```bash
git add components/lineage/types.ts components/lineage/create-lineage-dialog.tsx \
  components/lineage/lineage-edit-dialog.tsx components/lineage/lineage-detail.tsx \
  tests/folder-options.test.ts
git commit -m "refactor(lineage): FolderOption 与 folderOptions 合并为单一定义"
```

---

### Task 8: 谱系索引一次计算、四处消费

**Files:**
- Create: `components/lineage/lineage-index-context.tsx`
- Modify: `components/lineage/lineage-detail.tsx:372`、`components/lineage/canvas/genealogy-canvas.tsx:133`、`components/lineage/person-inspector.tsx:80`、`components/lineage/node-create-dialog.tsx:108`
- Test: `tests/lineage-index-context.test.tsx`

**Interfaces:**
- Consumes: `buildLineageIndex(nodes: NodeView[]): LineageIndex`（`components/lineage/derived.ts:21`）
- Produces:
  - `LineageIndexProvider({ nodes, children })` — 内部 `useMemo(() => buildLineageIndex(nodes), [nodes])`
  - `useLineageIndex(): LineageIndex` — 无 Provider 时 `throw new Error('useLineageIndex must be used inside LineageIndexProvider')`（**不要**静默返回空索引，否则画布会静默画空）
  - 四个组件**不再接收或构造 index**，改调 `useLineageIndex()`

- [ ] **Step 1: 写失败的测试**

新建 `tests/lineage-index-context.test.tsx`（用 `@testing-library/react` 的渲染约定；若仓库未装 RTL，则改为断言 hook 的抛错分支 + Provider 的 memo 只调用一次，用 `vi.fn()` 包 `buildLineageIndex`）：

```tsx
it('builds the index once for four consumers', () => {
  const spy = vi.fn(buildLineageIndex);
  render(
    <LineageIndexProvider nodes={nodes} build={spy}>
      <A /><B /><C /><D />
    </LineageIndexProvider>
  );
  expect(spy).toHaveBeenCalledTimes(1);
});

it('throws outside a provider instead of silently rendering an empty tree', () => {
  expect(() => renderHook(() => useLineageIndex())).toThrow(/LineageIndexProvider/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test tests/lineage-index-context.test.tsx`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 Provider 并在 `lineage-detail.tsx` 挂一层**

Provider 包在 `LineageDetail` 内部、同时包含画布、检查器、录入弹窗的层级**之上**。四个组件删掉各自 `const index = useMemo(() => buildLineageIndex(nodes), [nodes])` 与 `index` props。

- [ ] **Step 4: 验证**

Run: `pnpm test tests/lineage-index-context.test.tsx && pnpm typecheck && pnpm test`
Expected: 全绿；`tests/lineage-canvas-layout.test.ts` 仍直接调 `buildLineageIndex`，不受影响

- [ ] **Step 5: E2E 回归（这是「画布还能用」的唯一证据）**

Run: `pnpm test:e2e`
Expected: 2 条关键路径全绿

- [ ] **Step 6: 提交**

```bash
git add components/lineage/lineage-index-context.tsx components/lineage/lineage-detail.tsx \
  components/lineage/canvas/genealogy-canvas.tsx components/lineage/person-inspector.tsx \
  components/lineage/node-create-dialog.tsx tests/lineage-index-context.test.tsx
git commit -m "perf(lineage): 谱系索引一次计算，四处消费"
```

---

### Task 9: 删死代码（4 个查询函数 + 1 个 Action + 1 处死分支 + 1 组重复常量）

**Files:**
- Modify: `lib/db/queries/nodes.ts`（删 `searchNodes:33`、`countNodes:81`、`getNodeById:58`）
- Modify: `lib/db/queries/folders.ts`（删 `getFolderById:29`）
- Modify: `lib/lineage/actions.ts`（删 `reorderSiblingsAction:402`）
- Modify: `components/lineage/derived.ts:109-115`（导出 `RANK_LABELS`、简化 `rankLabel`）
- Modify: `components/lineage/node-create-dialog.tsx:25-26`（改用导入的 `RANK_LABELS`）
- Modify: `tests/integration/queries.test.ts`、`tests/integration/nodes.test.ts`（删对应用例）

**Interfaces:**
- **不删**：`idx_node_search` / `idx_article_search` 两个 GIN 索引（谱文要用，删了以后还得重建）；`reorderSiblingsInTransaction`（Task 2 已改造，保留但标注 TODO：等 UI 排序功能接入）。
- Produces: `RANK_LABELS: { male: string[]; female: string[] }`（从 `derived.ts` 导出）

- [ ] **Step 1: 先证明它们真的没有调用方（把 grep 结果贴进 commit message）**

Run:
```bash
grep -rn "searchNodes\|countNodes\|getNodeById\|getFolderById\|reorderSiblingsAction" \
  --include=*.ts --include=*.tsx app components lib hooks
```
Expected: 只剩它们的**定义**行（以及各自 import 语句）。出现任何 `await xxx(` 调用 → **停止本任务**，把它接线而不是删掉。

- [ ] **Step 2: 写「常量只剩一份」的测试**

在 `tests/lineage-canvas-layout.test.ts` 追加：

```ts
it('exposes a single source for rank labels', () => {
  expect(RANK_LABELS.male).toEqual(['长子', '次子', '三子', '四子', '五子']);
  expect(RANK_LABELS.female).toEqual(['长女', '次女', '三女', '四女', '五女']);
});
```

（数组字面量以 `derived.ts:109-110` 的现有值为准；若与上面不同，**以代码为准**改测试。）

- [ ] **Step 3: 运行确认失败**

Run: `pnpm test tests/lineage-canvas-layout.test.ts`
Expected: FAIL — `RANK_LABELS` 未导出

- [ ] **Step 4: 删函数、删 Action、导出常量、简化死分支**

- 四个查询函数与一个 Action：整段删除，并删掉随之失效的 import。
- `derived.ts`：`MALE_RANKS`/`FEMALE_RANKS` 改为 `export const RANK_LABELS = { male: [...], female: [...] }`；`rankLabel` 的分支 `sex === 1 ? '配' : '配'` 简化为 `return '配'`。
- `node-create-dialog.tsx:25-26`：删本地数组，改 `import { RANK_LABELS } from './derived'`。

- [ ] **Step 5: 验证（含集成测试里被删用例的清理）**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm test:integration`
Expected: 全绿；单测用例数**允许减少**（删了对应测试），但**每一个减少都要能指到被删的函数**

- [ ] **Step 6: 提交**

```bash
git add lib/db/queries/nodes.ts lib/db/queries/folders.ts lib/lineage/actions.ts \
  components/lineage/derived.ts components/lineage/node-create-dialog.tsx \
  tests/integration/queries.test.ts tests/integration/nodes.test.ts tests/lineage-canvas-layout.test.ts
git commit -m "refactor: 删除零调用方的查询/Action 与重复常量"
```

---

### Task 10: 收窄 `revalidatePath`（15 处整树 → 精确路径）

**Files:**
- Create: `lib/lineage/revalidate.ts`
- Modify: `lib/lineage/actions.ts:57-59`、`lib/folder/actions.ts:41,60,78`、`lib/project/actions.ts:46,89,90,108`、`lib/auth/actions/account.ts:138`
- Modify: `lib/org/actions.ts:104,140,174,229,260,302,351`（**保留整树**，见 Step 3 说明）
- Test: `tests/revalidate-paths.test.ts`

**Interfaces:**
- Consumes: `revalidatePath` from `next/cache`
- Produces:
  - `revalidateProject(orgSlug: string, projectRef: string): void` — 失效 `/dashboard/org/${orgSlug}` + `/dashboard/project/${projectRef}` 两棵子树（`'layout'` 类型）
  - `revalidateOrg(orgSlug: string): void` — 失效 `/dashboard/org/${orgSlug}`
  - **不**失效 `/dashboard` 根

- [ ] **Step 1: 写失败的测试（断言实际传出的参数）**

新建 `tests/revalidate-paths.test.ts`（mock `next/cache`）：

```ts
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

it('scopes a lineage write to its own project subtree', () => {
  revalidateProject('orgslug123456789abc', 'projref123456789abc');
  expect(revalidatePath).toHaveBeenCalledTimes(2);
  expect(revalidatePath).toHaveBeenCalledWith('/dashboard/project/projref123456789abc', 'layout');
  expect(revalidatePath).toHaveBeenCalledWith('/dashboard/org/orgslug123456789abc', 'layout');
  expect(revalidatePath).not.toHaveBeenCalledWith('/dashboard', 'layout');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test tests/revalidate-paths.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现并逐处替换**

新建 `lib/lineage/revalidate.ts` 实现两个函数。

替换规则：
- **谱系/人丁/分类写入** → `revalidateProject(orgSlug, projectRef)`。这些 Action 目前拿不到 `orgSlug`/`projectRef`：从 `data` 里取不到就从服务层返回值里取（`lib/lineage/services.ts` 的每个 result 已返回 `lineage`/`project` 对象时优先用它对**已有**字段；若缺 `ref`/`slug`，则在 query 里 `select` 补这两列——**不要**额外开查询）。
- **项目设置写入** → `revalidateProject(...)`（`project/actions.ts:46`）。
- **项目创建** → 保留 `:90` 已有精确路径，`:89` 的整树**改为** `revalidateOrg(orgSlug)`。
- **账号资料** → `revalidatePath('/dashboard/(account)', 'layout')` 不够用（账号页无 org scope），保留 `/dashboard` 整树**并在代码里加一行注释说明原因**：用户菜单与组织选择器在根布局读会话，账号改名必须刷新整树。
- **组织类写入（`org/actions.ts` 7 处）** → 一并改 `revalidateOrg(orgSlug)`；但**成员变更**（`:229`、`:260`）与**删组织**（`:351`）会改变当前用户的组织列表（根布局 `getOrgsForUser`），这 3 处**保留整树**并加注释。

- [ ] **Step 4: 验证**

Run: `pnpm test tests/revalidate-paths.test.ts && pnpm check && pnpm typecheck && pnpm test`
Expected: 全绿

- [ ] **Step 5: E2E 回归（失效范围改小最容易漏刷新的地方）**

Run: `pnpm test:e2e`
Expected: 2 条全绿；特别确认「建谱系 → 侧栏出现」与「检查器保存 → 画布更新」这两步

- [ ] **Step 6: 提交**

```bash
git add lib/lineage/revalidate.ts lib/lineage/actions.ts lib/folder/actions.ts \
  lib/project/actions.ts lib/org/actions.ts lib/auth/actions/account.ts tests/revalidate-paths.test.ts
git commit -m "fix(ui): 失效范围从整树收窄到写入所属子树"
```

---

### Task 11: F5 —— 把「策略必须用 `has_org_role`」从文档条款变成数据库断言

**Files:**
- Modify: `scripts/verify-deployment.mjs`（新增一个检查函数，并在 `main()` 里调用）
- Test: `tests/docs-consistency.test.ts`（断言脚本确实含该检查，防被删）

**Interfaces:**
- Consumes: 现有 `BUSINESS_TABLES` 常量与 `queryRows` 风格（`scripts/verify-deployment.mjs:274-297`）
- Produces: 一条失败即 exit 1 的检查 `assertNoBareRlsPolicies()`

- [ ] **Step 1: 写失败的测试**

在 `tests/docs-consistency.test.ts` 追加：

```ts
it('deploy verification rejects bare RLS policies', () => {
  const source = readFileSync('scripts/verify-deployment.mjs', 'utf8');
  expect(source).toContain('pg_policies');
  expect(source).toMatch(/has_org_role|qual.*is\s+true|organization_id\s+IN/i);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test tests/docs-consistency.test.ts`
Expected: FAIL — `pg_policies` 未出现

- [ ] **Step 3: 实现检查**

在 `scripts/verify-deployment.mjs` 里加：查 `pg_policies`，对 `public` schema 下所有 `cmd = 'ALL'` 或 `qual` 里出现 `organization_member` 子查询的策略报错。允许清单只有 `auth_service` 的 `FOR ALL USING (true)`（`0003_better_auth.sql:288-290` 那组），用 `roles` 列区分，**不要**用表名白名单（否则新表加进来不会失败）。

- [ ] **Step 4: 本地验证**

Run: `pnpm build && pnpm start -p 3100 & sleep 8 && node scripts/verify-deployment.mjs --base-url http://127.0.0.1:3100; kill %1`
Expected: 新检查 PASS，其余项与改动前一致

- [ ] **Step 5: 提交**

```bash
git add scripts/verify-deployment.mjs tests/docs-consistency.test.ts
git commit -m "feat(arch): 部署验证断言 RLS 策略不使用裸子查询"
```

---

### Task 12: F6 + F7 —— 文件行数与 `process.env` 两个执行者

**Files:**
- Create: `scripts/check-file-size.mjs`、`scripts/check-env-access.mjs`
- Modify: `package.json`（`"arch:check": "node scripts/check-file-size.mjs && node scripts/check-env-access.mjs"`）
- Modify: `.github/workflows/ci.yml`（`Docs consistency` 之后就位插入 `pnpm arch:check`）
- Test: `tests/arch-check.test.ts`

**Interfaces:**
- Produces: `pnpm arch:check`，非零退出即 CI 红。两个脚本都支持 `--update-baseline` 之外的**不允许**自动放宽：违规只能靠改代码或人工编辑豁免清单消除。

- [ ] **Step 1: 先拿真实违规清单（不许先猜）**

Run:
```bash
find app components lib hooks -name '*.ts' -o -name '*.tsx' | xargs wc -l | awk '$1>400 && $2!="total"' | sort -rn
grep -rn "process\.env" app components lib hooks | grep -v 'lib/config.ts'
```
Expected（本基线实测）：行数 **10 个**文件超标（附录 B）；`process.env` **4 处**（`lib/logger.ts:11,13`、`lib/db/auth-db.ts:26,33`）

- [ ] **Step 2: 先写测试，再实现（F7 的 4 处违规在 Step 3 修）**

新建 `tests/arch-check.test.ts`：断言两个脚本对**已知违规样本**返回非零、对合规样本返回零（用临时目录构造样本，不跑全仓）。

- [ ] **Step 3: 实现两个脚本**

- `check-file-size.mjs`：遍历 `app components lib hooks`，阈值 400，豁免清单写在脚本顶部 `EXEMPT` 数组里，**每项必须带原因注释**。
- `check-env-access.mjs`：除 `lib/config.ts` 外，任何 `process.env.` 出现即报错；豁免同样带原因。F7 的 4 处违规**不豁免**，改为：`lib/logger.ts` 从 `getServerConfig()` 取 `LOG_LEVEL`（若配置里还没有就先加进 `lib/config.ts`）；`lib/db/auth-db.ts` 的 `process.env.VERCEL` 改为从 `lib/config.ts` 导出的 `isVercel()`。

- [ ] **Step 4: 运行确认新执行者生效**

Run: `pnpm arch:check`
Expected: 退出码 0，输出「10 files exempted」「0 env violations」

- [ ] **Step 5: 证明它会红（这一步不做等于没有执行者）**

在 `scripts/check-env-access.mjs` 的豁免里**临时**删掉一个，重跑 `pnpm arch:check`，确认退出码 1；然后恢复。

- [ ] **Step 6: 接入 CI 并提交**

```bash
git add scripts/check-file-size.mjs scripts/check-env-access.mjs package.json \
  .github/workflows/ci.yml tests/arch-check.test.ts lib/logger.ts lib/config.ts lib/db/auth-db.ts
git commit -m "feat(arch): 文件行数与 process.env 访问进入 CI"
```

---

### Task 13: 删掉前提不存在的架构约束（F1/F2/F4）

**Files:**
- Modify: `docs/architecture/07-quality.md:59-65`
- Modify: `docs/architecture/03-components.md:74-81`
- Modify: `biome.json`（加一条 `overrides`）

**Interfaces:**
- **不删** F5/F6/F7/F8/F9（都已在前序任务或 CI 里有执行者）。

- [ ] **Step 1: 把 F1 换成一个真前提**

F1 原文「`service.ts` 不得 import `next/*`」——仓库没有 `*.service.ts`。等价的**真**约束是「`lib/db/**` 不得 import `next/*`」，在 `biome.json` 已有的 `overrides` 里追加：

```json
{ "includes": ["lib/db/**/*.ts"], "linter": { "rules": { "style": { "noRestrictedImports": { "level": "error", "options": { "patterns": [{ "group": ["next/*"], "message": "lib/db 是基础设施层，不得依赖 Next 运行时" }] } } } } } }
```

- [ ] **Step 2: 运行确认新规则不误伤**

Run: `pnpm check`
Expected: 0 error。若报 `lib/db/**` 里真有 `next/*` import，逐个判断：是误用就改，是必要依赖（如 `next/cache`）就**不要**放宽整条规则，而是在 `paths` 里精确放行该模块并写注释。

- [ ] **Step 3: 改文档（删愿望，写事实）**

`docs/architecture/07-quality.md:59-65` 改成：

- 「已执行」表补 F5（`verify:deploy`）、F6（`arch:check`）、F7（`arch:check`）、F1-equivalent（`biome.json` `lib/db` → `next/*`）
- 删除 F2（`src/server/db` 不存在）与 F4（无定义）两行
- 保留 `07-quality.md:20`「单文件 ≤400 行 / 未配置」→ 改为「已配置（`arch:check`，10 个存量豁免）」

`docs/architecture/03-components.md:74-81` 的「Biome 规则待接入」与 `:81` 的「约束状态」段落改为事实：`noRestrictedImports` 已接入，清单列出具体规则；并补上沿用 `docs/architecture/02-context` 已有写法的**具体违反项未接入**（本次未动 `components/**` 对 `@/lib/*` 的依赖）。

- [ ] **Step 4: 验证文档一致性检查**

Run: `pnpm docs:check --strict && pnpm check`
Expected: `0 issue(s)`；Biome 0 error

- [ ] **Step 5: 提交**

```bash
git add biome.json docs/architecture/07-quality.md docs/architecture/03-components.md
git commit -m "docs(arch): 删除前提不存在的约束，登记新执行者"
```

---

### Task 14: 文档数字收成单一事实源

**Files:**
- Modify: `docs/implementation-status.md:37,44,93-94`、`docs/setup.md:121,180,381,403`、`docs/ops-target.md:270`
- Modify: `tests/docs-consistency.test.ts`

**Interfaces:**
- Consumes: `lib/db/migrations/meta/_journal.json`（迁移数的唯一事实源）、`AGENTS.md:57`（已经正确的测试数字）
- Produces: `docs/*.md` 里**不再出现**测试用例数与迁移文件数的硬编码；改为指向源

- [ ] **Step 1: 写失败的断言（禁止再手抄）**

在 `tests/docs-consistency.test.ts` 追加：

```ts
const FORBIDDEN_NUMBER_CLAIMS = [
  '18 个 Vitest 文件', '18 个文件 137 个用例', '11 个文件 117 个用例',
  '七个文件', '四个迁移', '12 个文件 134 个用例',
];

it('does not hand-copy test counts or migration counts into docs', () => {
  for (const file of ['docs/implementation-status.md', 'docs/setup.md', 'docs/ops-target.md']) {
    const text = readFileSync(file, 'utf8');
    for (const claim of FORBIDDEN_NUMBER_CLAIMS) {
      expect(text, `${file} still claims "${claim}"`).not.toContain(claim);
    }
  }
});

it('migration count is derived from the journal, not retyped', () => {
  const journal = JSON.parse(readFileSync('lib/db/migrations/meta/_journal.json', 'utf8'));
  // 8 + Task 3/4/5 各新增一个迁移 = 11。断言取「≥」而不是「==」，
  // 否则每加一个迁移都要改这个测试，测试就变成了要维护的第二份事实源。
  expect(journal.entries.length).toBeGreaterThanOrEqual(11);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test tests/docs-consistency.test.ts`
Expected: FAIL — 三份文档仍含至少一处旧数字

- [ ] **Step 3: 改文档**

- `docs/implementation-status.md:37`：测试数字改为「以 `pnpm test` 输出为准」+ 当前值（22/160、11/122，与 `AGENTS.md:57` 一致）；`:93-94` 同。
- `:44` 的七个迁移枚举删除，改为：「迁移以 `lib/db/migrations/meta/_journal.json` 为准」。**不要**在这里重复文件名列表——一旦重复，下次就会再漂一次。
- `docs/setup.md:121,180,381,403`：同上两处处理。
- `docs/ops-target.md:270`：「当前仓库实际是四个迁移」→「迁移以 `_journal.json` 为准」。

- [ ] **Step 4: 验证**

Run: `pnpm test tests/docs-consistency.test.ts && pnpm docs:check --strict`
Expected: PASS；`0 issue(s)`

- [ ] **Step 5: 提交**

```bash
git add tests/docs-consistency.test.ts docs/implementation-status.md docs/setup.md docs/ops-target.md \
  docs/architecture/05-data.md
git commit -m "docs: 测试与迁移数字改为单一事实源"
```

---

## 非目标（明确不做，写在这里是为了防止下一个 PR 顺手加回来）

| 不做 | 理由 | 何时重新考虑 |
|---|---|---|
| 谱系读窗口（`depth <= N`）与服务端搜索接线（`searchNodes` + GIN） | 本轮**删**了 `searchNodes`（Task 9），因为它零调用方。真要做就是**一个独立项目**：需要「返回目标 + 祖先链」的接口契约、画布按代加载的交互、truncated 提示。混进重构 PR 会让「行为不变」这个前提失效 | 真实谱系规模 > 5000 节点（R17，需先量） |
| 拆 `lib/lineage/node-services.ts`（871 行）/ `lineage-detail.tsx`（858 行） | 本轮只把**重复**收口；拆文件是纯机械动作，但它会掩盖真正的行为变化。等 F6 的执行者稳定一段时间、且手上有对应的拆分测试再动 | F6 上线后，作为独立 PR 逐个文件拆 |
| 谱文/谱书/分享/回收站/编辑锁 | AGENTS.md 禁止清单 #1；目标规则未落地 | 走 `brainstorming` → spec → 独立计划 |
| `generate_public_id()` 的 schema 限定 | `0001_auth_rls.sql:410` 的 `GRANT` 与 `schema.ts:64` 的 `public.generate_public_id()` 一致；无实际风险 | 无 |
| 根布局为营销页也查库（`app/layout.tsx:28-32` 的 `getOrgsForUser` 对所有路由执行） | 它让 `/` 永久动态。修法是把这个查询下移到控制台布局，但那会**改变 `QueryProvider` 的组织列表首屏注入点**，属于「行为变化」而非「结构收敛」，会污染本分支「行为不变」的验收前提 | 本分支合入后单独开一个 PR，带 E2E 覆盖 `/` 的静态化断言 |
| 三个 `ON DELETE` 语义统一 | `restrict` 与 `cascade` 在 `app_rw` 下**都不会触发**（无 DELETE 权限，E4）。改它们零收益，只是让 diff 变长 | 引入物理删除路径时（R18） |
| 文档体系再拆一层 | `docs/architecture/` 拆分刚做完且 `check-docs.mjs` 在兜底；`docs/reviews/` 与 `docs/superpowers/` 是一次性产物，合计 5000 行但**不参与校验、不该被当现状读** | `check-docs.mjs` 开始在 `reviews/` 上跑的时候 |

---

## 附录 A：Linus 尺子 → 本计划落点

| 尺子 | 本计划里的动作 |
|---|---|
| L1 **数据结构优先于代码** | Task 3：`level` 变生成列——层级不再由 5 个写入口各自维护，而是从 `path` 派生；Task 4：边的归属交给复合外键 |
| L2 **好品味 = 消除特例** | Task 7：`FolderOption` 3 份 → 1 份；Task 6：DTO 手抄 → 单一映射；Task 8：索引 4 算 → 1 算 |
| L3 **复杂即敌** | Task 1/2：4 种鉴权写法 → 1 个 helper + 1 个写入口；Task 9：删 4 个查询 + 1 个 Action |
| L4 **理论服从实践** | Task 13：删 F1/F2/F4 三条**前提不存在**的约束；`docs/architecture/04-runtime.md` 的「一个渲染单元一个事务」保留（它是可实现的，见证据基线第 1 行） |
| L5 **不破坏用户空间** | 全部 CHECK/外键都是**追加**；5 个写入口零改动；Task 4 Step 2 与 Task 3 Step 2 先体检存量数据 |
| L6 **Talk is cheap，show me the code** | 每个任务都有可执行的验收命令与 `file:line`；Task 12 Step 5 专门「证明它会红」 |
| L7 **让约束可执行** | Task 11（F5 进 `verify:deploy`）、Task 12（F6/F7 进 CI）、Task 13（F1 换真前提 + 文档改事实）、Task 14（数字进单测） |
| L8 **一次一个补丁** | 14 个任务 = 14 个可独立回滚的 commit；迁移各占其中 3 个，与业务代码分开 |

## 附录 B：实测违规与死代码清单（本计划删除/处理的对象）

**F6 超标文件（10 个，Task 12 的豁免基线）**

| 行数 | 文件 |
|---:|---|
| 871 | `lib/lineage/node-services.ts` |
| 858 | `components/lineage/lineage-detail.tsx` |
| 776 | `components/lineage/canvas/genealogy-canvas.tsx` |
| 734 | `components/lineage/lineage-sidebar.tsx` |
| 717 | `components/ui/sidebar.tsx` |
| 648 | `lib/db/schema.ts` |
| 609 | `components/lineage/person-inspector.tsx` |
| 591 | `components/lineage/node-create-dialog.tsx` |
| 420 | `lib/lineage/actions.ts` |
| 403 | `components/lineage/create-lineage-dialog.tsx` |

**死代码（Task 5 / Task 9 处理）**

| 符号 | 定义 | 生产调用方 | 处置 |
|---|---|---|---|
| `searchNodes` | `lib/db/queries/nodes.ts:33` | 0（仅集成测试） | Task 9 删（索引 `idx_node_search` **保留**） |
| `countNodes` | `lib/db/queries/nodes.ts:81` | 0 | Task 9 删 |
| `getNodeById` | `lib/db/queries/nodes.ts:58` | 0 | Task 9 删 |
| `getFolderById` | `lib/db/queries/folders.ts:29` | 0 | Task 9 删 |
| `reorderSiblingsAction` | `lib/lineage/actions.ts:402` | 0（UI 无排序入口） | Task 9 删（`reorderSiblingsInTransaction` 保留并标 TODO） |
| `node.mother_id` | `lib/db/schema.ts:328` | 0 读写 | Task 5 删列 |
| `lineage.hang_rule` | `lib/db/schema.ts:296` | 0 读写 | Task 5 删列 |
| `node.attributes` | `lib/db/schema.ts:352-355` | 0 读写 | Task 5 删列 |
| `book_catalog.parent_id ON DELETE CASCADE` | `lib/db/schema.ts:457-459` | 永不触发（`app_rw` 无 DELETE） | Task 4 改 `restrict` |
| `rankLabel` 死分支 `sex === 1 ? '配' : '配'` | `components/lineage/derived.ts:113-115` | 恒为 `'配'` | Task 9 简化 |
| `MALE_RANKS`/`FEMALE_RANKS` 第二份 | `components/lineage/node-create-dialog.tsx:25-26` | 与 `derived.ts:109-110` 逐字相同 | Task 9 改导入 |
| `FolderOption` 第二、三份 | `lineage-edit-dialog.tsx:34-38`、`create-lineage-dialog.tsx:39-43` | 与 `lineage-detail.tsx:71-75` 重复 | Task 7 合一 |
| `folderOptions()` 第二份 | `create-lineage-dialog.tsx:45` | 与 `lineage-edit-dialog.tsx:40` 逐字相同 | Task 7 合一 |
