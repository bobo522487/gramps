# 用 Linus 的尺子看这个仓库

> **评审对象**：`lib/**`、`app/**`、`components/lineage/**`、6 个迁移、`biome.json`、CI、`docs/` 目标文档
> **评审日期**：2026-10-24
> **评审基线**：`75f8ca6`
> **性质**：评审记录，**不是规范**。按 [`docs/README.md`](../README.md) §5.6，本文的建议在转成 ADR 或 `architecture/` 正文之前不具备约束力。
> **方法**：只问四件事——数据结构对不对？特例能不能消掉？这条约束有没有东西在执行它？删掉什么会比加什么更有效？

---

## 0. 结论

**数据层是对的，应用层在重复自己，文档在说一套做一套。**

| | 判断 |
|---|---|
| 数据层（隔离、软删、索引、触发器） | **可以照抄。** `auth.has_org_role` 解 RLS 自递归、部分唯一索引、注册触发器建默认组织——这三处是真想清楚了，别动 |
| 树结构 | **有一处真正的坏品味**：配偶被塞进 `node` 表，用 `path IS NULL` 打补丁。这个特例从 CHECK 约束一路漏到画布布局：`role === 'blood'` / `role === 'spouse'` 的分支在 7 个文件里出现了 29 次 |
| 边约束 | **第三层防护是假的。** `node.parent_id` 只引用 `node(id)`，数据库允许你把人挂到别的谱系、别的组织下面 |
| 读路径 | 一次详情页渲染开 **7 个事务、约 35 次往返**。这不是"慢一点"，是每次翻页都在付结构性税 |
| 应用层 | `requireLineageWrite` 写了两遍，`buildLineageIndex` 算了四遍，`NodeView` 抄了四遍，`FolderOption` 定义了三次 |
| 文档 | **五处反向漂移**，其中 `data-model.md` §12.5 的 RLS 模板如果被 M2 照抄，会把已经修好的越权坑重新挖开 |

一句话：**这套系统缺的不是功能，是把已经写对的东西收成一处、把该由数据库管的事交回数据库。**

### 0.1 五条要点

1. **树的不变量全在应用层。** `generation = depth + 1`、`depth = nlevel(path) - 1` 在 5 个写入口都成立，但数据库一条 CHECK 都没有。第 6 个写入口出现的那天，它就破了。
2. **树的边没有复合外键。** 复合外键只到 `(org_id, lineage_id)` 这一层，`parent_id` 本身是裸 UUID 引用。所谓"三层防护"，在边上只有两层。
3. **读路径每个查询一个事务。** `withOrg` 一次 ≈5 次往返，全仓 40 处调用。详情页 7 个事务。
4. **同一份派生数据算了四遍。** `buildLineageIndex` 在画布、详情、检查器、录入弹窗各算一次；`subtreeIds` 在客户端和服务端各写一套。
5. **没有一条架构约束在 CI 里执行。** 文档自己列了 8 条 fitness function，2 条有、6 条没有。没有执行的约束不是约束，是愿望。

---

## 1. 尺子

Linus 那套东西拆成可检查的条目，就是下面八条。本文每一条结论都必须落在这张表上，否则不写。

| # | 原则 | 本仓库的检查项 | 本次命中 |
|---|---|---|---|
| L1 | **数据结构优先于代码** | 同一个事实是否被多列/多表编码；同一种关系是否用三种方式建模 | `path`/`depth`/`generation` 三列一事实；`folder`/`node`/`book_catalog` 三种树 |
| L2 | **好品味 = 消除特例** | 是否存在"为了迁就模型缺陷"的分支 | 配偶节点 `path IS NULL`：29 处 `role` 分支，7 个文件 |
| L3 | **复杂即敌** | 一个目的用了几套机制 | 写后失效用了三套；日志写入用了两套 |
| L4 | **理论服从实践** | 文档目标在当前结构下是否可实现 | "一次渲染一个事务"在 layout+page 结构下不可实现 |
| L5 | **不破坏用户空间** | 改动是否会动到已经工作的东西 | 不迁 `src/modules`、不重置库、不改历史迁移 |
| L6 | **Talk is cheap, show me the code** | 每条建议能否给出可执行补丁 | 全部 P0/P1 附 diff 或精确改动清单 |
| L7 | **让约束可执行** | 约束是否有 lint/CI/测试在执行 | 0 条架构 lint；RLS 策略无断言 |
| L8 | **一次一个补丁** | 改动能否拆成可独立回滚的小步 | §8 的 10 个 commit |

**不评审**：视觉细节、无障碍、产品范围、定价。这些不是本次的问题所在。

---

## 2. 不要动（先划保护线）

批评容易误伤。下面这些是真正想清楚的地方，M2 之前不要以"重构"的名义碰。

| # | 决策 | 为什么它是对的 |
|---|---|---|
| 1 | `auth.has_org_role()` 用 `SECURITY DEFINER` 解 RLS 自引用递归 | 多数团队会在这里踩一次 `infinite recursion detected in policy`，而且报错指不到根因 |
| 2 | 部分唯一索引（`WHERE deleted_at IS NULL`） | 软删最容易漏的一环。漏一个，上线第一周就有"删了不能建同名"的工单 |
| 3 | 注册触发器建默认组织 | "有账号必有组织"只在唯一写入点上成立。放应用层，多一条注册路径就破一次 |
| 4 | `withOrg` 里用 `SET LOCAL` 而非会话级 `SET` | 会话级 `SET` 会污染连接池，下一个请求继承上一个用户的角色。这个坑躲对了 |
| 5 | 复合外键 `(organization_id, project_id)` | 跨组织的 `project_id` 在 schema 层就不成立。**注意：这层保护到 `node` 的边就断了，见 P0-1** |
| 6 | 布局是 React Flow 之外的纯函数 | `layoutBookLtr` 可单测、可替换。这是画布能长期维护的唯一原因 |
| 7 | 零后台任务 / 零队列 / 零缓存层 | 正确的减法。M1 没有消费者就不该有基础设施 |
| 8 | 保留 4 个只读 Route Handler | 不要执行"读收敛为 Server Action"这个目标。POST 不可缓存、不可预取、Next 会串行化排队 |
| 9 | `getSessionUser()` 只返回 `SessionUser` DTO | 已经收窄到 `{ id, name, email }`，别退回去 |
| 10 | Server Action 不 throw、返回判别联合 | 框架会把 throw 转成 500 错误页，UI 无法区分冲突与校验失败 |

---

## 3. 问题总表

优先级：**P0** = 现在就在产生错误结果或结构性成本 · **P1** = 下一个功能之前必须修 · **P2** = 记录，随手清理 · **-D** = 文档问题。

