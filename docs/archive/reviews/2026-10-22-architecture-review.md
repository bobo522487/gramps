# 目标架构评审与优化建议

> **评审对象**：PRD 1.4 · 架构 1.6 · 数据模型 1.5 · 接口 1.6 · 实现状态 2.0 · ADR-0001
> **评审日期**：2026-10-22
> **评审基线**：迁移 `0000_baseline` / `0001_auth_rls` / `0002_app_role_grant` 与 `lib/**` 实际源码
> **评审尺子**：只问一件事——文档自己写下的判据（G1–G6、FR 验收标准、TTFB < 400ms、三层防护）在规模上来之后还成不成立。不评价审美。

---

## 0. 结论

**架构方向成立，但有 5 个问题会让文档自己的判据失效，且其中 3 个是"文档错了、代码没错"。**

1. **隔离与数据完整性是全套设计最强的部分。** RLS 自引用递归的解法（`auth.has_org_role`）、复合外键、部分唯一索引、触发器建默认组织——这几处是真正想清楚了，M2 不要动。
2. **读路径是最大的结构性风险。** 全量加载谱系图与"单组织 50 万人丁"容量目标直接冲突；"每查询一个事务"让首屏往返次数比必要值多 4 倍，TTFB 预算在 Neon 上大概率守不住。
3. **文档与代码之间有三处反向漂移**：不是代码落后于文档，而是**文档的目标本身是错的**（读操作收敛为 Server Action、`src/modules` 分层、§12.5 的 RLS 策略模板）。照文档改会让系统变差。

> 换句话说：这套文档的**数据层**可以照做，**应用层**需要重写三处目标，**渲染/读路径**需要补一个 M1 没设计的东西。

---

## 1. 评审方法

读了 4 份目标文档、实现状态、ADR-0001，以及 `0001_auth_rls.sql`、`lib/db/queries/nodes.ts`、`lib/lineage/node-services.ts`、`lib/db/drizzle.ts`、`components/lineage/derived.ts`。

凡是"代码里是否真的这样"的判断，一律以迁移与源码为准，不以文档为准。下文每条问题都给出证据位置，便于逐条反驳或修复。

---

## 2. 值得保护的决策（不要动）

先把好的挑出来，避免后文的批评误伤。

| 决策 | 为什么它是对的 |
|---|---|
| `auth.has_org_role()` 用 `SECURITY DEFINER` 解 RLS 自引用递归 | 数据模型 §12.4 的"错误示例 + 正确解法"是全套文档里最有价值的一页。多数团队会在这里踩一次 `infinite recursion detected in policy` |
| 触发器建默认组织 | "有账号必有组织"只有在**唯一写入点**上才成立。放在应用层，未来多一条注册路径就破一次 |
| 软删 + **部分**唯一索引 | 软删方案最容易漏的一环。漏一个索引，上线第一周就会有"删了不能建同名"的工单 |
| 双真外键替代多态 `(target_type, target_id)` | 悬空引用在 schema 层不可能存在，比任何应用层校验都强 |
| 布局是 React Flow 之外的纯函数 | 可单测、可替换。这是画布能长期维护的唯一原因 |
| 零后台任务 / 零队列 / 零缓存层 | 正确的减法。M1 没有消费者就不该有基础设施 |
| Server Action 不 throw、返回判别联合 | 框架会把 throw 转成 500 错误页，UI 无法区分冲突与校验失败。这个判断是对的 |

---

## 3. 问题总表

