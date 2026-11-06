# 人丁事实层读写切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**决策（2026-11-05）**：`person` / `person_name` / `family` / `family_partner` / `family_child` / `event` 六表是**目标真源**；`node` 是**当前唯一读写源**，退役是终点而不是起点。选事实层而不是 `node`，因为事实层把「人」与「人在树上的位置」分开，同一真人可跨谱系复用；`node` 把两者混在一行，撑不起谱书编目与成品排版。

**Goal:** 用**一次写路径替换**（不是双写、不是同步视图）把谱系写入从 `node` 切到事实层，再把读切过去，最后冻结 `node`。切换完成后库里只有一套人丁真相。

**Architecture:** 模块化单体；写仍走 Server Action → `withOrgWrite` 单事务 → `lib/<domain>/*-services.ts`；读仍走 RSC → `lib/db/queries/<domain>.ts`。事实层挂 `project`，`node` 挂 `lineage`，所以过渡期必须有一个显式的**位置投影**：树位置由 `family_child` / 家族边表达，`node` 在过渡期退为渲染用的派生视图，不再是可写的真相。

**Tech Stack:** Next.js 16 App Router / Drizzle / PostgreSQL 18 / Vitest + 真实 PostgreSQL 集成测试；不新增依赖、不新增后台任务/队列/定时器、不新增 Route Handler。

**Spec / 输入:** [11-需求与实现状态](../../architecture/11-需求与实现状态.md)（§8.2、§10.1）、[04-数据视图-数据架构](../../architecture/04-数据视图-数据架构.md)、[12-风险与演进规划](../../architecture/12-风险与演进规划.md) R21、`lib/db/backfill/fact-layer.ts`、`lib/db/backfill/reconcile-fact-layer.ts`。

---

## Global Constraints

- 本轮（Phase 0）**不动库、不删表、不双写、不切读**。产物只有：这份计划、事实层冻结门禁、失真文档收敛、零调用死代码删除。
- **冻结**：Phase 2 启动前不得向事实层加表、加列、加索引、加迁移，也不得在 `app/` / `components/` / `lib/<domain>/` 里新增事实层读写。六张表的形状在冻结期内不再变化；Phase 1 是设计期，不写库、不改 UI，冻结继续生效。
- **不双写**：禁止在 `node` 写入口同时写 `person` / `family`（那是第三套机制）。写路径是「替换」，不是「同步」。
- **事务**：任一写路径仍单事务 + `withOrgWrite`；失败不留半成品；`23505` / `23514` / `23503` 转中文 `ActionState`。
- **临时冻结会过期**：`tests/fact-layer-freeze.test.ts` 的四条临时断言与 `tests/security-regressions.test.ts` 的 `fact-layer write boundary` 只在切换启动前有效。两处的过期条件都以本计划 **Task 3 / Step 3** 为准：Phase 2「写切换」启动时一起改写或删除，**不能永久禁止读事实层**；`fact-layer tenant invariants` 是跨切换的长期约束，保留。
- 迁移只由 `pnpm db:generate` 生成后人工 review，迁移与业务代码分开提交。
- 提交前 `pnpm check && pnpm typecheck && pnpm test` 全绿；`pnpm arch:check`、`pnpm docs:check --strict` 无 issue。

## 启动闸门（唯一）

**谱书编目 + 成品排版主线端到端跑通**（能新建 / 编辑 / 导出一份谱书）之后才启动 Phase 1。在此之前，仓库里唯一活跃的人丁写源就是 `node`。

理由：基础设施完成度已经远高于产品完成度；先补机制会把这次切换做成第二次「六张表、两个 CLI、零个读者」。闸门没过就不动数据层，只做产品主线。

## 时间表

| Phase | 目标窗口 | 内容 | 完成判据 |
|---|---|---|---|
| 0 · 决策与冻结 | 2026-11-05 ~ 2026-11-06 | 拍板真源、写本计划、冻结门禁、收敛文档、删死代码 | 本计划落地；`pnpm test` / `docs:check --strict` 全绿；事实层表数量与形状被测试钉住 |
| 1 · 写路径设计 | 闸门后第 1 周（最早 2026-11-16） | 定写入口与 DTO；把 `node` 的写入面收敛到一处；设计位置投影 | 一份写入口清单 + 每个入口的替换映射；不写库、不改 UI |
| 2 · 写切换 | 闸门后第 2~3 周 | 按入口逐个把写从 `node` 换到事实层，单事务内维护位置投影 | 每个入口有真实 PG 集成测试（含失败不留半成品）；`node` 不再接受新写 |
| 3 · 读切换 | 闸门后第 4 周 | `lib/db/queries/` 与 RSC 首屏改读事实层；用 `RECONCILE_CHECKS` 做切换前后对账 | 谱系画布 / 世系表 / 检查器 / 打印视图在真实数据上等价；对账十四项全绿 |
| 4 · `node` 冻结与退役 | 闸门后第 5 周起 | 先冻结写入并观察，再退役 `node` | 冻结期内无 `node` 写入；退役迁移单独提交并人工 review |