| # | 级别 | 结论 | 证据 |
|---|---|---|---|
| P0-1 | P0 | 树的边没有复合外键：数据库允许跨谱系、跨组织挂父 | `schema.ts:323-331` |
| P0-2 | P0 | 每个查询一个事务：详情页 7 事务 ≈35 往返；`node_count` 与节点列表跨快照 | `drizzle.ts:74-88` + 4 个布局/页面 |
| P0-3 | P0 | 谱系全量加载无上限；搜索在浏览器 O(n)，服务端 GIN 索引闲置 | `nodes.ts:7-30, 33-56`；`0001_auth_rls.sql:551` |
| P0-4 | P0 | 树不变量由 5 个应用写入口维护，数据库零校验；`generation` 是 `depth+1` 的冗余 | `node-services.ts`；`schema.ts:334-335` |
| P1-5 | P1 | 鉴权+事务样板重复：`requireLineageWrite` 两份完全相同，14 处调用 | `lineage/services.ts:29`、`node-services.ts:74` |
| P1-6 | P1 | `buildLineageIndex` 一次渲染算 4 遍；`subtreeIds` 客户端/服务端双实现 | 4 个组件 + `lineage-detail.tsx:87` |
| P1-7 | P1 | DTO 手抄：`NodeView` 21 个字段抄一遍；`FolderOption` 定义三次 | `[lineageId]/page.tsx:44-65` 等 |
| P1-8 | P1 | 三套失效机制；16 处 `revalidatePath` 里 15 处是整个 dashboard 树 | `lib/*/actions.ts` + 组件 |
| P1-9 | P1 | 根布局为所有路由查库，营销页因此永远动态 | `app/layout.tsx:28-32` |
| P1-10 | P1 | 活动日志在业务事务内写入，与 org actions 的提交后写入不一致 | `activity.ts:24-37` vs `org/actions.ts:45` |
| P1-11 | P1 | 无 `statement_timeout` / `idle_in_transaction_session_timeout` / `lock_timeout` | 全仓无 |
| P1-12 | P1 | 架构约束零执行：无 `noRestrictedImports`、无 RLS 策略断言 | `biome.json`；`07-quality.md:57-64` |
| P2-13 | P2 | 死代码/死索引：4 个查询函数只有测试调用；`mother_id`/`hangRule`/`attributes` 无写入 | 附录 B |
| P2-14 | P2 | 命名说谎：`lib/db/services.ts` 是 project 域；`lib/auth/schemas.ts` 含 project | 文件位置 |
| P2-15 | P2 | `db` Proxy 每次属性访问调 3 次 `getDb()`；`dotenv.config()` 是模块副作用 | `drizzle.ts:16, 51-56` |
| P2-16 | P2 | `rankLabel` 死分支 `sex === 1 ? '配' : '配'`；"配"不是排行 | `derived.ts:113-115` |
| P2-17 | P2 | `reorderSiblings` N 次 UPDATE、无 activity、不碰 `lineage.updatedAt` | `node-services.ts:866-869` |
| P2-18 | P2 | `onConflictDoNothing` 过宽，会吞掉未来任何唯一冲突 | `db/services.ts:75` |
| P2-19 | P2 | 三种树三种建模；`folder.kind` 魔数 0/1/2；`folder.parent_id` 连外键都没有 | `schema.ts:256-281, 447-494` |
| P2-20 | P2 | `ActionState` 是可选字段大杂烩，类型在说谎 | `lib/auth/types.ts:11-30` |
| P2-21 | P2 | 源码字符串断言脆弱，测的是实现细节不是行为 | `tests/security-regressions.test.ts:99-106` |
| D-22 | **P0** | `data-model.md` §12.5 的 RLS 模板漏 `deleted_at IS NULL`，与 0003 实现冲突 | `data-model.md:850-869` |
| D-23 | P1 | `add-a-feature.md` 断链到不存在的 `docs/status/implementation-status.md` | `add-a-feature.md:191` |
| D-24 | P1 | 测试数字三方不一致，README 是过期的那份 | `README.md:107` |
| D-25 | P2 | 「Route Handler 1 个」「`src/modules`」仍以目标口吻写着 | `03-components.md:133` |
| D-26 | P2 | 「一次渲染一个事务」未登记为偏差，且当前结构下不可实现 | `04-runtime.md:26-35` |

---

## 4. P0 详述

### P0-1 树的边没有复合外键，第三层防护在边上不存在

**事实**

`node` 的三个自引用列都只引用 `node(id)`：

```ts
// lib/db/schema.ts:323-331
parentId: uuid('parent_id').references((): AnyPgColumn => nodes.id, { onDelete: 'restrict' }),
motherId: uuid('mother_id').references((): AnyPgColumn => nodes.id, { onDelete: 'restrict' }),
spouseOfId: uuid('spouse_of_id').references((): AnyPgColumn => nodes.id, { onDelete: 'restrict' }),
```

复合外键只到谱系这一层：

```ts
// lib/db/schema.ts:359-364
foreignKey({
  columns: [t.orgId, t.lineageId],
  foreignColumns: [lineages.orgId, lineages.id],
  name: 'fk_node_lineage',
}).onDelete('restrict'),
```

`uk_node_organization_id` 是 `(organization_id, id)`，所以 `parent_id` 唯一能保证的是"这个父节点在同一个组织里"——**连同一谱系都保证不了**。

`folder.parent_id` 更糟，`0000_baseline.sql` 里根本没有对应的 FOREIGN KEY 行，它是个裸 UUID。

**为什么这是 P0**

`docs/architecture/05-data.md` 写"三层防护：应用层 WHERE + RLS + 复合外键"。前两层守的是"能不能看到这个组织的数据"，第三层守的是"这条边指的东西是否合法"。现在第三层在边上是不存在的：

- 任何一处漏传 `lineageId` 的 UPDATE（`node-services.ts` 里有多处 `.where(eq(nodes.id, nodeId))` 只按主键更新，见 `:598`、`:779`、`:867`）都能把节点挂到别的谱系；
- `deleteNode` 的子树查询靠 `path <@ target.path`，跨谱系的 path 前缀不同，不会误删，但父子关系已经错了，`buildLineageIndex` 会把那个节点当成孤儿丢进 `roots`；
- 数据错了不会报错，只会在某次导出/排版时表现为"这个人不见了"或者"多了一个始祖"。

族谱里"多了一个人/少了一个人"是最难发现、代价最高的一类 bug。

**补丁**

```sql
-- 1. 给三列 FK 提供复合唯一键（(org, id) 已存在，但不够）
ALTER TABLE node ADD CONSTRAINT uk_node_lineage_id UNIQUE (organization_id, lineage_id, id);

-- 2. 拆掉裸引用，换成带谱系维度的边
ALTER TABLE node DROP CONSTRAINT node_parent_id_node_id_fk;
ALTER TABLE node ADD CONSTRAINT fk_node_parent
  FOREIGN KEY (organization_id, lineage_id, parent_id)
  REFERENCES node (organization_id, lineage_id, id) ON DELETE RESTRICT;

ALTER TABLE node DROP CONSTRAINT node_mother_id_node_id_fk;
ALTER TABLE node ADD CONSTRAINT fk_node_mother
  FOREIGN KEY (organization_id, lineage_id, mother_id)
  REFERENCES node (organization_id, lineage_id, id) ON DELETE RESTRICT;

ALTER TABLE node DROP CONSTRAINT node_spouse_of_id_node_id_fk;
ALTER TABLE node ADD CONSTRAINT fk_node_spouse
  FOREIGN KEY (organization_id, lineage_id, spouse_of_id)
  REFERENCES node (organization_id, lineage_id, id) ON DELETE RESTRICT;
```

顺带给 `folder` 补上它从来没有的边：

```sql
ALTER TABLE folder ADD CONSTRAINT uk_folder_project_id UNIQUE (organization_id, project_id, id);
ALTER TABLE folder ADD CONSTRAINT fk_folder_parent
  FOREIGN KEY (organization_id, project_id, parent_id)
  REFERENCES folder (organization_id, project_id, id) ON DELETE RESTRICT;
```

**验收**

在 `tests/integration/nodes.test.ts` 加两条：

```ts
it('拒绝把节点挂到另一谱系的父节点上', async () => {
  // 用 A 谱系的 nodeId 作 B 谱系新节点的 parentId
  await expect(addChildInTransaction({ ...params, lineageId: b.id, parentId: aNode.id }))
    .rejects.toMatchObject({ code: '23503' });
});
```

**成本**：1 个迁移（纯 DDL，无数据回填，现有数据一定满足，因为应用层一直在校验）+ 2 条集成测试。半天。

> 注意：这条和 P0-4 是两个迁移，不要合并。一个加约束，一个删冗余列，回滚粒度不同。

---

### P0-2 每个查询一个事务：详情页 7 个事务、约 35 次往返

**事实**