优先级定义：**P0** = M1 GA 前必须修（不修则文档判据不成立）· **P1** = M2 前修（现在修成本约为将来的 1/5）· **P2** = 记录，随功能推进处理。

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| **P0-1** | 谱系图全量加载，与"50 万人丁/组织"容量目标冲突 | `lib/db/queries/nodes.ts:7`、architect §1.1 G2、PRD §7 容量 | G2 不可达；服务端序列化与浏览器内存双爆 |
| **P0-2** | 每个查询各开一个事务，单次页面 6 个事务 | `nodes.ts` 各函数独立 `withOrg`、`lineageId/page.tsx` | 首屏 ~30 个往返，TTFB 预算被吃掉 |
| **P0-3** | 世系表按 `generation, sort` 排序，跨房支顺序错 | `components/lineage/derived.ts:38-43`、`nodes.ts:23-28` | FR-LIN-13 验收标准不成立；M2 渲染会继承错误 |
| **P0-4** | 写操作无幂等，`node` 无去重键 | `0000_baseline.sql` 无 `uk_node_*`；api §3.3 声称"业务唯一索引挡重复提交" | 双击/重试产生重复人丁，是族谱数据质量的头号问题 |
| **P0-5** | §12.5 的 RLS 策略模板与实现不一致，且模板本身有缺陷 | `data-model.md:842-861` vs `0001_auth_rls.sql:20-33, 490-515` | M2 新增 4 张表照抄模板 → 重新引入"已移除成员仍可读" |
| **P1-6** | `depth` 列与 `path` 冗余，可派生 | `node` 表、`moveNodeInTransaction:756-767` | 每次移动多写一列；两列可能漂移 |
| **P1-7** | `src/modules` 目标分层与 `lib/*` 现实脱节；强制机制未配置 | architect §4.1/§7.1、`lib/db/services.ts` 712 行 | 架构约束不可执行，G3 判据失效 |
| **P1-8** | "读操作收敛为 Server Action"是错误方向 | `api.md:413`、`architect.md:418` | 破坏缓存/预取/并行读；把读流量灌进写通道 |
| **P1-9** | 无 `statement_timeout` / `idle_in_transaction_session_timeout` | 全仓 grep 无结果 | 无 DBA 团队最容易踩的"一条慢查询拖垮池" |
| **P1-10** | 模型无法表达过继 / 兼祧 / 入赘 | `node.parent_id` 单列 + 严格父系 `path` | M3 排版会固化它；届时是跨全表数据迁移 |
| **P1-11** | `getSessionUser()` 返回含密码哈希的整行 | `implementation-status.md:199` 自认 | 靠"记得挑字段"防守，迟早泄一次 |
| **P1-12** | RLS 依赖"迁移角色 BYPASSRLS"这一未断言前提 | `data-model.md:749`、`handle_new_user` | 运维硬化角色权限的那天，注册与所有策略同时失效 |
| **P1-13** | `AUTH_SECRET` 单密钥，无轮换路径 | `architect.md:648` R6 | 轮换 = 全量登出，于是没人敢轮换 |
| P2-14 | `book_catalog.parent_id ON DELETE CASCADE` 是死配置 | `data-model.md:576` + 无 DELETE 授权 | 软删父项产生孤儿子树；与 `folder` 无自引用外键的做法不一致 |
| P2-15 | `organization.status='closed'` 无任何语义定义 | PRD FR-ORG-8 只定义 `suspended` | 实现用 `closed`+`deleted_at`，成员自己也读不到，与"只读放行"语义分叉 |
| P2-16 | `generation_words` 数组与世次的下标偏移未定义 | `data-model.md:413` | 始祖=1 对应 `words[0]` 还是 `words[1]` 无据可依，首 100 条数据就会错 |
| P2-17 | `activity_logs` 在业务事务内写入 | `node-services.ts` 的 `logActivityInTx` | 与"日志失败不阻塞业务"矛盾；日志写失败会回滚业务 |
| P2-18 | 限流依赖 `x-forwarded-for` 可信性 | `architect.md:529` | 头可伪造时限流等于没有；应只信任平台注入的头 |
| P2-19 | 文档三处对 Route Handler 数量表述不一致 | architect §7.4「1 个」/ api §1.1「1 个」/ 实际 4 个 | 契约文档可信度受损 |
| P2-20 | `article.plain_text` 无触发器兜底 | `data-model.md:522` | 漏更新则全文检索静默失效，无报错 |

---

## 4. P0 详述

### P0-1 谱系图全量加载：文档的容量目标与读路径互相矛盾

**事实**

- `architect.md` §1.1 G2：「十万级人丁的谱系图可交互」，判据「首屏 ≤ 1.5s」。
- `prd.md` §7 容量：「单组织 人丁 ≤ 50 万」。
- `getNodes()` 一次性 `SELECT *` 出该谱系**全部**节点，无 `limit`、无世代上限：

```ts
// lib/db/queries/nodes.ts:7
export async function getNodes(userId, orgId, lineageId): Promise<Node[]> {
  return withOrg(userId, (tx) =>
    tx.select().from(nodes).where(and(
      eq(nodes.orgId, orgId), eq(nodes.lineageId, lineageId), isNull(nodes.deletedAt),
    )).orderBy(...)
  );
}
```

- `FR-LIN-10` 的"按代加载"只约束**渲染**（首屏 5 世、`onlyRenderVisibleElements`），不约束**传输**。
- 实现状态风险 #11 已自认这一点。

**为什么这是 P0 而不是"已知限制"**

50 万行 × 每行约 300 字节序列化 ≈ 150MB 的 RSC payload。这不是"慢"，是**不可达**。而且浏览器端 React Flow 的 store 会持有 50 万个节点对象——`onlyRenderVisibleElements` 只减少 DOM/绘制，不减少 store 内存与每次 `setNodes` 的 diff 成本。所以 G2 的 45fps 在 1 万节点时就守不住了。

**修法（M1 就要做，改动很小）**

`idx_node_lineage_depth` 已经存在，正好服务这个查询：