窗口是目标不是承诺：闸门未达成时整体顺延，不为了赶日期启动切换。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `docs/superpowers/plans/2026-11-05-p1-read-write-switch.md` | 新增（本轮） | 唯一在飞的切换计划 |
| `tests/security-regressions.test.ts` | 修改（本轮） | 临时冻结注释 + 过期条件，补 `events` 断言 |
| `tests/fact-layer-freeze.test.ts` | 新增（本轮） | 冻结六表声明 / 形状 / 零 import / 迁移基线 |
| `tests/docs-consistency.test.ts` | 修改（本轮） | 文档路径、软删名单、实现的门禁都从代码派生 |
| `lib/console/revalidate.ts` / `tests/revalidate-paths.test.ts` | 修改（本轮） | 删两个零调用 scoped helper |
| `lib/lineage/*-services.ts` / `lib/db/queries/nodes.ts` | Phase 2~3 | 写替换与读替换（本轮不动） |
| `lib/db/migrations/` | Phase 4 | 退役迁移（本轮不动） |

### Task 1: 拍板与冻结（Phase 0，2026-11-05 ~ 11-06）

**Files:** 本计划、`tests/security-regressions.test.ts`、`tests/fact-layer-freeze.test.ts`、`docs/architecture/11-需求与实现状态.md`、`docs/architecture/04-数据视图-数据架构.md`、`docs/architecture/12-风险与演进规划.md`。

- [x] **Step 1**: 写下真源决策与启动闸门（本文件）。
- [x] **Step 2**: 把「事实层冻结」写成从代码派生的 Vitest 断言：六表声明存在、形状不变、业务代码零 import；给测试注释写明过期条件。
- [x] **Step 3**: 回填 11 / 04 / 12 / 03 里「切换计划尚未编写」的引用，指向本文件；R21 状态**保持 `缓解中`**（[12 §1](../../architecture/12-风险与演进规划.md) 只允许三种状态），在缓解列补真源决策、计划链接与冻结门禁——不改状态枚举，避免把风险登记簿变成第四种状态。
- [x] **Step 4**: 验证本轮改动：`pnpm typecheck`（0）、`pnpm test`（49 文件 / 379 用例）、`pnpm arch:check`（0 violations）、`pnpm docs:check --strict`（0 issue）全绿；Biome 对全部受版本控制文件 + 两个新文件 `pnpm exec biome check` 为 0。全仓 `pnpm check` 另有**基线噪声**：未跟踪的 `.magpie/*.json` / `.magpie/www/*.js` 有 format 诊断，会话开始前就存在，不属本轮改动，故不修改、不提交——全仓绿是把它清掉之后的事，不写进本计划的完成判据。

### Task 2: 写入口清单与位置投影设计（Phase 1）

**Files:** `lib/lineage/node-services.ts`、`lib/lineage/services.ts`、`lib/lineage/actions.ts`、`lib/db/queries/nodes.ts`。

- [ ] **Step 1**: 列出全部 `node` 写入口（按 Action 分组），标注每个入口对应哪几张事实层表、树位置如何由 `family_child` 表达。
- [ ] **Step 2**: 定义切换后的 DTO（窄字段，中文错误文案），写清 `legacy_node_id` 锚点在过渡期的用途与退役条件。
- [ ] **Step 3**: 出「一个入口一次替换」的顺序，按可回滚性排序；不新增表。

### Task 3: 写路径替换（Phase 2）

- [ ] **Step 1**: 每个入口先补真实 PG 集成测试（RED），再替换实现（GREEN）。
- [ ] **Step 2**: 单事务内维护位置投影；断言失败时业务与投影一起回滚。
- [ ] **Step 3**: 改写临时冻结门禁，允许业务代码写事实层，只禁止再写 `node`。

### Task 4: 读切换与对账（Phase 3）

- [ ] **Step 1**: `lib/db/queries/` 换成事实层读，DTO 保持窄字段；RSC 首屏 `dehydrate` 契约不变。
- [ ] **Step 2**: 用 `RECONCILE_CHECKS` 十四项对真实组织做切换前后对账，差异必须为零。
- [ ] **Step 3**: 谱系画布 / 世系表 / 检查器 / 搜索 / 打印视图端到端验收（Playwright）。

### Task 5: `node` 冻结与退役（Phase 4）

- [ ] **Step 1**: 冻结 `node` 写入并观察一个发布周期，确认无回退。
- [ ] **Step 2**: 退役迁移单独提交并人工 review；回填 / 对账 CLI 随之退役。
- [ ] **Step 3**: 更新 11 / 04 / R21 与 `docs/README.md`，把事实层写成唯一真源；本计划移入 `docs/archive/plans/`。

---

## 本轮不做（明确边界）

- 不切读、不切写、不双写、不删表、不加列、不加迁移。
- 不新增 ADR / 风险条目 / 评审文档；决策记在这份计划里，现状记在 11。
- 不启动谱书编目与排版功能实现（那是另立 spec 的产品主线，也是本计划的启动闸门）。