```ts
// lib/db/drizzle.ts:74-88
export async function withOrg<T>(userId, fn) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local role app_rw`);            // 往返 2
    await tx.execute(sql`select set_config(...)`);            // 往返 3
    return fn(tx);                                            // 往返 4
  });                                                         // BEGIN=1, COMMIT=5
}
```

一次 `withOrg` ≈ **5 次往返**。全仓 40 处调用（`lib` 下逐文件统计：`node-services.ts` 8、`projects.ts` 4、`organizations.ts` 4、`nodes.ts` 4、`services.ts` 3、`folder/services.ts` 3、`lineage/services.ts` 3、`org/actions.ts` 2、`lineages.ts` 2、`folders.ts` 2、`activity.ts` 2、`seed.ts` 2、`permissions.ts` 1）。

谱系详情页一次渲染实际开的事务：

| 渲染单元 | 事务 | 来源 |
|---|---|---|
| 根布局 | 1 | `app/layout.tsx:32` `getOrgsForUser` |
| 项目布局 | 2 | `project/[projectRef]/layout.tsx:19-20`（scope + getProjects） |
| 谱系布局 | 2 | `lineages/layout.tsx:17-20`（navFolders + navLineages） |
| 详情页 | 2 | `[lineageId]/page.tsx:22-30`（getLineageById + getNodes） |
| **合计** | **7** | ≈ **35 次往返** |

`getNavFolders` 用了 React `cache()`，页面里的第二次调用命中缓存，所以不是 8。`Promise.all` 只是并发，不改往返总数。

这张表**还没算会话校验**：`getSessionUser()` 走的是另一条连接（`auth_service`），一次 `auth.api.getSession` 至少 1 次往返，且它在根布局里对每个请求都要跑一次。算上它，一次详情页渲染的数据库往返约 **36–38 次**。

**这不是"慢一点"**

Neon 同区域 RTT 按 5 / 10 / 20ms 三档算：

| 场景 | 往返 | @5ms | @10ms | @20ms |
|---|---:|---:|---:|---:|
| 现状 7 事务 | ~35 | 175ms | **350ms** | 700ms |
| 合并后 4 事务 | ~20 | 100ms | **200ms** | 400ms |
| TTFB 预算 | — | — | **400ms** | — |

也就是说：在 10ms RTT 下，**光数据库往返就吃掉 TTFB 预算的 87%**，页面渲染、RSC 序列化、CDN 都还没开始。

还有一个更隐蔽的后果：**7 个事务 = 7 个快照**。`lineage.node_count` 是冗余计数，`getLineageById` 和 `getNodes` 分属两个事务，并发写入时会出现"标题写 128 位族人、列表 127 行"——偶发、极难复现、用户会当成数据丢了。

**补丁（务实版，不追求"一次渲染一个事务"）**

文档 §5.1 的目标是"一次页面渲染只开一个事务"。**这个目标在当前 layout + page 结构下不可实现**，除非把事务藏在 AsyncLocalStorage 里跨组件传递——那是坏品味：事务会横跨整个渲染周期，长时间占着连接，而且任何一个 layout 抛出都会让事务悬挂。要放弃的是这个目标，不是这个收益。

改为：**一个渲染单元一个事务**，把同一渲染单元内的查询合并。

```ts
// lib/db/queries/lineage-graph.ts（新增）
export async function getLineageGraph(
  userId: string,
  orgId: string,
  projectId: string,
  lineageId: string
) {
  return withOrg(userId, async (tx) => {
    const lineage = await getLineageByIdTx(tx, orgId, lineageId);
    if (!lineage || lineage.projectId !== projectId) return null;
    const [nodes, folders] = await Promise.all([
      getNodesTx(tx, orgId, lineage.id),
      getFoldersTx(tx, orgId, projectId, 0),
    ]);
    return { lineage, nodes, folders };
  });
}
```

同理给 `getNavData(userId, orgId, projectId)` 合并 `getNavFolders` + `getNavLineages`（布局里这两个查询现在各开一个事务，且在同一快照里更合理）。

预期：7 → 4 事务，35 → 20 往返，@10ms 从 350ms 降到 200ms。

**验收**

- 在 `withOrg` 里 `addLogContext({ db_tx: true })` 计数，`lib/api.ts` 已经在记 `duration_ms`，把事务数一起打进日志；
- 集成测试加一条：并发写节点时读 `getLineageGraph`，断言 `lineage.nodeCount === nodes.length`（同快照）。

**成本**：新增 2 个 `*Tx` 变体 + 改 3 个页面，1 天。**不要**一次性改 40 处 `withOrg`。

---

### P0-3 全量加载 + 浏览器端搜索，而服务端索引在睡觉

**事实**

```ts
// lib/db/queries/nodes.ts:7-30  —— 没有 limit，没有世代上限
export async function getNodes(userId, orgId, lineageId): Promise<Node[]> {
  return withOrg(userId, (tx) => tx.select().from(nodes).where(and(
    eq(nodes.orgId, orgId), eq(nodes.lineageId, lineageId), isNull(nodes.deletedAt),
  )).orderBy(...));
}
```

而服务端搜索**已经写好了、索引也建好了、就是没人调用**：

```ts
// lib/db/queries/nodes.ts:33-56
export async function searchNodes(...)  // 用 ilike + pg_trgm
```

```sql
-- lib/db/migrations/0001_auth_rls.sql:551-552
CREATE INDEX idx_node_search ON node USING gin (full_name gin_trgm_ops);
```

`searchNodes` 的唯一调用方是 `tests/integration/nodes.test.ts:590`。生产代码里，画布搜索走的是 `matchLineagePerson`（`derived.ts:201-230`）——在浏览器里遍历全部节点、对 8 个字段做 `toLowerCase().includes()`。

**为什么这是 P0**

`FR-LIN-10` 的"按代加载"只约束**渲染**（`onlyRenderVisibleElements` + 5 世窗口），不约束**传输**。按每个节点约 300 字节序列化估算：1 万人丁约 3MB，10 万就是 30MB 的 RSC payload；浏览器还要为全部节点建 4 个 Map，并在每次 `setFlowNodes` 时做 diff。帧率崩的不是绘制，是 `buildLineageIndex` 和这份 diff。

而且这件事有个荒谬的地方：**已经付钱建的 GIN 索引、已经写好的查询函数，闲置着；同时让浏览器干数据库该干的活。**

**补丁（两步，先止血再优化）**

第一步，给读加上限并诚实告知：

```ts
export async function getNodes(
  userId: string, orgId: string, lineageId: string, limit = 5000
): Promise<{ nodes: Node[]; truncated: boolean }> {
  return withOrg(userId, async (tx) => {
    const rows = await tx.select().from(nodes).where(and(
      eq(nodes.orgId, orgId), eq(nodes.lineageId, lineageId), isNull(nodes.deletedAt),
    )).orderBy(asc(nodes.generation), asc(nodes.sort)).limit(limit + 1);
    return { nodes: rows.slice(0, limit), truncated: rows.length > limit };
  });
}
```

UI 在 `truncated` 时显示"本谱系超过 5000 人，画布仅显示前 5000 位；请用搜索定位"。**宁可显示一句真话，也不要静默渲染半棵树。**

第二步，把搜索接回服务端：

```ts
// app/api/lineages/[lineageId]/search/route.ts
export const GET = withApiLogging('lineage-search', async (request, { params }) => {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { q } = searchQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  // orgId 从谱系反查，不接受客户端传
  const rows = await searchNodes(user.id, orgId, lineageId, q, 20);
  return Response.json(rows.map(toNodeSearchHit));
});
```

前端 `handleLocate` 改成 `useQuery` + `keepPreviousData`，命中后 `requestFocus`。这样"搜索"和"加载"解耦：不需要把全图传给浏览器才能搜。

**验收**

- 集成测试：构造 5001 个节点，断言 `truncated === true` 且 `nodes.length === 5000`；
- `EXPLAIN ANALYZE` 断言 `searchNodes` 走 `idx_node_search`（`Bitmap Index Scan on idx_node_search`）；
- 手工：1 万人丁谱系首屏 payload < 4MB（约 300 字节/节点 × 1 万）。

**成本**：第一步半天，第二步 1 天（含 1 个新 Route Handler 和契约文档更新）。

---

### P0-4 树的不变量全在应用层，数据库一条 CHECK 都没有

**事实**

三条不变量，在 5 个写入口都成立，但没有任何东西强制它们：

| 不变量 | 在哪维护 | 数据库校验 |
|---|---|---|
| `generation = depth + 1` | `node-services.ts` 的 5 处 insert/update | 无 |
| `depth = nlevel(path) - 1`（血亲） | 同上 | 无 |
| 配偶 `path IS NULL` 且 `spouse_of_id NOT NULL` | `ck_node_spouse_has_no_path`（`schema.ts:368-371`） | **有** |

也就是说：三条里只有一条进了数据库，而且是**最不重要的那条**。

我核对了全部 5 个写入口，`generation = depth + 1` 今天确实处处成立：

- `createRootNodeInTransaction`：`depth: 0, generation: 1`（`:282-283`）
- `addChildInTransaction`：`parent.depth + 1` / `parent.generation + 1`（`:353-354`）
- `addSiblingInTransaction`：`sibling.depth` / `sibling.generation`（`:432-433`，兄弟同辈，成立）
- `addSpouseInTransaction`：`spouseOf.depth` / `spouseOf.generation`（`:503-504`）
- `moveNodeInTransaction`：两个 delta 同时作用于 path/depth/generation（`:756-767`），保持差值为 1

**正因为处处成立，才应该写进数据库。** 一条永远为真的 CHECK 成本是零，收益是把"第 6 个写入口忘了同步"从静默数据损坏变成 `23514`。

**补丁**

```sql
ALTER TABLE node ADD CONSTRAINT ck_node_generation CHECK (generation = depth + 1);
ALTER TABLE node ADD CONSTRAINT ck_node_depth
  CHECK (role = 'spouse' OR depth = nlevel(path) - 1);