```ts
// 新增：按代取窗口，而不是全量
export async function getGraphWindow(
  userId: string, orgId: string, lineageId: string,
  { maxDepth, includeDepth }: { maxDepth: number; includeDepth?: number },
): Promise<{ nodes: Node[]; truncated: boolean; nextDepth: number | null }> {
  return withOrg(userId, async (tx) => {
    const rows = await tx.select().from(nodes).where(and(
      eq(nodes.orgId, orgId),
      eq(nodes.lineageId, lineageId),
      isNull(nodes.deletedAt),
      lte(nodes.depth, maxDepth),
    )).orderBy(asc(nodes.generation), asc(nodes.sort));
    const [head] = await tx.select({ n: sql<number>`count(*)::int` }).from(nodes)
      .where(and(eq(nodes.orgId, orgId), eq(nodes.lineageId, lineageId),
                 isNull(nodes.deletedAt), gt(nodes.depth, maxDepth)));
    return { nodes: rows, truncated: (head?.n ?? 0) > 0, nextDepth: (head?.n ?? 0) > 0 ? maxDepth + 5 : null };
  });
}
```

配套三件事：

1. **边界节点**：窗口内节点的 `parentId` 可能指向窗口外。要么把 `maxDepth` 的父链一并带上（一次 `path <@` 查询），要么前端把缺失父节点画成"折叠占位"。建议前者，一次查询解决。
2. **搜索不再依赖全量图**：`searchNodes()` 已有 SQL 实现，改为"搜到目标 → 返回其祖先链 + 目标 + 目标子树前 N 代"，前端据此定位。
3. **把容量口径改对**：`prd.md` §7 的"50 万人丁/组织"改成分层表述——**组织级** 50 万（跨谱系合计）、**单谱系** 5 万、**画布同时可见** ≤ 2000 节点。三个数字对应三种不同的技术承诺，现在只有一个数字，谁都不知道它约束的是哪一层。

---

### P0-2 每查询一个事务：首屏 6 个事务、约 30 个往返

**事实**

`withOrg()` 每次调用开一个事务，并执行 2 条设置语句：

