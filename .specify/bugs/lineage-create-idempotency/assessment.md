# Bug Assessment: 人丁创建无幂等键，重放会静默多出人

- **Slug**: lineage-create-idempotency
- **Created**: 2026-11-03T17:18:00+08:00
- **Source**: pasted text（来自 `docs/architecture/12-风险与演进规划.md` R31 + 代码核对）
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

仓库风险登记簿 R31 原文要点：

> 写操作无幂等：接口契约写着「创建（防重复提交）= 业务唯一索引 → CONFLICT_DUPLICATE 409」（`05-接口与集成设计.md`），但 `node` 表没有任何业务唯一索引（只有给复合外键用的 `(organization_id, id)`），`addChild` 入参也没有幂等键。双击「添加子女」、网络重试或 Server Action 被客户端重放，会静默产生两条同名同父的兄弟；族谱里「多一个人」比「少一个人」更难发现。

本评估未拉取外部 URL（无 URL）。

## Symptom

**观察到**：同一客户端对 `addChildAction` / `addSiblingAction` / `createRootNodeAction` / `addSpouseAction`（及统一录入 `addPerson`）的重复提交，会各自成功并插入新的 `node` 行。

**期望**：同一客户端请求幂等键下，第二次提交返回已存在的那一行（或稳定的成功态），不新增人丁。

## Reproduction

1. 在已有血亲节点下打开「添加子女」。
2. 填写姓名并提交一次，确认树中多一人。
3. 不改表单，再提交一次（慢网双击、或手动重放同一次 Server Action 载荷）。
4. 期望仍只有一人；实际会出现两条同名、同父、不同 `id`/`path`/`sort` 的兄弟。

集成测试侧可用同一事务上下文连续调用两次 `addChildInTransaction`（相同业务字段、**无** `requestId`）断言行数 +2 为现状；修复后带同一 `requestId` 应 +1。

## Suspected Code Paths

- `lib/db/schema/lineage.ts`（`nodes` / `node` 表） — 约束仅有 `uk_node_organization_id`、`uk_node_org_lineage_id`；**无** `request_id` 列，**无**业务部分唯一索引。
- `lib/genealogy/schemas.ts` — `addChildSchema` / `addSiblingSchema` / `createRootNodeSchema` / `addSpouseSchema` / `addPersonSchema` 均无 `requestId` 字段。
- `lib/lineage/actions.ts` — `addChildAction` 等直接把 Zod 数据交给 `*InTransaction`，无客户端幂等键透传。
- `lib/lineage/node-services.ts` — `recordNode` 每次 `newNodeId` + `insertNode`；各创建函数无「先按幂等键查找」分支。
- `docs/architecture/05-接口与集成设计.md` — 契约声称创建防重复 → `CONFLICT_DUPLICATE` 409，与实现不一致。
- `docs/architecture/12-风险与演进规划.md` R31 — 已登记；本评估代码侧证实**未修**。

## Root Cause Hypothesis

创建路径把「一次用户意图」实现成「无约束的 INSERT」。主键/路径由服务端每次新分配，同名同父不是唯一键，因此重放必然多行。契约层写了防重复，但 schema、Zod、事务函数三层都未落地。

**Confidence**: high（schema + 创建函数源码直接证实）。

## Proposed Remediation

**Preferred**:

1. `node` 增加可空列 `request_id uuid`（仅创建写入）。
2. 部分唯一索引：`(organization_id, request_id) WHERE request_id IS NOT NULL AND deleted_at IS NULL`。
3. Zod：创建类 schema 增加必填 `requestId: z.string().uuid()`。
4. UI：每次打开创建对话框生成一次 `crypto.randomUUID()`，同一次提交意图复用；成功关闭后再换新键。
5. `recordNode`（或各 `*InTransaction` 入口）：若带 `requestId`，先 `SELECT` 同 org 未删行；命中则返回该行（共创配偶随首次事务一起写入，重放只返回已有结果）。
6. 唯一索引冲突（并发双飞）捕获 `23505`，再查一次返回已有行，而不是对用户报 409。
7. 更新 `05` 契约与 R31 状态；迁移与业务分提交。

**Alternatives**:

- 仅前端防双击：挡不住重试/多端，不够。
- 用 `(org, lineage, parent, name, sex)` 业务唯一：同名兄弟在真实族谱合法，会误伤。

**Files likely to change**:

- `lib/db/schema/lineage.ts`
- `lib/db/migrations/*`
- `lib/genealogy/schemas.ts`
- `lib/lineage/node-services.ts`
- `lib/lineage/actions.ts`
- `components/lineage/node-create-dialog.tsx`
- 相关 Vitest 集成测试
- `docs/architecture/12-风险与演进规划.md`
- 视需要：`docs/architecture/05-接口与集成设计.md`

**Tests to add or update**:

- 集成：同一 `requestId` 连续两次 `addChildInTransaction` → 仅一行，两次返回同一 `node.id`。
- 集成：不同 `requestId`、同名同父 → 允许两行。
- 集成：并发双插入同一 `requestId` → 最终一行。
- 回归：`createRoot` / `addSibling` / `addSpouse` 同样覆盖。

## Risks & Considerations

- 迁移：线上已有行的 `request_id` 为 NULL，部分唯一允许；旧客户端未传键时行为与今天相同——应强制新客户端传键，或服务端缺省时拒绝创建。
- 共创配偶：一次 Action 可能插两行；幂等重放须避免第二名配偶。建议配偶行也写入同一 `request_id`（或只挂血亲，配偶用 `spouse_of_id` 查找）。
- 与软删：索引条件排除软删后，同键可被复用建新行——可接受或改为更严。
- 文档/契约与实现长期漂移；修完必须改 R31 与 05。

## Open Questions

- 服务端是否在缺少 `requestId` 时直接拒绝创建（推荐：**是**）？
- 共创配偶是否共用同一 `requestId`，还是派生第二个键？