```

第二条要豁免配偶（`path IS NULL`），这是 P0-4 和 §5.1 那个特例的交叉点——每加一条约束就要为配偶写一个 `OR`，这就是特例的成本在收利息。

**然后：`generation` 该删**

`generation` 恒等于 `depth + 1`，是纯派生列。存它带来三份成本：

1. `moveNode` 的批量 UPDATE 要多写一列（`:759-760`、`:776`、`:786-787`）；
2. 两个列可能漂移，且只有靠上面那条 CHECK 才能发现；
3. 每个读查询的 `orderBy(asc(nodes.generation))` 都在读一个可派生的值。

删列的收益是"少一列 = 少一类 bug + 少一次写放大"，没有功能损失。但**分两步走**：先加 CHECK 抓漂移，观察一个版本，再在独立迁移里删列（`depth + 1` 或 `nlevel(path)` 替代）。不要一个 PR 同时做两件事。

**`node_count` 同理，但先别动**

`lineages.node_count` 是冗余计数，由 `adjustNodeCount` 在 5 个写入口手工维护（`node-services.ts:167-180`）。它今天的正确性依赖"每个写入口都记得调"。这和 `generation` 是同一类问题，但删它的代价更大（列表页要 count，或者加触发器）。**先记录，等 P0-2 的单事务落地后，同一快照里 count 和 list 一致了，再评估是否改为查询时计算。**

**验收**

- 集成测试：直接 `UPDATE node SET depth = depth + 1`（绕过服务层），断言抛 `23514`；
- 迁移后跑 `pnpm test:integration`，全部 117 条现有用例必须仍然绿——它们就是"不变量今天成立"的证明。

**成本**：1 个迁移 + 2 条测试，2 小时。删 `generation` 是另一个迁移，半天。

---
## 4.5 一个真正的坏品味：配偶是节点

这一条不编号，因为**不建议现在改**。它记录的是一个"当年该做、现在改成本太高"的模型决策，以及它今天在收多少利息。

**事实**

`node` 表同时装两种东西：血亲（有 `path`，参与世系）和配偶（`path IS NULL`，不参与世系）。数据库用一条 CHECK 把两种形状焊在一起：

```sql
-- lib/db/schema.ts:368-371
CHECK (
  (role = 'spouse' AND path IS NULL AND spouse_of_id IS NOT NULL)
  OR (role = 'blood' AND path IS NOT NULL)
)
```

**这个特例的利息清单**

| 位置 | 为什么要写特例 |
|---|---|
| `node-services.ts:223` | 配偶 insert 时 `path: null`，但 `depth`/`generation` 要从血亲复制 |
| `node-services.ts:782-802` | `moveNode` 搬子树后，要单独再跑一条 UPDATE 把配偶的 `depth`/`generation` 跟上 |
| `node-services.ts:639-671` | `deleteNode` 要分两轮查：先按 `path <@` 找血亲子树，再按 `spouse_of_id IN` 找配偶 |
| `book-ltr.ts:28, 37` | 折叠时隐藏后代，配偶要单独加进 hidden 集合 |
| `book-ltr.ts:116, 174` | 布局时配偶不占世代列，只挂在血亲节点上 |
| `derived.ts:29-35, 113` | 索引要把配偶从 `blood` 里剔出去，单独建 `spousesByBlood` |
| `genealogy-canvas.tsx:306, 426` | 连线校验要拒绝配偶作为 source/target |
| `person-inspector.tsx:169-176, 376-407` | 检查器要为配偶换一套字段和文案 |
| `P0-4` 的两条 CHECK | 第二条要写 `role = 'spouse' OR ...`，因为配偶没有 path |

**正确的模型长什么样**

```
person（人）            —— 一个人的事实：姓名、生卒、行传
person_relation（关系） —— (from_person, to_person, kind, sort)
                          kind: parent | spouse | adoptive_parent
```

人是一个人，不是"血亲节点"或"配偶节点"。关系是边，不是节点上的一个 flag。这样：

- 一个人可以既是某人的配偶、又是另一支的血亲（现实中天天发生）；
- 兼祧/过继只是多一条 `adoptive_parent` 边；
- 不需要 `path IS NULL` 这个补丁，也不需要 29 处 `role` 分支。

**为什么现在不改**

1. 迁移成本：现有数据要把每个配偶节点转成 person + relation 两行，`path`/`depth`/`generation` 的语义要重新定义；
2. 画布、检查器、录入弹窗、世系表、打印视图全部消费 `NodeView.role`，一次改完是两周以上；
3. **最关键：M3 的谱书排版还没做。** 现在改，等于在还没有第二个消费者的时候先付一次全量迁移。

**该做什么**

- **现在**：在 `docs/data-model.md` 的 `node` 表一节明确写"配偶是节点"是**已接受的模型缺口**，并列出上面这张利息清单。让下一个想加"过继"的人知道他会撞上什么。
- **触发条件**：第一个客户提出过继/兼祧/入赘需求时，立即做 `person` + `person_relation` 拆分，**不要**在现有模型上打第三个补丁（比如再加一个 `role = 'adopted'`）。到那时，每多一个 `role` 值，29 处分支就多一轮。

> 这条是本文唯一一条"知道它不好、但建议不改"的。判断依据不是"改起来麻烦"，而是"改的收益要等 M3 才兑现，而 M3 的结构还没定"。**在消费者出现之前重构数据模型，是另一种形式的过度设计。**

---

## 5. P1 详述

### P1-5 鉴权 + 事务样板写了两遍，14 处调用

**事实**

同一个函数，逐字复制了两份：

```ts
// lib/lineage/services.ts:29-36
async function requireLineageWrite(tx: DbTransaction, userId: string, orgId: string) {
  const role = await getOrgRoleInTx(tx, userId, orgId);
  return Boolean(role && hasPermission(role, 'lineage.write'));
}

// lib/lineage/node-services.ts:74-81  —— 完全相同
async function requireLineageWrite(tx: DbTransaction, userId: string, orgId: string) {
  const role = await getOrgRoleInTx(tx, userId, orgId);
  return Boolean(role && hasPermission(role, 'lineage.write'));
}
```

`folder/services.ts:27-34` 是第三份，只换了权限字符串。`db/services.ts` 是第四份，同样的三行在 `:45`、`:104`、`:157` 各内联了一遍。

每个 mutation 的骨架都是同一个五步：

```ts
return withOrg(userId, async (tx) => {
  if (!(await requireXWrite(tx, userId, orgId))) return { ok: false, reason: 'forbidden' };
  const lineage = await loadLineageForUpdate(tx, orgId, lineageId);
  if (!lineage) return { ok: false, reason: 'not_found' };
  // ...真正的业务
});
```

`node-services.ts` 里这 5 行重复了 **8 次**（`:250`、`:329`、`:401`、`:478`、`:552`、`:622`、`:704`、`:824`）。

**为什么修**

不是因为"不 DRY 不好看"，是因为**权限检查被复制的地方，就是权限会被漏掉的地方**。今天要加第五个角色、或者要把 `lineage.write` 拆成 `lineage.write` / `lineage.delete`，你得改 14 处，漏一处就是越权。

**补丁**

```ts
// lib/auth/guarded-transaction.ts（新增）
export type GuardFailure = 'forbidden' | 'not_found';

export async function withOrgWrite<T>(
  params: { userId: string; orgId: string; permission: OrgPermission },
  fn: (tx: DbTransaction) => Promise<T>
): Promise<T | { ok: false; reason: 'forbidden' }> {
  return withOrg(params.userId, async (tx) => {
    const role = await getOrgRoleInTx(tx, params.userId, params.orgId);
    if (!role || !hasPermission(role, params.permission)) {
      return { ok: false, reason: 'forbidden' as const };
    }
    return fn(tx);
  });
}