```ts
// lib/db/drizzle.ts:71
export async function withOrg<T>(userId, fn) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local role app_rw`);          // 往返 2
    await tx.execute(sql`select set_config(...)`);          // 往返 3
    return fn(tx);                                          // 往返 4
  });                                                        // BEGIN=1, COMMIT=5
}
```

一次 `withOrg` = **5 个往返**。而谱系详情页开了 6 个：

```ts
// app/(dashboard)/.../lineages/[lineageId]/page.tsx
await requireProjectContext(projectRef);  // 内部 ≥3 个 withOrg：session / membership / project scope
await getLineageById(...);                // 1
await Promise.all([getNodes(...), getNavFolders(...)]);  // 2
```

`Promise.all` 只是并发，不改往返总数。

**往返预算测算**（Neon 同区域 RTT 按 5 / 10 / 20ms 三档）：

| 场景 | 往返数 | @5ms | @10ms | @20ms |
|---|---:|---:|---:|---:|
| 现状（6 事务） | ~30 | 150ms | **300ms** | 600ms |
| 单事务 + 合并上下文 RPC | ~8 | 40ms | **80ms** | 160ms |
| TTFB 预算 | — | — | **400ms** | — |

也就是说：现状在 10ms RTT 下，**光数据库往返就吃掉 TTFB 预算的 75%**，页面渲染、RSC 序列化、CDN 全部还没开始。而 `architect.md` §3.2 写的缓存触发条件是"p95 > 200ms 且 QPS > 50"——这个条件永远不会触发，因为瓶颈不是 QPS，是**固定往返开销**。

**修法（两处，都不难）**

**(a) 一个请求一个事务。** 这正是文档 §5.2 原本的设计（`withOrg(ctx, tx => ...)` 包住整条链路），实现漂移成了"一个查询一个事务"。把 `tx` 作为显式参数往下传：

```ts
// 页面/动作层：唯一的事务边界
await withOrg(userId, async (tx) => {
  const ctx = await resolveContext(tx, { orgSlug, projectRef });  // 1 次查询
  const [lineage, nodes, folders] = await Promise.all([
    lineageQuery.getById(tx, ctx, lineageId),
    nodeQuery.getGraphWindow(tx, ctx, lineageId, { maxDepth: 4 }),
    folderQuery.getNav(tx, ctx, projectId),
  ]);
  return { ctx, lineage, nodes, folders };
});
```

收益是双份的：往返从 30 降到 8，**且整页读在一个快照里**（现在是 6 个不同快照，`node_count` 与节点列表可能不一致——`lineage.node_count` 是冗余计数，跨快照读会让"标题写 128 人、列表 127 人"这种 bug 偶发出现，而且极难复现）。

**(b) 把上下文解析压成 1 个 RPC。** 现在 `getSessionUser` → `getOrgWithRoleBySlug` → `getProjectScopeByRef` 是三次独立查询，本质是同一件事：

```sql
CREATE OR REPLACE FUNCTION auth.resolve_context(p_slug text, p_ref text DEFAULT NULL)
RETURNS TABLE (user_id uuid, user_name text, org_id uuid, role text, project_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
  SELECT u.id, u.name, o.id, m.role, p.id
  FROM auth.users u
  JOIN organization_member m ON m.user_id = u.id AND m.deleted_at IS NULL
  JOIN organization o ON o.id = m.organization_id AND o.deleted_at IS NULL
  LEFT JOIN project p ON p.organization_id = o.id
       AND p.ref = p_ref AND p.deleted_at IS NULL
  WHERE u.id = auth.uid() AND u.deleted_at IS NULL
    AND o.slug = p_slug
    AND (p_ref IS NULL OR p.id IS NOT NULL);
$$;
```

1 个往返拿到全部上下文，且"非成员 / 项目不存在"统一表现为 0 行 → 404，语义与 §5.3 完全一致。

> 这两项做完，`architect.md` §3.2「缓存层：无」才真的站得住。否则第一个真实用户量上来时，唯一的出路就是加 Redis——而那会引入 M1 明确不想引入的东西。

---

### P0-3 世系表跨房支顺序错：FR-LIN-13 的验收标准不成立

**事实**

```ts
// components/lineage/derived.ts:38
blood.sort((left, right) => {
  if (left.generation !== right.generation) return left.generation - right.generation;
  return bySortThenName(left, right);   // 只比 sort，sort 是"同一父节点内的排行"
});
```

`sort` 是**每父节点独立**的（`nextBloodSort` 取 `max+1`）。所以同一世次里，不同房支的兄弟排行会被混在一起排：

```
第 3 世：长房长子(sort=0) 次房长子(sort=0) 长房次子(sort=1) 次房次子(sort=1)
```

真实族谱世系表要求的是**房支优先的深度优先序**：

```
第 3 世：长房长子 → 长房次子 → …（长房全支）→ 次房长子 → 次房次子 …
```

`getNodes()` 的 SQL 排序 `generation, depth, sort, created_at` 有同样的问题（多一个 `depth`，但不改变跨房支交错）。

**为什么必须现在修**

- FR-LIN-13「世系表按世次列出全部人丁」+ 打印视图，直接消费这个顺序，现在是错的。
- M2 的谱书预览、M3 的 PDF 排版会消费同一个顺序。等排版引擎上线再改，等于让一批已排好的谱书页码全错。
- 修法极简：`buildLineageIndex` **已经**构造了 `childrenByParent` 和 `roots`，只是没用它们排序。

```ts
// 用已有的 childrenByParent + roots 做 DFS，替换全局 sort
const ordered: NodeView[] = [];
const walk = (n: NodeView) => {
  ordered.push(n);
  for (const child of childrenByParent.get(n.id) ?? []) walk(child);
};
for (const root of roots.sort(bySortThenName)) walk(root);
```

同时把 `getNodes` 的 `orderBy` 改成 `generation, path`（ltree 有全序，且祖先必为前缀，天然给出房支序），或干脆去掉 SQL 排序、由纯函数决定顺序——顺序是**领域规则**，不该散落在 SQL 与组件两处。

---

### P0-4 写操作无幂等：重复人丁是族谱数据质量的头号问题

**事实**

- `api.md` §3.3：「创建（防重复提交）| 业务唯一索引 | `CONFLICT_DUPLICATE` (409)」。
- `0000_baseline.sql` 中 `node` 表**没有任何**业务唯一索引（只有 `uk_node_organization_id` = `(organization_id, id)`，那是给复合外键用的）。
- `addChild` 的入参里没有幂等键。

所以 `api.md` 承诺的机制**在最热的写路径上不存在**。双击"添加子女"、网络重试、Server Action 被客户端重放，都会静默产生两条同名同父的兄弟节点——而族谱里"多了一个人"比"少了一个人"更难发现，往往到排版成书时才暴露。

**修法（选一，建议 A）**

**A. 幂等键（推荐）**：所有创建类 Action 增加 `requestId: uuid`，`node` 加一列并建唯一索引：

```sql
ALTER TABLE node ADD COLUMN request_id uuid;
CREATE UNIQUE INDEX uk_node_request ON node (organization_id, request_id)
  WHERE request_id IS NOT NULL AND deleted_at IS NULL;
```

重复提交时唯一索引命中 → 返回**已存在的那一行**（而不是 409）。这才是幂等的语义：重试返回同一结果，用户看不到报错。

**B. 软去重**：`(organization_id, lineage_id, parent_id, full_name, birth_year)` 唯一索引。问题是同名同辈的堂兄弟是合法的，会误伤。

**C. 只做 UI 层禁用按钮**：最便宜，但挡不住网络重试。现状实际上就是这个，只是没写清楚。

> 顺带修 `api.md` §3.3：要么把 A 补上，要么承认"防重复提交"只靠 UI 禁用，别写"业务唯一索引"——文档承诺了不存在的机制，比没写更危险。

---

### P0-5 §12.5 的 RLS 策略模板是 M2 的地雷

**事实**

`data-model.md` §12.5 给的模板：

```sql
-- 文档模板
CREATE POLICY organization_isolation ON %I
  AS PERMISSIVE FOR ALL TO app_rw
  USING (organization_id IN (
    SELECT organization_id FROM organization_member WHERE user_id = auth.uid()))
```

实际落地（`0001_auth_rls.sql:20-33, 490-515`）已经是另一套，而且**明显更好**：

```sql
-- 实现：SECURITY DEFINER 函数，且过滤软删
CREATE OR REPLACE FUNCTION auth.has_org_role(p_org_id uuid, p_roles text[]) ...
  WHERE m.organization_id = p_org_id AND m.user_id = auth.uid()
    AND m.deleted_at IS NULL AND m.role = ANY(p_roles)

-- 实现：读/写拆成三条策略，写不含 viewer
CREATE POLICY %I ON %I FOR SELECT USING (auth.has_org_role(organization_id, ARRAY['owner','admin','editor','viewer']))
CREATE POLICY %I ON %I FOR INSERT WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner','admin','editor']))
CREATE POLICY %I ON %I FOR UPDATE USING (...) WITH CHECK (...)
```

两个差异，都是致命的：

1. **文档模板漏了 `deleted_at IS NULL`**。照抄它 → **被移除的成员（软删成员行）仍然通过 RLS 隔离检查**，能继续读该组织的全部数据。`FR-ORG-6`「移除后该成员立即失去访问权」在第三层防护上是**破的**，只剩应用层在挡。而 `architect.md` §8.2 的原话是"三层防护，缺一不可"。
2. **文档模板用 `FOR ALL` + 单一角色集**，无法表达"读要含 viewer、写要排除 viewer"。照抄它 → viewer 能写。

M2 计划新增 4 张表（`share_link` / `delete_batch` / `resource_lock` / `media`），届时最自然的动作就是"照 §12.5 的模板来"。**这等于把已经修好的坑重新挖一遍。**

**修法**

- 把 §12.3 / §12.5 整段替换为**与迁移一致的**文本（`has_org_role` + 三策略拆分），并明确"新增表的策略必须复制 `0001_auth_rls.sql:490-515` 的 DO 块，不要手写"。
- 加一条 CI 断言：`pg_policies` 中不存在 `qual` 里含 `FROM organization_member` 的策略（即禁止裸子查询写法）。

```sql
-- CI 检查：不允许裸子查询式策略（M2 新增表也不能例外）
SELECT schemaname, tablename, policyname FROM pg_policies
WHERE qual LIKE '%organization_member%' AND qual NOT LIKE '%has_org_role%';
-- 期望 0 行
```

---

## 5. P1 详述

### P1-6 删掉 `depth` 列

`depth` 恒等于 `nlevel(path) - 1`，是 `path` 的纯函数。存它带来三份成本：

1. `moveNodeInTransaction` 的批量 UPDATE 要多写一列（`node-services.ts:756-767`）；
2. 配偶行 `path IS NULL`，`depth` 只能靠"跟着血亲一起更新"维护（`:782-802`），是额外一段易错逻辑；
3. 两列可能漂移，且没有任何约束能发现漂移。

**建议**：删列，查询用 `nlevel(path) - 1`，或建生成列（配偶行需 `coalesce` 到配偶的 `depth`，若嫌复杂就直接删）。`idx_node_lineage_depth` 改成表达式索引 `(organization_id, lineage_id, nlevel(path))`。

> 这是"优化"最典型的一类：**少一列 = 少一类 bug + 少一次写放大**，而且没有功能损失。

### P1-7 分层目标与实现脱节，且强制机制没配

`architect.md` 写的是 `src/modules/{identity,organization,project,lineage,content,publishing}`，现实是 `lib/{org,project,lineage,folder,auth,db,ui,genealogy}`。后果不是"目录不好看"，而是三条判据全部失效：

| 文档判据 | 为什么失效 |
|---|---|
| §4.2「每张表有且只有一个 owner 模块」 | `lib/db/services.ts`（712 行）同时持有 `organization` / `organization_member` / `invite` / `project` / 账号逻辑，6 张表挤在一个文件里 |
| §4.3「依赖只允许向下」 | 没有模块边界，无法检查；也没有 lint 规则 |
| G3「新增实体 ≤ 3 文件 + 1 迁移」 | 实际是 schema + queries + services + actions + component = 5 个文件 |
| §11「单文件 ≤ 400 行」 | `node-services.ts` 871 行、`services.ts` 712 行、`lineage-detail.tsx` 837 行，三条都超 |

而 §7.1 自己写的强制手段（Biome `noRestrictedImports`）在 §4.4 里承认"尚未配置"。

**建议：不要迁移到 `src/modules`。** 理由：1–3 人团队、6 个模块、已经跑通 134 个集成测试，为目录结构做一次全量搬迁，收益是"文档和目录长得一样"，成本是两周和一堆 import 冲突。

**改为承认现实并把它变成可执行的**：

1. 文档 §4.1 改成 `lib/<domain>/`，模块边界就是 `lib/org`、`lib/project`、`lib/lineage`、`lib/folder`、`lib/auth`、`lib/db`。
2. 立刻配三条 Biome 规则（半天工作量），让架构**第一次变成可执行约束**：
   - `lib/*/actions.ts` 不得 import `lib/db/drizzle`（只有 queries/services 能碰 db）
   - `lib/db/queries/*` 不得 import `lib/*/actions`
   - 客户端组件不得 import `lib/db/**`、`lib/auth/session`（已有 `server-only` 兜底，但 lint 报错更早）
3. 把 `lib/db/services.ts` 按域拆成 4 个文件（org / member+invite / project / account）。这是纯机械拆分，测试是现成的安全网。

> 判断标准很简单：**如果一条架构约束没有 lint 或 CI 在执行它，它就不是约束，是愿望。** 这套文档目前有 5 条这样的愿望。

### P1-8 "读操作收敛为 Server Action"是错方向

`api.md:413` 与 `architect.md:418` 都写了"`queryFn` 调用只读 Route Handler，**目标收敛为 Server Action**"。建议**放弃这个目标**，并把 4 个只读端点正式承认为设计的一部分。

理由（都是具体机制，不是偏好）：

| 机制 | 只读 Route Handler | Server Action |
|---|---|---|
| 可缓存 / 可预取 | ✅ `staleTime` + `prefetchQuery` 生效 | ❌ 本质是 POST，不可缓存、不可预取 |
| 并行读 | ✅ 浏览器并发 | ❌ Next 对 Action 请求串行化排队 |
| 幂等语义 | ✅ GET 天然幂等 | ❌ 每个读都被当成"调用一次" |
| 可观测性 | ✅ 独立路由，日志/耗时按路由聚合 | ❌ 混在写通道里，读延迟被写入统计 |
| 契约 | ✅ 有 URL、有 DTO，可 curl | ❌ 只能靠 TS 类型 |

更实际的问题：`architect.md` §9.5 说"从日志的 `duration_ms` 按路由聚合 p95"。读操作全走 Action 后，**p95 按路由聚合这件事就做不到了**——所有读挤在一个 `POST /` 上。

**建议**：文档改成"读端点保留为 Route Handler（当前 4 个，按需增加）；Server Action 只用于写"。同时修 P2-19 的数量不一致。

### P1-9 补 `statement_timeout`

全仓 grep 无 `statement_timeout`。1–3 人团队、无 DBA、连接池上限 5——一条因数据异常退化的查询（比如某个谱系被误操作成 20 万节点后执行 `moveNode` 的子树重写）就能把池占满，整个实例不可用。

```sql
ALTER ROLE app_rw SET statement_timeout = '10s';
ALTER ROLE app_rw SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_rw SET lock_timeout = '5s';
```

三行 SQL，写进 `0001` 之后的迁移。这是全套建议里**性价比最高的一条**：成本 5 分钟，避免的是一次全站不可用。

### P1-10 模型无法表达过继 / 兼祧 / 入赘

`node` 只有 `parent_id`（单父）+ `mother_id` + 严格父系的 `path`。这意味着：

| 族谱现实 | 模型能否表达 |
|---|---|
| 过继（嗣子） | ❌ 改 `parent_id` = 抹掉生父关系，历史不可追溯 |
| 兼祧（一人承两房） | ❌ 一个人只能有一个父，除非复制成两条人丁（数据从此分叉） |
| 入赘（子女随母系） | ❌ `path` 只能沿父系延伸 |
| 女儿入谱 | 🟡 能录，但她的子女无法挂在她下面形成支系（PRD Q4 未决，模型其实已经替产品做了决定） |

PRD §9 的开放问题只问了"女儿是否入谱"（Q4），**过继/兼祧根本没被列为问题**。而这是修谱场景的日常，不是边缘情况。

**为什么现在必须决策**：M2 的谱书预览、M3 的 PDF 排版会消费这个结构；一旦有真实客户的谱书按当前结构排出来，再改成"关系边表"就是跨全表数据迁移 + 全部已排版本重排。

**建议（决策，不是实现）**：在 M1 GA 前明确回答一个问题——**"关系"是节点属性还是独立实体？**

- 若坚持节点属性（现状）：把"过继/兼祧不支持"写进 PRD §6.3 缺口，作为销售话术前置说明。这是可接受的取舍，但必须显式。
- 若要支持：`node_parent` 关系表（`child_id, parent_id, kind: birth|adoptive|foster, sort`），`path` 降级为"主系缓存"或直接去掉。这是 M2 的活，但**必须在 M1 定，否则 M3 无法回头**。

### P1-11 `getSessionUser()` 不该携带密码哈希

`implementation-status.md:199` 已经自认：返回完整用户行（含 `password_hash`），只对 2 个出口做了 `SessionUser` 收窄。当前靠"新增出口记得挑字段"防守——这类防守在团队扩到第 3 个人时就会破。

**建议**：把收窄下沉到函数本身。

```ts
// lib/auth/session.ts
export type SessionUser = { id: string; name: string | null; email: string };
export async function getSessionUser(): Promise<SessionUser> { ... }        // 只返回 DTO
async function getSessionUserRow(): Promise<UserRow> { ... }               // 内部专用，不 export
```

再加一条 CI 检查：`app/**`、`components/**` 中不出现 `passwordHash`（字符串断言即可，成本 1 行）。

### P1-12 RLS 依赖"迁移角色 BYPASSRLS"，但这个前提没有被断言

`data-model.md:749` 明确写了"迁移/管理连接使用 Neon 项目所有者角色……`FORCE ROW LEVEL SECURITY` 也拦不住"。这是**整套 RLS 设计的地基**：

- `handle_new_user()`（`SECURITY DEFINER`，属主=迁移角色）要往开了 `FORCE RLS` 的 `organization` 写数据；
- `auth.has_org_role()`（`SECURITY DEFINER`）要读 `organization_member`，而 `organization_member` 的策略又调用它——**如果函数属主受 RLS 约束，这里就是无限递归**。

今天能跑，是因为迁移角色（本地超级用户 / Neon `neondb_owner` ∈ `neon_superuser`）恰好有 BYPASSRLS。**运维硬化角色权限是一件标准动作**——一旦有人为了"最小权限"把迁移角色降成普通角色，注册与所有策略会同时失效，而且报错信息（`infinite recursion detected in policy`）完全指不到根因。

**建议**：把前提变成断言，放进 `verify:deploy`：

```sql
-- 断言迁移角色确实绕过 RLS；否则 RLS 设计不成立，必须停机修复
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- 期望 rolbypassrls = true
```

并在 `data-model.md` §12.2 加一行"**此设计的前提**：迁移角色必须 BYPASSRLS；该前提由 `verify:deploy` 断言"。

### P1-13 给 `AUTH_SECRET` 留轮换路径

R6 写"轮换即全量登出，作为可接受的应急操作"。问题是：**当轮换的代价是全量登出时，实际结果是不轮换。** 密钥泄露时最需要轮换的时刻，恰恰最不敢按这个按钮。

**建议**：JWT header 加 `kid`，支持双密钥（约 15 行）：

```ts
// config: AUTH_SECRET（当前，kid='2'）+ AUTH_SECRET_PREVIOUS（旧，kid='1'）
// 验签：按 header.kid 选密钥；签发：恒用当前密钥
```

轮换流程变成：加新密钥为 current → 旧密钥保留 1 天（> 会话有效期）→ 删除旧密钥。零登出。

---

## 6. 做减法：建议删掉的设计

"优化"里最有效的一类动作是**删除**。以下五项建议直接删，收益都大于成本：

| 删除项 | 位置 | 省下什么 |
|---|---|---|
| `src/modules` 目标分层 | architect §4.1 | 两周搬迁 + 一次 import 大冲突；改为承认 `lib/<domain>` 并配 lint |
| "读收敛为 Server Action" | api §7.1 / architect §7.4 | 一个错误目标，以及围绕它写的所有过渡性说明 |
| `node.depth` 列 | data-model §6.2 | 一类漂移 bug + `moveNode` 的写放大 + 配偶跟随逻辑 |
| `book_catalog.parent_id ON DELETE CASCADE` | data-model §8.2 | 死配置（无 DELETE 授权），且误导人以为级联会生效 |
| `activity_logs` 的事务内写入 | `node-services.ts` | 业务回滚风险；改为事务提交后 best-effort 写 |

补充一条**不要删**的：`data-model.md` §12.4 那段"错误示例 → 正确解法"的教学式写法。它违反了一般技术文档的简洁原则，但它是这份文档里唯一能防止后人重新踩坑的东西，建议保留并扩写到其他高风险点（软删索引、复合外键）。

---

## 7. 需要在 M1 GA 前拍板的决策

只列"拖到后面成本会翻倍"的：

| # | 决策 | 选项 | 建议 | 截止 |
|---|---|---|---|---|
| D-1 | 关系模型：节点属性 vs 关系边表 | 现状 / `node_parent` 边表 | **必须显式回答**。支持过继兼祧 → 现在设计边表；不支持 → 写进 §6.3 缺口 | M1 GA 前 |
| D-2 | 容量口径分层 | 单一"50 万" / 三层口径 | 组织 50 万 · 单谱系 5 万 · 画布可见 2000 | M1 GA 前 |
| D-3 | 读通道 | 收敛为 Action / 保留 Route Handler | **保留 Route Handler**，改文档 | 立即 |
| D-4 | 模块边界 | 迁 `src/modules` / 承认 `lib/<domain>` | 承认现状 + 配 3 条 lint | 立即 |
| D-5 | 幂等 | 无 / `request_id` 唯一索引 | 加 `request_id` | M1 GA 前 |
| D-6 | staging 环境 | 无 / 一套 | **必须有**。R13/R15 与 `pg`+`attachDatabasePool` 都只能在真环境验证 | M1 GA 前 |

D-6 单独强调：`implementation-status.md` 风险 #10 说"云端部署验证未执行"，而风险 #2 说"真实 Neon/Vercel 部署尚未验证"。这两条叠起来意味着**生产形态的连接池、角色分离、`FORCE RLS` 兜底三件事一次都没在真实环境跑过**。1–3 人团队最贵的故障就是"上线当天发现地基不成立"。一套 staging（Vercel Preview + Neon 分支）成本几乎为零。

---

## 8. 建议的落地顺序

按"单位时间消除的风险"排序，前四项合计约 3–4 天：

| 顺序 | 动作 | 工作量 | 消除的风险 |
|---|---|---|---|
| 1 | 三条 `ALTER ROLE ... statement_timeout` | 5 分钟 | 全站不可用（P1-9） |
| 2 | §12.5 RLS 模板改写 + CI 断言 | 2 小时 | M2 重新引入越权（P0-5） |
| 3 | `derived.ts` 改 DFS 排序 + `getNodes` 排序修正 | 半天 | FR-LIN-13 错误 + M3 排版继承（P0-3） |
| 4 | `withOrg` 改为请求级事务 + `resolve_context` RPC | 1–2 天 | TTFB 预算（P0-2） |
| 5 | `getGraphWindow` 按代查询 + 容量口径分层 | 2–3 天 | G2 不可达（P0-1） |
| 6 | `request_id` 幂等 | 半天 | 重复人丁（P0-4） |
| 7 | 3 条 Biome 边界规则 + 拆 `services.ts` | 1 天 | 架构约束失效（P1-7） |
| 8 | 文档三处反向漂移修正（§4.1 / §7.4 / §12.5） | 半天 | 后续所有决策基于错误目标 |
| 9 | staging 部署 + `verify:deploy` 云端跑通 | 1 天 | 地基未验证（D-6） |

第 8 项容易被忽略但优先级不低：**这套文档是团队的决策依据，其中三处目标本身是错的。** 文档错了，后面每一个"按文档实现"的动作都在往错的方向走。

---

## 附录 A：一次谱系页请求的往返预算

| 步骤 | 现状事务数 | 现状往返 | 目标事务数 | 目标往返 |
|---|---:|---:|---:|---:|
| 会话校验 | 1 | 5 | 0（并入） | 0 |
| 组织成员解析 | 1 | 5 | 0（并入） | 0 |
| 项目解析 | 1 | 5 | 0（并入） | 0 |
| 合并上下文 RPC | — | — | 1 | 5 |
| 谱系元信息 | 1 | 5 | 0（并入） | 0 |
| 人丁（窗口） | 1 | 5 | 0（并入） | 0 |
| 分类导航 | 1 | 5 | 0（并入） | 0 |
| **合计** | **6** | **~30** | **1** | **~8** |

@10ms RTT：300ms → 80ms。@20ms RTT：600ms → 160ms。

---

## 附录 B：文档与代码的三处反向漂移（汇总）

| 文档说什么 | 代码实际 | 谁对 |
|---|---|---|
| §12.5 策略用裸子查询 `organization_member` | 用 `auth.has_org_role` + 三策略拆分 + 过滤软删 | **代码对**，文档要改（P0-5） |
| 读操作应"收敛为 Server Action" | 4 个只读 Route Handler | **代码对**，文档要改（P1-8） |
| 模块应放 `src/modules/*` | 实为 `lib/<domain>/*` | **代码对**，文档要改（P1-7） |
| §7.4「Route Handler：1 个」 | 4 个 | 都不对，需要统一表述（P2-19） |

这三处的共同点：**文档是在"更好的设计"这个假设下写的，但代码在落地时做了更务实的判断，而文档没有回写。** 结果是新人读文档会得出错误结论，老人凭记忆工作——这是 1–3 人团队最典型的文档债形态。

建议给文档加一条硬规则：**任何"目标设计与实现不一致"的条目，要么在 implementation-status 里登记为差异，要么改目标。不允许两边都留着。** 现在 `implementation-status.md` 做得很好（它诚实、可验证），问题在于目标文档没有回写——`implementation-status` 是"差异登记簿"，不该同时承担"目标修正"的职责。