/** 谱系级写操作的公共前奏：权限 + 行锁。 */
export async function withLineageWrite<T>(
  params: { userId: string; orgId: string; lineageId: string },
  fn: (tx: DbTransaction, lineage: Lineage) => Promise<T>
) {
  return withOrgWrite({ ...params, permission: 'lineage.write' }, async (tx) => {
    const lineage = await loadLineageForUpdate(tx, params.orgId, params.lineageId);
    if (!lineage) return { ok: false, reason: 'not_found' as const };
    return fn(tx, lineage);
  });
}
```

`node-services.ts` 的 8 个函数各减 5 行，`lineage/services.ts` 减 10 行，`folder/services.ts` 减 8 行。

**验收**：`pnpm test:integration` 全绿（现有 117 条已覆盖越权路径）；全仓 `getOrgRoleInTx` 出现 12 处（含定义与 import），收敛后应只剩定义 + `getOrgRole` + 新的 `withOrgWrite` 三处。

**成本**：半天。纯机械重构，测试是现成的安全网。

---

### P1-6 `buildLineageIndex` 一次渲染算四遍

**事实**

```
components/lineage/canvas/genealogy-canvas.tsx:133   const index = useMemo(() => buildLineageIndex(nodes), [nodes]);
components/lineage/lineage-detail.tsx:367            const index = useMemo(() => buildLineageIndex(nodes), [nodes]);
components/lineage/person-inspector.tsx:80           const index = useMemo(() => buildLineageIndex(nodes), [nodes]);
components/lineage/node-create-dialog.tsx:108        const index = useMemo(() => buildLineageIndex(nodes), [nodes]);
```

四次 `useMemo` 的依赖都是同一个 `nodes` 数组，但这四个组件是**兄弟/嵌套关系**，各自的 memo 缓存不共享。打开检查器 + 打开录入弹窗时，同一份 21 字段的节点数组被遍历四遍、建四套 Map、算四遍 `descendantCounts`。

`buildLineageIndex` 里最贵的是 `countDescendants`（`derived.ts:68-88`），它是递归 + memo，对 1 万节点是 O(n) 但要跑满四次。

更糟的是 `subtreeIds`（`lineage-detail.tsx:87-116`）：客户端为"确认删除对话框显示几个人"遍历整棵树，而服务端 `deleteNodeInTransaction`（`node-services.ts:637-672`）用 ltree 查询做同一件事。**两套实现，一套对，一套可能不对**——客户端那套没考虑软删之外的边界情况（比如跨谱系的脏数据）。

**补丁**

在 `LineageDetail` 里算一次，往下传：

```ts
// lineage-detail.tsx
const index = useMemo(() => buildLineageIndex(nodes), [nodes]);
<GenealogyCanvas index={index} ... />
<PersonInspector index={index} ... />
<NodeCreateDialog index={index} ... />
```

`subtreeIds` 的删除计数改成向服务端要：删除对话框打开时调一个轻量接口，或者干脆**不显示精确人数**，改成"该人丁及其全部子孙会被归档"——`deleteNodeAction` 的返回值已经带了 `deletedNodes`，删完再告诉用户删了几个，比删前猜一个数更诚实。

**验收**：`tests/lineage-canvas-layout.test.ts` 现有 563 行测试覆盖 `buildLineageIndex`，传参改动后必须全绿。

**成本**：半天。

---

### P1-7 DTO 手抄，`FolderOption` 定义了三次

**事实**

```ts
// app/(dashboard)/.../lineages/[lineageId]/page.tsx:44-65
nodes={nodes.map((node) => ({
  id: node.id, parentId: node.parentId, spouseOfId: node.spouseOfId,
  role: node.role, depth: node.depth, generation: node.generation,
  sort: node.sort, name: node.name, surname: node.surname,
  fullName: node.fullName, sex: node.sex, courtesy: node.courtesy,
  namePrefix: node.namePrefix, isAlive: node.isAlive,
  birthText: node.birthText, deathText: node.deathText,
  birthYear: node.birthYear, deathYear: node.deathYear,
  burialPlace: node.burialPlace, biography: node.biography,
}))}
```

21 个字段，手抄。`NodeView`（`components/lineage/types.ts`）和 `Node`（schema 的 `$inferSelect`）唯一的差别就是"多了 `orgId`/`lineageId`/`createdBy`/`attributes`/`createdAt`/`updatedAt`/`deletedAt`"——**这是安全问题，不是风格问题**：手抄是唯一的防线，而防线靠"记得删字段"维持。

同一类问题：`FolderOption` 在三处定义（`lineage-detail.tsx:69`、`lineage-edit-dialog.tsx:27`、`create-lineage-dialog.tsx:20`），字段完全一样。

**补丁**

```ts
// components/lineage/types.ts
import type { Node } from '@/lib/db/schema';

/** 显式列出可下发的字段；新增 schema 列不会自动泄露。 */
export const NODE_VIEW_FIELDS = [
  'id','parentId','spouseOfId','role','depth','generation','sort',
  'name','surname','fullName','sex','courtesy','namePrefix','isAlive',
  'birthText','deathText','birthYear','deathYear','burialPlace','biography',
] as const satisfies readonly (keyof Node)[];

export type NodeView = Pick<Node, (typeof NODE_VIEW_FIELDS)[number]>;

export function toNodeView(node: Node): NodeView {
  const view = {} as NodeView;
  for (const key of NODE_VIEW_FIELDS) (view as Record<string, unknown>)[key] = node[key];
  return view;
}
```

`FolderOption` 提一份到 `components/lineage/types.ts`。

**验收**：加一条单测，断言 `Object.keys(toNodeView(row))` 恰好等于 `NODE_VIEW_FIELDS`，且不含 `orgId`/`lineageId`/`createdBy`。

**成本**：2 小时。

---

### P1-8 三套失效机制，15/16 的 `revalidatePath` 炸整棵树

**事实**

一次写操作后，代码可能同时触发：

1. 服务端 `revalidatePath('/dashboard', 'layout')`（16 处调用里 15 处是这个）；
2. 客户端 `router.refresh()`（`lineage-detail.tsx:449, 476, 488`、`person-inspector.tsx:150`、`lineage-sidebar.tsx:165, 207, 239, 266`、`node-move-dialog.tsx:91` 等，全仓共 14 处）；
3. 客户端 `invalidateQueries`（`project-settings-panel.tsx:66`、`create-project-dialog.tsx:105`、`org-settings-panel.tsx:47, 57`、`accept-invite-panel.tsx:36`、`create-org-dialog.tsx:37`，全仓共 6 处）。

三者语义重叠、触发条件不同，结果是：**改一个人丁的姓名，整个 dashboard 路由树的服务端缓存被清空，然后客户端再拉一次 RSC，再失效一次 TanStack 缓存。** 一次击键保存，打三次。

`revalidatePath('/dashboard', 'layout')` 的含义是"让 `/dashboard` 下所有 layout 及其子页面失效"。对谱系保存来说，这个范围是 100 倍以上。

**补丁（分两步，先收窄再统一）**

第一步，把 15 处全树失效收窄到实际受影响的路径。谱系详情页的失效只需要：

```ts
// lib/lineage/actions.ts
function revalidateLineage(projectRef: string, lineageId: string) {
  revalidatePath(`/dashboard/project/${projectRef}/lineages/${lineageId}`);
  revalidatePath(`/dashboard/project/${projectRef}/lineages`);  // 侧栏 nodeCount 变了
}
```

这需要 Action 拿到 `projectRef`。目前 `revalidateProject()` 什么都不拿（`actions.ts:56-58`）——因为 Action 只知道 UUID，不知道 ref。**这就是 P0-2 之外的另一个"上下文没有往下传"的症状**：`requireProjectContext` 解析出的 `project.ref` 在页面层就丢了，Action 只能退化成"炸整棵树"。

所以正确顺序是：先让 Action 的入参带上 `projectRef`（或让 `validatedActionWithUser` 把 scope 一起传下来），再收窄失效范围。

第二步，明确分工并写进 `AGENTS.md`：

| 层 | 机制 | 什么时候用 |
|---|---|---|
| 服务端缓存 | `revalidatePath(具体路径)` | 写操作后，只失效受影响的页面 |
| 客户端 RSC 数据 | `router.refresh()` | **仅在**页面数据直接来自 RSC props（不走 TanStack）时 |
| 客户端 TanStack | `invalidateQueries(queryKeys.x)` | 页面数据走 `useQuery` 时 |

一个写操作**最多触发其中两个**，不允许三个都上。

**验收**：加一条测试，遍历 `lib/*/actions.ts` 断言不出现 `revalidatePath('/dashboard', 'layout')`（用 AST 或简单正则，见 P1-12 的 fitness function）。

**成本**：1 天（含给 Action 补 `projectRef` 的机械改动）。

---

### P1-9 根布局为所有路由查库，营销页永远动态

**事实**

```ts
// app/layout.tsx:28-43
const user = await getSessionUser();                       // 读 headers() → 动态
const orgs = user ? await getOrgsForUser(user.id) : [];     // withOrg → 1 个事务
queryClient.setQueryData(queryKeys.user, sessionUser);
queryClient.setQueryData(queryKeys.orgs, orgFallback);
```

`getSessionUser()` 内部 `await headers()`，所以**根布局永远是动态渲染**，`/`（营销页）也跟着动态。每次访问首页：1 次数据库会话查询 + 可能的组织查询 + 完整 React 渲染，CDN 完全用不上。

而营销页（`app/(marketing)/page.tsx:26`）自己也调了一次 `getSessionUser()`——虽然有 `cache()` 去重，但它把这个页面钉死在了动态渲染上。

`queryKeys.user` / `queryKeys.orgs` 的消费方只有控制台的导航栏和组织选择器。营销页不需要它们。

**补丁**

把控制台专用的 hydration 从根布局下沉到 `(dashboard)` 布局：

```tsx
// app/layout.tsx —— 只留 theme / font / QueryProvider，无 DB 访问
export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" ...>
      <body><ThemeProvider><QueryProvider>{children}</QueryProvider></ThemeProvider></body>
    </html>
  );
}

// app/(dashboard)/layout.tsx（新增）
export default async function DashboardLayout({ children }) {
  const user = await requireUser();
  const orgs = await getOrgsForUser(user.id);
  // ...dehydrate 注入
}
```

营销页把 `getSessionUser()` 换成客户端读 `useSessionUser()`，页面本身变成静态，登录态由客户端补。

**验收**：`pnpm build` 输出中 `/` 标记为 `○ (Static)` 而不是 `ƒ (Dynamic)`；首屏 LCP 不退化。

**成本**：半天。**注意**：这会让营销页出现极短的"未登录"闪烁，需要接受（或用一个 CSS-only 的登录态占位）。

---

### P1-10 活动日志两套写入策略

**事实**

```ts
// lib/db/queries/activity.ts:24-37  —— 业务事务内写
export async function logActivityInTx(tx, userId, orgId, type, ipAddress) {
  await tx.insert(activityLogs).values({ ... });
}
```

`node-services.ts` 的每个 mutation 都在事务里调它（`:303`、`:374`、`:453`、`:515`、`:601`、`:681`、`:809`）。日志写失败 → 业务回滚。

```ts
// lib/org/actions.ts:45-56  —— 提交后写，失败吞掉
async function logOrgActivity(...) {
  try { await logActivity(...); }
  catch (error) { logger.warn('failed to write activity log', { type, userId, error }); }
}
```

同一个系统，两种语义。哪一种对？

**日志失败不该回滚业务**——这是行业共识，因为日志是观测手段，不是业务事实。但如果日志必须与业务同生共死（比如它是审计），那就该走数据库触发器，而不是应用代码。

现在的代码两种都不是：谱系操作是"日志失败业务回滚"（把观测变成了业务约束），组织操作是"日志失败静默"（把审计变成了尽力而为）。`activity_logs` 的注释说它是"产品活动流，不是审计日志"（`schema.ts:496-499`），所以正确语义是后者。

**补丁**

统一为提交后写入。最省事的做法是让 `logActivityInTx` 收集、`withOrg` 提交后统一 flush：

```ts
// lib/db/drizzle.ts
const pendingLogs = new WeakMap<object, Array<() => Promise<void>>>();

export async function withOrg<T>(userId, fn) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local role app_rw`);
    await tx.execute(sql`select set_config(...)`);
    const logs: Array<() => Promise<void>> = [];
    pendingLogs.set(tx, logs);
    const result = await fn(tx);
    pendingLogs.delete(tx);
    // 事务已提交，这里失败只记 warn
    for (const write of logs) { try { await write(); } catch (e) { logger.warn('activity log failed', e); } }
    return result;
  });
}
```

**验收**：集成测试模拟日志表写入失败（临时 REVOKE INSERT），断言业务仍然提交成功。

**成本**：半天。**这是低优先级里性价比最高的一条**，因为现在"日志表满/权限错"会直接让用户无法编辑人丁。

---

### P1-11 没有 `statement_timeout`

**事实**

全仓 `grep` 无 `statement_timeout`、`idle_in_transaction_session_timeout`、`lock_timeout`。

**为什么这比它看起来重要**

1–3 人团队、无 DBA、连接池 `max: 5`（`drizzle.ts:31`）。一条退化的查询——比如某个谱系被误操作成 20 万节点后执行 `moveNodeInTransaction` 的子树重写（`:756-767`，一条 UPDATE 扫整个子树）——就能占满 5 个连接，整个实例不可用。而 Vercel 函数的超时是 60s，数据库没有超时，连接会一直挂着。

**补丁**

```sql
-- 新增迁移 0006_statement_timeouts.sql
ALTER ROLE app_rw SET statement_timeout = '10s';
ALTER ROLE app_rw SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_rw SET lock_timeout = '5s';
ALTER ROLE auth_service SET statement_timeout = '10s';
ALTER ROLE auth_service SET idle_in_transaction_session_timeout = '30s';
```

注意：`ALTER ROLE ... SET` 在迁移里执行需要迁移角色有权限（本地超级用户 / Neon owner 都有）。如果 CI 里角色是后建的（`.github/workflows/ci.yml:57-71` 在迁移**之后**建 `app`/`auth_runtime`），那么对 `app_rw`/`auth_service` 设置是安全的，因为它们由迁移创建。

**验收**：`verify:deploy` 加一条断言：

```sql
SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('app_rw','auth_service');
-- 期望 rolconfig 含 statement_timeout=10s
```

**成本**：5 分钟。这是全套建议里性价比最高的一条。

---

### P1-12 架构约束零执行

**事实**

`biome.json` 没有 `noRestrictedImports`，没有任何 `overrides` 限制目录间依赖。文档自己承认：

```md
<!-- docs/architecture/07-quality.md:57-64 -->
| F1 | `service.ts` 不得 import `next/*` | Biome `noRestrictedImports` | 未配置 |
| F2 | 只有 repo 层能 import `src/server/db` | Biome `noRestrictedImports` | 未配置 |
| F5 | 新增表不得使用裸子查询式 RLS 策略 | 查 `pg_policies.qual` | 未配置 |
| F6 | 单文件 ≤ 400 行 | Biome 规则 / 脚本统计 | 未配置 |
| F7 | 代码中不出现 `process.env`（除 `lib/config.ts`） | grep / Biome | 未配置 |
```

八条里两条有（F3 查 RLS 已开、F8 迁移漂移），六条没有。

**要配的四条（对应本仓库真实存在过的病，不是通用最佳实践）**

```jsonc
// biome.json
"overrides": [
  {
    // 客户端组件不得直接碰数据库（server-only 是运行时兜底，lint 报错更早）
    "includes": ["components/**/*.tsx", "hooks/**/*.ts"],
    "linter": { "rules": { "nursery": { "noRestrictedImports": {
      "level": "error",
      "options": { "paths": { "@/lib/db/drizzle": "客户端组件不得访问数据库", "@/lib/db/auth-db": "认证连接只属于 server" } }
    }}}}
  },
  {
    // queries 不得反向依赖 actions
    "includes": ["lib/db/queries/**/*.ts"],
    "linter": { "rules": { "nursery": { "noRestrictedImports": {
      "level": "error",
      "options": { "patterns": [{ "group": ["@/lib/*/actions"], "message": "查询层不得依赖 Action 层" }] }
    }}}}
  }
]
```

F6（单文件 ≤400 行）用一个 10 行的脚本，别用 lint：

```js
// scripts/check-file-size.mjs
const LIMIT = 400;
const ALLOW = new Set(['lib/lineage/node-services.ts']);  // 现有超标的先登记，只降不升
```

F5（RLS 策略断言）加进 `verify:deploy`：

```sql
SELECT schemaname, tablename, policyname FROM pg_policies
WHERE qual LIKE '%organization_member%' AND qual NOT LIKE '%has_org_role%';
-- 期望 0 行
```

**关键不是配几条规则，是承认"没有执行的约束等于不存在"。** 现在 `docs/architecture/03-components.md` 里那四条规则（`service.ts` 不得 import `next/*` 等）全部是愿望——因为对应的文件根本不存在（没有 `service.ts`，没有 `src/server/db`）。先配能配的，把配不了的从文档里删掉。

**成本**：半天。

---
## 6. 做减法

"优化"里最有效的一类动作是删除。以下六项，删掉的收益都大于保留。

| # | 删什么 | 位置 | 省下什么 |
|---|---|---|---|
| 1 | `searchNodes` / `countNodes` / `getNodeById` / `getFolderById` | `lib/db/queries/{nodes,folders}.ts` | 四个函数只有测试调用。要么接线（P0-3 的第二步），要么删掉测试和函数。**留着不用比没有更糟**：它让人以为搜索已经实现了 |
| 2 | `reorderSiblingsAction` | `lib/lineage/actions.ts:398-416` | 无 UI 调用方（`grep` 只在 `node-create-dialog.tsx:118` 有 `addPersonAction`，没有排序）。如果排序是计划中的功能，标注 TODO；如果不是，删 |
| 3 | `node.mother_id` | `schema.ts:326-328` | 全仓零写入。母系关系是 M2+ 的事，现在留一列不用，只会让人以为它有意义 |
| 4 | `lineage.hang_rule` / `node.attributes` | `schema.ts:294, 350` | 都是 jsonb 逃生舱，零写入、零读取、零 UI。`attributes` 是"人丁自定义字段"的预留，`FR-LIN-6` 明确未实现。**等实现时再加列**，加 jsonb 是 1 行 DDL |
| 5 | `book_catalog.parent_id ON DELETE CASCADE` | `schema.ts:455-457` | `app_rw` 没有 DELETE 授权（`0003:223-233` 只给 SELECT/INSERT/UPDATE），级联永远不会触发。这是死配置，而且误导人以为删父项会带走子树——实际是软删父项留下孤儿子树 |
| 6 | `db` Proxy 的三次 `getDb()` | `drizzle.ts:51-56` | 每次属性访问调 3 次；`typeof value === 'function'` 每次都要 `Reflect.get` 两次。改成在模块加载时构造一次代理目标即可 |

另外两条"不该删但要收"：

- `lib/db/services.ts` 是 project 域的三个函数，应该叫 `lib/project/services.ts`。改名是纯机械的，但它让"`lib/db` 是基础设施"这个心智模型成立。同理 `lib/auth/schemas.ts` 里塞了 `createProjectSchema`（`:170`）。
- `components/lineage/derived.ts` 里 `MALE_RANKS` / `FEMALE_RANKS` 和 `node-create-dialog.tsx:25-26` 是同一份数据的两份拷贝。放进 `derived.ts` 导出，弹窗引用。

---

## 7. 文档反向漂移

不是"代码落后于文档"，是**文档写了一个更差的目标，而代码落地时做对了，文档没回写**。五处。

### D-22（P0）`data-model.md` §12.5 的 RLS 模板会让 M2 重新引入越权

```sql
-- docs/data-model.md:850-869  —— 文档模板
CREATE POLICY organization_isolation ON %I
  AS PERMISSIVE FOR ALL TO app_rw
  USING (organization_id IN (
    SELECT organization_id FROM organization_member WHERE user_id = auth.uid()))
```

```sql
-- lib/db/migrations/0001_auth_rls.sql:490-515  —— 实际实现
CREATE POLICY %I ON %I AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner','admin','editor','viewer']));
CREATE POLICY %I ON %I AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner','admin','editor']));
CREATE POLICY %I ON %I AS PERMISSIVE FOR UPDATE TO app_rw
  USING (...) WITH CHECK (...);
```

两个致命差异：

1. **模板漏了 `deleted_at IS NULL`。** 照抄它 → 被移除的成员（软删的成员行）仍然通过 RLS 检查。`FR-ORG-6`「移除后立即失去访问权」在第三层防护上是破的。
2. **模板用 `FOR ALL` + 单一角色集**，无法表达"读含 viewer、写排除 viewer"。照抄它 → viewer 能写。

M2 要新增 4 张表（`share_link` / `delete_batch` / `resource_lock` / `media`），届时最自然的动作就是"照 §12.5 的模板来"。**这等于把已经修好的坑重新挖一遍。**

**改法**：把 §12.3/§12.5 整段替换成与迁移一致的文本，并加一句"新增表的策略必须复制 `0001_auth_rls.sql:490-515` 的 DO 块，不要手写"。配 F5 断言（P1-12）。

> 顺带说：`docs/guides/add-a-feature.md:78-96` 里的模板是**对的**（用了 `has_org_role` 和三策略拆分）。同一份仓库里有两份互相矛盾的 RLS 模板，一份对一份错——这比两份都错更危险，因为你不知道哪份会被抄走。

### D-23（P1）断链

`docs/guides/add-a-feature.md:191` 写 `docs/status/implementation-status.md`，实际路径是 `docs/implementation-status.md`。目录 `docs/status/` 不存在。

### D-24（P1）测试数字三方不一致

| 来源 | 单测 | 集成 | E2E |
|---|---|---|---|
| `docs/README.md:107` | 13 文件 / 73 用例 | 12 文件 / 134 用例 | 1 条 |
| `docs/implementation-status.md:36` | 18 文件 / 133 用例 | 11 文件 / 117 用例 | 2 条 |
| `AGENTS.md` §1 | 18 文件 / 133 用例 | 11 文件 / 117 用例 | 2 条 |
| **实际（本次统计）** | **18 文件** | **11 文件** | **1 个 spec 文件 / 2 条** |

README 是过期的那份，而且它是 `docs/` 的入口。**入口文档的数字错了，读者会先怀疑全部内容。**

### D-25（P2）「Route Handler 1 个」和 `src/modules`

`docs/architecture/03-components.md:133` 写「Route Handler | 健康检查 + 只读刷新端点 | 目标 1 个 / 当前 4 个」——把"1 个"当目标。这与 §2 保护线第 8 条冲突，应该改成「保留 4 个，按需增加」。同文件 §4.1 仍以 `src/modules/` 描述模块划分，而 §4.4 已经承认"待决策"。目标文档不该同时存在两种说法。

### D-26（P2）「一次渲染一个事务」不可实现

`docs/architecture/04-runtime.md:26-35` 写「一次页面渲染只开一个事务」，理由（往返数、跨快照）都对，但目标在 Next 的 layout/page 独立渲染结构下不可实现——除非用 AsyncLocalStorage 隐藏事务（坏品味，见 P0-2）。

这不是"还没做"，是**目标本身错了**。应改成「一个渲染单元一个事务」，并给出 §4 P0-2 的可度量口径（事务数进日志）。

> 给文档加一条硬规则：**任何"目标与实现不一致"的条目，要么在 `implementation-status.md` 登记为差异，要么改目标。不允许两边都留着。** 现在 `implementation-status.md` 做得很好（诚实、可验证），问题在于目标文档没有回写。

---

## 8. 补丁序列

按"单位时间消除的风险"排序。前四项合计约 1 天，全部十项约 5–6 人日。

| # | Commit | 改动 | 验收 | 工作量 |
|---|---|---|---|---|
| 1 | `fix(db): 设置语句与锁超时` | 新迁移 0006；`verify:deploy` 断言 | `pg_roles.rolconfig` 含三项 | 5 分钟 |
| 2 | `docs(data-model): RLS 模板对齐 has_org_role` | `data-model.md` §12.5；F5 断言进 `verify:deploy` | `pg_policies` 查询 0 行 | 2 小时 |
| 3 | `feat(db): 节点边加复合外键` | 迁移 0007；2 条集成测试 | 跨谱系父节点抛 `23503` | 半天 |
| 4 | `feat(db): 树不变量 CHECK` | 迁移 0008；2 条集成测试 | 手工 UPDATE 抛 `23514` | 2 小时 |
| 5 | `refactor(lineage): 收敛写事务样板` | 新增 `withOrgWrite`/`withLineageWrite`；改 3 个 service 文件（`lineage/services.ts`、`lineage/node-services.ts`、`folder/services.ts`） | `test:integration` 117 条全绿 | 半天 |
| 6 | `perf(read): 合并同渲染单元查询` | 新增 `getLineageGraph`/`getNavData`；改 3 个页面 | 事务数日志从 7 降到 4 | 1 天 |
| 7 | `feat(read): 谱系读加上限 + 服务端搜索` | `getNodes` 返回 `truncated`；新 Route Handler；前端接线 | 5001 节点测试；`EXPLAIN` 走 GIN | 1.5 天 |
| 8 | `refactor(lineage): 索引与 DTO 收成一处` | `NODE_VIEW_FIELDS`/`toNodeView`；`index` 下传；`FolderOption` 合一 | 单测断言字段集 | 半天 |
| 9 | `fix(ui): 收窄缓存失效范围` | Action 补 `projectRef`；15 处 `revalidatePath` 改精确路径 | 新增 lint 断言 | 1 天 |
| 10 | `chore(arch): 配 4 条 fitness function` | `biome.json` overrides；`scripts/check-file-size.mjs` | `pnpm check` 能拦住违规 | 半天 |

**顺序理由**：

- 1、2 先做，因为它们改的是"防线本身"，越早越好，成本几乎为零；
- 3、4 是纯 DDL，现有数据一定满足（应用层一直在校验），风险最低，但收益最大；
- 5 是 6、8 的前置（收敛了样板，后面的改动才不用重复 14 次）；
- 7 依赖 6（搜索接口和窗口读共用事务边界）；
- 9 依赖 6（Action 要拿到 `projectRef` 才能收窄）；
- 10 最后做，因为它要给已有代码开豁免清单。

**不要合并的**：3 和 4（加约束 vs 删列，回滚粒度不同）；6 和 9（服务端读 vs 缓存失效，出问题时定位不同）。

---

## 9. 未验证的假设

本文所有"往返数""事务数"都是从代码结构数出来的，**不是测出来的**。以下四项必须在 staging 上量，再决定是否继续优化：

| 假设 | 怎么验 | 如果不成立 |
|---|---|---|
| Neon 同区域 RTT ≈5–10ms | 在 `withOrg` 里打点，看单事务耗时 | RTT 更低 → P0-2 的收益变小，可以降级为 P2 |
| 详情页 7 个事务 | 同上，`addLogContext({ db_tx })` 计数 | 数字不同 → 重新核算，但方向不变 |
| 真实谱系规模 < 5000 节点 | 问用户 / 看 `lineage.node_count` 分布 | 都小于 1000 → P0-3 可以只保留 `truncated` 提示，不做服务端搜索 |
| 限流有效 | 压测 10 次登录失败 | 已自认是 best-effort，不是安全边界，不需要验 |

**先量再优化。** 本文的 P0 是按"结构上必然成立"排的（往返数、缺失的约束、闲置的索引），不是按"猜的性能数字"排的。

---

## 附录 A：谱系详情页往返预算

| 步骤 | 现状事务 | 现状往返 | 合并后事务 | 合并后往返 |
|---|---:|---:|---:|---:|
| 根布局 `getOrgsForUser` | 1 | 5 | 1 | 5 |
| 项目布局 scope | 1 | 5 | 1（与下合并） | 5 |
| 项目布局 `getProjects` | 1 | 5 | — | — |
| 谱系布局 `getNavFolders` | 1 | 5 | 1（两者合并） | 5 |
| 谱系布局 `getNavLineages` | 1 | 5 | — | — |
| 详情页 `getLineageById` | 1 | 5 | 1（三者合并） | 5 |
| 详情页 `getNodes` | 1 | 5 | — | — |
| 详情页 `getNavFolders`（cache 命中） | 0 | 0 | — | — |
| **合计** | **7** | **35** | **4** | **20** |

@10ms RTT：350ms → 200ms。@20ms：700ms → 400ms。

---

## 附录 B：死代码与闲置资源清单

| 符号 / 资源 | 定义 | 生产调用方 | 处置 |
|---|---|---|---|
| `searchNodes` | `lib/db/queries/nodes.ts:33` | 无（仅 `tests/integration/nodes.test.ts:590`） | 接线（P0-3 第二步） |
| `countNodes` | `lib/db/queries/nodes.ts:81` | 无（仅 `tests/integration/queries.test.ts:238`） | 接线或删 |
| `getNodeById` | `lib/db/queries/nodes.ts:58` | 无（仅测试） | 删 |
| `getFolderById` | `lib/db/queries/folders.ts:29` | 无（仅测试） | 删 |
| `reorderSiblingsAction` | `lib/lineage/actions.ts:398` | 无 | 删或标 TODO |
| `node.mother_id` | `schema.ts:326` | 无写入 | 删列 |
| `lineage.hang_rule` | `schema.ts:294` | 无读写 | 删列 |
| `node.attributes` | `schema.ts:350` | 无读写 | 删列 |
| `idx_node_search` | `0001_auth_rls.sql:551` | 索引本身没有调用方 | **保留**，等 P0-3 接线；现在删了以后还得重建 |
| `idx_article_search` | `0001_auth_rls.sql:554` | 谱文未实现 | 保留，M2 会用到 |
| `book_catalog` 级联 | `schema.ts:455` | 永远不触发（无 DELETE 授权） | 删 `ON DELETE CASCADE`，改 `RESTRICT` 或去掉 |
| `rankLabel` 配偶分支 | `derived.ts:113-115` | `sex === 1 ? '配' : '配'` 恒为 `'配'` | 简化为 `return '配'` |
| `MALE_RANKS`/`FEMALE_RANKS` 第二份 | `node-create-dialog.tsx:25-26` | 与 `derived.ts:109-110` 重复 | 从 `derived.ts` 导出 |
| `FolderOption` 第二、三份 | `lineage-edit-dialog.tsx:27`、`create-lineage-dialog.tsx:20` | 与 `lineage-detail.tsx:69` 重复 | 合一 |

---

## 附录 C：三种树，三种建模

同一个"树"的概念，在 schema 里有三种写法。这不是"不一致所以错"，而是**三种写法各自漏了不同的东西**，说明当初没有统一想过树的边该怎么约束。

| 树 | 父引用 | 外键 | 深度 | 排序 | 漏了什么 |
|---|---|---|---|---|---|
| `folder` | `parent_id` | **无** | 应用层 `folderDepth()` 递归算（`folder/services.ts:75-89`） | `sort` | 父节点可以是任意 UUID；跨 project 的父节点在 DB 层合法 |
| `node` | `parent_id` | `node(id)`，无谱系维度 | 冗余 `depth` 列 | `sort`（每父独立） | 跨谱系父节点合法（P0-1） |
| `book_catalog` | `parent_id` | `book_catalog(id) ON DELETE CASCADE` | 无 | `sort` | 级联永不触发；跨 book 父节点合法 |

`docs/decisions/0003-tree-storage-ltree.md` 只讨论了 `node` 用 ltree 的决定，没有讨论另外两棵树为什么不用 ltree。**`folder` 其实更适合 ltree**（三级上限、需要子树删除、需要祖先查询），而它现在用应用层递归算深度——`folder/services.ts` 里那段 `folderDepth` 的 while 循环和 `deleteFolder` 里的 BFS 都是 ltree 一行能解决的事。

不是要现在改，是记录：**如果 M2 要给谱文/谱书分类做拖拽移动，`folder` 那套应用层递归会立刻变成 bug 源**（移动子树要重算所有后代的深度，而深度根本没存）。

---

## 附录 D：本文与 2026-10-22 评审的关系

前一份评审（[`2026-10-22-architecture-review.md`](./2026-10-22-architecture-review.md)）提了 20 条，本文不重复，只标状态：

| 前次编号 | 结论 | 现状（2026-10-24） |
|---|---|---|
| P0-1 全量加载 | 成立 | **未修**，本文升级为 P0-3 并给出两步补丁 |
| P0-2 每查询一事务 | 成立 | **未修**，本文修正了目标（"一个渲染单元"而非"一次渲染"） |
| P0-3 世系表跨房支排序 | 成立 | **未修**。本文未展开，因为它属于领域规则而非架构；建议单独立项 |
| P0-4 写操作无幂等 | 成立 | **未修**。本文未展开，理由同上 |
| P0-5 RLS 模板 | 成立 | **未修**，本文 D-22 重述并给出 CI 断言 |
| P1-9 `statement_timeout` | 成立 | **未修**，本文 P1-11 |
| P1-11 `getSessionUser` 泄哈希 | **已修** | `getSessionUser` 只返回 `SessionUser` |
| P1-7 `src/modules` 脱节 | 部分 | 文档已承认"待决策"，但 §4.1 正文未改（D-25） |

本文新增的、前次没有的：**P0-1（边无复合外键）、P0-4（不变量无 CHECK）、P1-5/6/7（重复实现）、P1-10（日志两套语义）、§6 减法清单、附录 C（三种树）**。
