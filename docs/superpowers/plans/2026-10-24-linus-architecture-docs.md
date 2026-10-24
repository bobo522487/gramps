# /docs 架构文档治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Linus 的尺子把 `/docs` 的架构文档收成一套“单一事实源 + 可执行约束”：删掉与代码相反的陈述，消除同一事实的多处副本，把仍然成立的约束接到 `pnpm docs:check` 上。

**Architecture:** 保留现有目录（`architecture/`、`decisions/`、`guides/`），不做大搬迁。文档分三层：目标（`architecture/`、`prd.md`、`data-model.md`、`api.md`）、当前（`implementation-status.md`）、决策（`decisions/`）。目标文档只描述目标；当前事实只在 `implementation-status.md`；已解决的待决策转为决策记录。新增一个零依赖的 `scripts/check-docs.mjs`，检查相对链接、过期路径、矛盾措辞与文档头契约。

**Tech Stack:** Markdown · Node 22 ESM · pnpm · GitHub Actions · Biome（现有）

**Spec:** [2026-10-24 Linus 架构评审](../../reviews/2026-10-24-linus-architecture-review.md) §7（文档反向漂移）· [2026-10-22 架构对标与文档结构评审](../../reviews/2026-10-22-architecture-benchmark-and-doc-structure.md) §5–§6（单一事实源、文档契约、可执行约束）

---

## 0. 结论（先看这七条）

1. **文档在说一套做一套。** `README.md` 说“目标文档不写状态”，但 `00-overview`、`02-context`、`03-components`、`04-runtime`、`06-crosscutting` 都在正文里写“当前实现是……”。状态因此有 5 个副本。
2. **最危险的错误不是遗漏，是可直接照抄的错模板。** `data-model.md §12.5` 的 `FOR ALL` 裸子查询会让 viewer 获得写权限、让已移除成员继续可读；`add-a-feature.md` 的 Action 示例从客户端 `orgSlug` 取组织；`04-runtime.md` 要求“一次页面渲染只开一个事务”。这三条都会被下一个开发者照抄。
3. **目标文档里有已经证明错误的目标。** “1 个 Route Handler”“M1 没有公开页面”“`src/modules` 三层”“G3 ≤3 个文件”“99.5% 可用性可测量”都与代码或测量能力相反。目标错了就改目标，不要用“待决策”把它供起来。
4. **最有效的动作是删除。** 删 `README` 的当前快照、删 `08-evolution §15` 的重复待决策表、删 `03-components` 的虚构模块/三层、删 `data-model` 的错误 SQL 模板、删 `api.md` 的 `ActionResult` 与不存在的 `lib/error-ui.ts`。
5. **最有效的新增只有一条：`pnpm docs:check`。** 文档已经写了“提交前检查链接与命令”，但没有任何东西执行它。没有执行的约束不是约束，是愿望。
6. **单一事实源要落到“谁拥有什么”。** 表结构与 RLS 的权威是迁移；Action 契约的权威是 `lib/auth/types.ts`；当前状态的权威是 `implementation-status.md`；目标文档只做解释和链接。
7. **不做大重构。** 不搬 `docs/product/`、不新增术语表、不重写 `reviews/`、不改产品代码。只做能独立回滚的小补丁。

### 0.1 Linus 尺子 → 文档动作

| # | 原则 | 本计划的动作 |
|---|---|---|
| L1 | 数据结构优先于代码 | 每个事实只有一个权威位置；目标/当前/决策三层分离 |
| L2 | 好品味 = 消除特例 | 删掉“当前实现 4 个”“目标 1 个”这类双口径；统一为 4 个 |
| L3 | 复杂即敌 | 删重复的写路径、拓扑图、待决策表、RLS 模板 |
| L4 | 理论服从实践 | “一次渲染一个事务”改为“一个渲染单元一个事务”；`orgSlug` 授权改为 UUID + 事务内复核 |
| L5 | 不破坏用户空间 | 不搬目录、不改章节号、不改产品代码；文档中的链接保持可用 |
| L6 | Talk is cheap, show me the check | 新增 `scripts/check-docs.mjs`，CI 执行 `pnpm docs:check --strict` |
| L7 | 让约束可执行 | 链接、过期路径、矛盾措辞、文档头、待决策残留全部脚本化 |
| L8 | 一次一个补丁 | 10 个独立 commit；每个任务只改一组文档 |

---

## 1. File Structure

| 文件 | 职责 | 本计划怎么改 |
|---|---|---|
| `docs/README.md` | 文档地图 + 阅读路径 | 删“当前仓库速览”；修决策索引/断链；加 `docs:check` |
| `docs/architect.md` | 跳转页 | 修正“内容保持不变”的假声明 |
| `docs/architecture/00-overview.md` | 一页纸 | 统一表数、公开页面、Route Handler；删重复写路径 |
| `docs/architecture/01-drivers.md` | 目标与约束 | 修 G2/G3/G5/G6，让每条目标有判据或标注未验证 |
| `docs/architecture/02-context.md` | 上下文与部署 | 统一 11 张表、4 个 Route Handler |
| `docs/architecture/03-components.md` | 组件与分层 | 用 `lib/<domain>` 垂直切片替换 `src/modules` 三层 |
| `docs/architecture/04-runtime.md` | 读写路径与前端 | 修 proxy 语义、路由、Action 模式、事务口径、公开页 |
| `docs/architecture/05-data.md` | 数据架构 | RLS 改为 `has_org_role`；说明边约束缺口 |
| `docs/architecture/06-crosscutting.md` | 配置/错误/日志/安全 | 删伪代码文件；统一错误模型；修可观测性矛盾 |
| `docs/architecture/07-quality.md` | 质量与验证 | 指标加证据/状态；fitness function 分已执行/未执行 |
| `docs/architecture/08-evolution.md` | 路线与风险 | 修 M1/M2 口径；删重复待决策表 |
| `docs/decisions/README.md` | 决策索引 | 解决 D-1/D-2/D-3/D-5/D-7；加 ADR 0008 |
| `docs/decisions/0004-soft-delete-forever.md` | 软删决策 | 修正“10 张表都软删”的事实错误 |
| `docs/decisions/0005-zero-background-jobs.md` | 零后台任务 | 修正“JWT 自带 exp”的过期事实 |
| `docs/decisions/0006-rls-isolation.md` | RLS 决策 | 修正 BYPASSRLS 前提与 `auth_service` 策略 |
| `docs/decisions/0008-read-only-route-handlers.md` | 新 ADR | 保留 4 个只读 Route Handler |
| `docs/data-model.md` | 数据参考 | 补 `activity_logs`；RLS 指向迁移；修 `withOrg` 签名 |
| `docs/api.md` | Action/Route 契约 | `ActionState`、UUID scope、4 个 Handler、实际健康响应 |
| `docs/prd.md` | 产品需求 | 修 URL、公开页、容量口径、过期开放问题 |
| `docs/implementation-status.md` | 唯一当前状态源 | 修 FR-ORG-8 状态；登记日志/根布局风险 |
| `docs/guides/add-a-feature.md` | 新增实体 how-to | 修 Action 授权模板、事务口径、断链 |
| `docs/guides/testing.md` | 测试 how-to | 加 `pnpm docs:check` |
| `docs/setup.md` | 本地教程 | 命令表加 `pnpm docs:check` |
| `scripts/check-docs.mjs` | 文档 fitness function | 新增，零依赖 |
| `package.json` | 命令 | 加 `docs:check` |
| `.github/workflows/ci.yml` | CI | 加 strict 检查 |

**不在这份计划里：** `docs/reviews/**`（历史，不改）、`AGENTS.md`（单独 PR）、代码/迁移修复（见 2026-10-24 评审 §8）。`AGENTS.md` 的后续必改项：§5.6 与 §12 仍把 4 个只读 Route Handler 称为“过渡”，ADR 0008 接受后应改为“正式设计”。

---

## 2. Global Constraints

- 只改 `/docs`、`scripts/check-docs.mjs`、`package.json`、`.github/workflows/ci.yml`；不改 `app/`、`lib/`、迁移与测试。
- 保留 `architecture/` 的章节编号（§1–§15），避免破坏外部引用“architect §N”。
- 目标文档不写当前状态、数量、测试统计；这些只在 `implementation-status.md`。
- 相对链接必须指向真实文件与真实标题；锚点按 GitHub 规则校验。
- 中文文案；代码标识符、文件名、命令保持英文。
- 每个任务单独 commit；迁移与业务代码不在本计划内。
- 以下 canonical facts 在所有文档中必须一致：
  - **组织级业务表 11 张** = 10 张业务表（8 张软删实体 + `organization_member`/`invite` 硬删除）+ `activity_logs`（活动流，无软删）。
  - **Route Handler 4 个** = `/api/health` + `/api/orgs` + `/api/orgs/[orgId]/projects` + `/api/user`；保留，不收敛为 Server Action。
  - **公开页面** = 营销首页 `/`、登录 `/sign-in`、注册 `/sign-up`；没有匿名业务数据页、分享页或公开 API。
  - **控制台路由** = `/dashboard/org/[orgSlug]` 与 `/dashboard/project/[projectRef]` 两套独立 scope；不使用 `/{orgSlug}/{projectRef}` 嵌套路由。
  - **RLS** = `auth.has_org_role(organization_id, roles[])`；SELECT 含 viewer，INSERT/UPDATE 不含；`activity_logs` 另有 `user_id = auth.uid()` 策略。
  - **Action** = `validatedActionWithUser` + `ActionState`；事务内按 `userId + orgId` 复核权限；写后 `revalidatePath`。项目里没有 `revalidateTag` 调用。
  - **会话** = Better Auth 数据库会话；`proxy.ts` 只检查 Cookie 是否存在；权威校验与滑动续期在 `getSessionUser()`。
  - **代码组织** = `app/` + `components/` + `lib/<domain>/` 垂直切片；不采用 `src/modules/` 与强制 `*.service.ts` / `*.repo.ts` 三层。
- 如果执行期间 `0006_statement_timeouts.sql` 被合并，`implementation-status.md` 的迁移数量同步为 7；未提交的迁移不算“当前状态”。

---

## 3. Review Focus

以下五类输入/条件没有现成测试，但最容易被文档误导；每个都在对应任务里有一条可执行检查。

1. **RLS 模板被照抄**：开发者新增表时复制 `data-model.md` 的 `FOR ALL` 裸子查询，结果 viewer 能写、已移除成员仍能读。检查：`docs:check` 禁止裸 `organization_member` 子查询；Task 6 把权威指向迁移。
2. **Action 从客户端拿公开 ID**：开发者照抄 `add-a-feature.md` 的 `requireOrgContext(data.orgSlug)`，把公开 ID 当成组织来源。检查：`docs:check` 禁止该片段；Task 7 改为 UUID + 事务内复核。
3. **“一次页面渲染一个事务”被实现**：开发者用 AsyncLocalStorage 把事务横跨 layout/page，长时间占用连接。检查：`docs:check` 禁止该短语；Task 5 改为“一个渲染单元一个事务”。
4. **“没有公开页面”被当真**：有人给 `/` 加登录门禁或删掉营销页。检查：`docs:check` 禁止该短语；Task 4/9 明确三类公开页面。
5. **表数/目录/缓存机制漂移**：新增第 12 张表或 `src/modules/`，或按文档写了永远不生效的 `revalidateTag`。检查：`docs:check` 禁止 `src/modules/`、`revalidateTag` 与旧表数口径；Task 5/6 统一 canonical facts。

---

## 4. Tasks

### Task 1: 文档一致性检查器（先报告，不拦 CI）

**Files:**
- Create: `scripts/check-docs.mjs`
- Modify: `package.json`（`scripts` 增加 `"docs:check": "node scripts/check-docs.mjs"`）

**Interfaces:**
- Consumes: 无
- Produces: `pnpm docs:check`（报告模式，发现问题也 exit 0）；`pnpm docs:check --strict`（发现问题 exit 1）。后续任务用它验收。

- [ ] **Step 1: 写 `scripts/check-docs.mjs`**

零依赖 Node ESM，从仓库根运行。实现以下规则；输出格式统一为 `path:line: [rule] message`。

```js
// 伪代码级契约；实现时按此结构写完整脚本
const RULES = {
  link: '相对链接必须存在；.md#anchor 的锚点必须匹配标题',
  stalePath: '禁止 docs/status/、docs/adr/、docs/product/glossary.md、src/modules/',
  contradiction: [
    'M1 没有公开页面',
    '目标收敛为 Server Action',
    '目标 1 个 / 当前 4 个',
    '1 个 Route Handler',
    '一次页面渲染只开一个事务',
    'revalidateTag',
    'requireOrgContext(data.orgSlug)',
    'ActionResult',
    'lib/error-ui.ts',
    'organization_id IN (SELECT ... FROM organization_member',
    '目标 10 张业务表',
    '10 张业务表 + 4 张',
  ],
  header: 'docs/architecture/*.md 必须含：回答什么问题 / 读者 / 长度上限 /（目标 vs 现状 或 本文档为新增）',
  pending: 'decisions/README.md 的“待决策”段中，以 | D-N | 开头的表格行不得再出现 D-1/D-2/D-3/D-5/D-7',
};
```

实现细节（避免歧义）：
- 扫描 `docs/**/*.md`，跳过 `docs/reviews/**` 与 `docs/superpowers/**`（历史与计划允许引用反例）。
- 链接解析：忽略 `http(s):`、`mailto:`、纯 `#`；对其余 `[](target)`，按当前文件目录解析。`target` 含 `#anchor` 时，读目标 Markdown 的标题，按 GitHub 近似 slug 比较：小写、去反引号、去标点、空格转 `-`、保留中日韩字符与数字。目录链接接受目录存在。
- 矛盾措辞：对 `docs/README.md`、`docs/architect.md`、`docs/architecture/**`、`docs/decisions/**`、`docs/guides/**`、`docs/data-model.md`、`docs/api.md`、`docs/prd.md`、`docs/implementation-status.md` 执行；`setup.md`、`ops-target.md` 只做链接检查。
- `organization_id IN (SELECT ... FROM organization_member` 用多行正则，跨行匹配也算。
- `10 张业务表 + 4 张` 与 `目标 10 张业务表` 是旧口径；允许“10 张业务表（8 张软删 + 2 张硬删）+ activity_logs”这类新口径。
- 待决策：截取 `decisions/README.md` 的 `## 待决策` 到下一个 `##` 之间的文本，只匹配以 `| D-` 开头的表格行；D-1/D-2/D-3/D-5/D-7 出现在“已解决”叙述里不报错。
- 默认模式打印 `N issue(s)` 并 `process.exit(0)`；`--strict` 时 exit 1。

- [ ] **Step 2: 加 package 命令**

```json
"docs:check": "node scripts/check-docs.mjs"
```

- [ ] **Step 3: 跑报告模式，确认它抓到了已知问题**

Run: `pnpm docs:check`
Expected: 至少出现这些类别的问题：
- `docs/README.md` 指向不存在的 `docs/adr/`；
- `docs/guides/add-a-feature.md` 指向 `docs/status/implementation-status.md` 与 `docs/product/glossary.md`；
- `docs/architecture/03-components.md` 含 `src/modules/`；
- `docs/architecture/04-runtime.md` 含“一次页面渲染只开一个事务”；
- `docs/data-model.md` 含裸 `organization_member` 子查询与 `src/server/db`；
- `docs/decisions/README.md` 待决策段含 D-1/D-2/D-3/D-5/D-7。

- [ ] **Step 4: 跑 strict，确认它会失败**

Run: `pnpm docs:check --strict`
Expected: exit 1，且问题列表与 Step 3 一致。

- [ ] **Step 5: Commit**

```bash
git add scripts/check-docs.mjs package.json
git commit -m "chore(docs): 添加文档一致性检查"
```

---

### Task 2: 把已定的结构决策落成记录

**Files:**
- Create: `docs/decisions/0008-read-only-route-handlers.md`
- Modify: `docs/decisions/README.md`

**Interfaces:**
- Consumes: 2026-10-24 评审 §2 保护线第 8 条、ADR 0007 中性第 3 条。
- Produces: ADR 0008；`decisions/README.md` 的待决策只剩 D-4/D-6；后续文档统一引用 ADR 0008。

- [ ] **Step 1: 写 ADR 0008**

文件 `docs/decisions/0008-read-only-route-handlers.md`，结构按 `decisions/README.md` 的 ADR 模板：

```markdown
# 0008. 保留只读 Route Handler 作为工作区刷新通道

- **状态**：已接受
- **日期**：2026-10-24
- **可逆性**：双向门
- **相关**：[02-context §3](../architecture/02-context.md) · [03-components §7.4](../architecture/03-components.md) · [04-runtime §6.2](../architecture/04-runtime.md) · [api §1](../api.md) · [ADR 0007](./0007-self-hosted-better-auth.md)

## 背景

当前 3 个工作区读端点 + `/api/health` 都是只读 GET。原目标要求“读收敛为 Server Action”，理由是减少 Route Handler 数量。但 Server Action 本质是 POST：不可缓存、不可预取，Next 会串行化，且按路由聚合 p95 失去意义。ADR 0007 已记录“现有 4 个只读 Route Handler 不变”。

## 决策

保留 4 个只读 Route Handler：`/api/health`、`/api/orgs`、`/api/orgs/[orgId]/projects`、`/api/user`。工作区需要新的客户端刷新读时，可以新增只读 GET Handler。写操作仍只走 Server Action；不新增 `/api/auth/*`。

## 后果

### 正面
- 读请求可缓存、可预取、按路由观测。
- 写入口保持单一（Server Action），不把认证/租户写暴露成 HTTP 端点。

### 负面
- 每个端点要自己处理 401、参数校验、成员校验与 DTO。
- 多一份只读契约要维护；用显式 DTO，不返回整行记录。

### 中性
- “Route Handler 只有 1 个”不再是目标；数量由真实读需求决定。

## 放弃的方案

| 方案 | 为什么不够好 |
|---|---|
| 读也走 Server Action | POST 不可缓存/预取，Next 串行化，路由级 p95 失真 |
| tRPC / GraphQL / 公开 REST | 没有外部消费者；多维护一份契约，收益为零 |

## 重估触发条件

- TanStack Query 被移除，客户端只依赖 RSC；
- Next 提供与 GET 等价的 RSC 刷新/缓存语义；
- 出现第三方消费者，需要正式的公开 API 契约。
```

- [ ] **Step 2: 更新决策索引**

在 `docs/decisions/README.md` 做这些精确修改：

1. `ADR-01` 结论改为：`模块化单体 + lib/<domain> 垂直切片；不采用 src/modules 三层`。
2. `ADR-03` 结论改为：`/api/health + 3 个只读刷新端点（共 4 个，保留）`；正式 ADR 列改为 `[0008](./0008-read-only-route-handlers.md)`。
3. `## 2. 正式 ADR` 表增加一行 0008（主题：保留只读 Route Handler；理由：读缓存/预取/路由级可观测）。
4. 该表下的“其余 14 条”改为“其余 13 条”。
5. `## 待决策` 段删除 D-1、D-2、D-3、D-5、D-7，只保留 D-4、D-6。
6. 在待决策表前加一段“已解决”列表：
   - D-1/D-3 → ADR-01（`lib/<domain>` 垂直切片）
   - D-2 → ADR 0008
   - D-5 → `01-drivers` G3 改为“≤5 个源文件 + 1 个迁移 + 1 处状态更新”
   - D-7 → `api.md` 采用 `ActionState`（定义在 `lib/auth/types.ts`）
7. 把“决策后转为 ADR，并从 [08-evolution §15](../architecture/08-evolution.md#15-待决策项) 与本表同时移除”改为“决策后转为 ADR，并从本表移除；`08-evolution` 只链接本表”。

- [ ] **Step 3: 验证**

Run: `rg -n "D-[12357]" docs/decisions/README.md`
Expected: 只出现在“已解决”说明中，不再出现在待决策表。

Run: `test -f docs/decisions/0008-read-only-route-handlers.md && rg -n "0008" docs/decisions/README.md`
Expected: 文件存在，索引含 0008。

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/README.md docs/decisions/0008-read-only-route-handlers.md
git commit -m "docs(decisions): 记录读通道与代码组织决策"
```

---

### Task 3: 入口文档只做地图，状态只留一处

**Files:**
- Modify: `docs/README.md:84-113`（当前仓库速览）、`:25-67`（文档地图）、`:150-166`（维护规则）
- Modify: `docs/architect.md:1-5`
- Modify: `docs/implementation-status.md:120-152`、`:188-201`、`:219-224`

**Interfaces:**
- Consumes: canonical facts（Global Constraints）。
- Produces: `README.md` 不再含当前值/测试数字；`implementation-status.md` 是唯一状态源；`docs:check` 的链接与待决策规则开始收敛。

- [ ] **Step 1: 删掉 README 的当前快照**

把 `docs/README.md §4 当前仓库速览` 整节替换为：

```markdown
## 4. 当前状态

本文件不再维护“当前值”快照。框架版本、表数、Route Handler、测试数量与已实现功能，一律以 [implementation-status](./implementation-status.md) 为准。

需要产品背景读 [PRD](./prd.md)；需要架构目标读 [architecture/](./architecture/00-overview.md)；需要本地命令读 [setup](./setup.md)。
```

这一步会删掉过期的 `13 个文件 / 73 个用例`、`12 个文件 / 134 个用例`、`E2E 1 条` 等数字。

- [ ] **Step 2: 修文档地图与维护规则**

`docs/README.md`：

1. 文档树里删掉 `adr/` 这一行。
2. `decisions/` 行改为：`决策索引（21 条）+ 8 篇正式 ADR`。
3. 树里补上 `0007-self-hosted-better-auth.md` 与 `0008-read-only-route-handlers.md`。
4. §5.1 单一事实源表增加一行：`实现状态、表/Route Handler 数量、测试统计 | implementation-status.md`。
5. §5.4 的“新增 / 删除表、Action、Route Handler”一行改为只更新 `implementation-status.md §1 + 对应 FR 行`，删掉“本文件 §4 速览”。
6. §5.4 的“解决一个待决策项”一行改为：`从 decisions/README 待决策表移除，转为 ADR 或更新目标文档`。
7. §5.5 增加一条：`pnpm docs:check`（链接、锚点、过期路径、矛盾措辞、文档头）。

- [ ] **Step 3: 修正 `architect.md` 的假声明**

把文件头部的：

> 内容与章节编号**保持不变**

改为：

> **章节编号保持与原文档一致；正文已按当前实现与 ADR 0007/0008 校正（2026-10-24）。**

- [ ] **Step 4: 修 `implementation-status.md` 的一处假“已实现”和三条缺失风险**

1. `§3.2 FR-ORG-8` 的状态从“已实现”改为“部分实现”，当前行为写：
   `归档写入 status='closed' + deleted_at（auth.archive_organization）；schema 支持 suspended，但没有独立的停用入口。`
2. `§5 已知实现风险` 追加三条（编号顺延）：
   - **活动日志语义不一致**：谱系写入在业务事务内（日志失败会回滚业务），组织写入在提交后（失败只告警）。目标语义是“日志尽力而为、不回滚业务”；差异见 2026-10-24 评审 P1-10。
   - **根布局读取会话与组织**：`app/layout.tsx` 对每个请求查会话与组织，营销页因此动态渲染；这是营销页无法静态化的直接原因，见评审 P1-9。
   - **缓存失效范围过宽**：谱系 Action 仍调用 `revalidateProject()`，影响整个 dashboard 路由树；精确到项目/谱系的失效需要 Action 拿到 `projectRef`，见评审 P1-8。
3. `§7 更新规则` 删掉“同步更新 README 的当前仓库速览”，只保留本文件与对应 FR 行。

- [ ] **Step 5: 验证**

Run: `rg -n "13 个文件|73 个用例|134 个用例|当前仓库速览|docs/adr" docs/README.md`
Expected: 无输出。

Run: `rg -n "FR-ORG-8|活动日志语义|根布局读取|缓存失效范围" docs/implementation-status.md`
Expected: FR-ORG-8 显示“部分实现”；三条风险存在。

Run: `pnpm docs:check`
Expected: README 的 `docs/adr/` 与测试数字相关问题消失；待决策问题仍在（Task 2 后应已消失）。

- [ ] **Step 6: Commit**

```bash
git add docs/README.md docs/architect.md docs/implementation-status.md
git commit -m "docs: 收敛入口文档与状态来源"
```

---

### Task 4: 总览与部署视图对齐事实

**Files:**
- Modify: `docs/architecture/00-overview.md:12-147`
- Modify: `docs/architecture/02-context.md:32-122`

**Interfaces:**
- Consumes: Task 2 的 ADR 0008；canonical facts。
- Produces: 00/02 不再出现“1 个 Route Handler”“10 张业务表”“M1 没有匿名访问者”；写路径只在 04-runtime 出现。

- [ ] **Step 1: 修 `00-overview.md`**

1. §1.1 最后一段改为：

```markdown
**公开页面只有营销首页 `/`、登录 `/sign-in` 与注册 `/sign-up`；没有匿名业务数据页、分享页或公开 API。** M2 引入分享后才出现“族内读者”角色。
```

2. §1.2 mermaid：
   - `MOD` 节点改为 `业务域<br/>auth · org · project · folder<br/>lineage（article/book 目标域）`；
   - `PUB` 节点改为 `public schema<br/>11 张组织级业务表<br/>FORCE ROW LEVEL SECURITY`。
3. §1.3 整段替换为：

```markdown
### 1.3 一次写请求的路径

> **权威描述在 [04-runtime §5.2](./04-runtime.md)。** 一句话：Zod 校验 → `validatedActionWithUser` → `withOrg` 事务内复核权限 → 业务写入 → 精确 `revalidatePath` → `ActionState`。
```

4. §2 第 9 条改为：

```markdown
| 9 | 11 张组织级业务表 = 10 张业务表（8 张软删实体 + `organization_member`/`invite` 硬删除）+ `activity_logs`（活动流，无软删） | [data-model §2](../data-model.md) |
```

5. §3 的“不做”表保持；但把“公开 REST API”一行的理由补一句：`只保留 4 个只读 GET（ADR 0008）`。

- [ ] **Step 2: 修 `02-context.md`**

0. §2 末尾的“M1 没有匿名访问者……”整段改为：`公开页面只有营销首页、登录/注册；没有匿名业务数据页、分享页或公开 API。M2 引入分享后才出现“族内读者”角色。`
1. §2 外部角色表 `Neon` 行：`10 张业务表` → `11 张组织级业务表`。
2. §3 部署视图：
   - `Route Handler  1 个：/api/health` → `Route Handler  4 个：/api/health + 3 个只读刷新`；
   - `public schema：10 张业务表` → `public schema：11 张组织级业务表`；
   - `仓储层（Drizzle；…）` → `查询层（Drizzle；…）`。
3. §3.2 表：
   - `对外接口` 行改为 `4 个只读 Route Handler（1 个健康检查 + 3 个工作区刷新）`，依据写 `ADR 0008`。
4. 删除 §3.2 下面整段“关于「1 个 Route Handler」”的注释（目标/当前双口径 + 待决策 D-2）。
5. §10 环境缺口保留；把“建议补一套 Vercel Preview + Neon 分支”链接到 `08-evolution R16` 即可。

- [ ] **Step 3: 验证**

Run: `rg -n "1 个 Route Handler|目标 1 个|M1 没有匿名访问者" docs/architecture/00-overview.md docs/architecture/02-context.md`
Expected: 无输出。

Run: `rg -n "10 张业务表 \\+ 4 张|目标 10 张业务表" docs/architecture/00-overview.md docs/architecture/02-context.md`
Expected: 无输出；canonical 行“10 张业务表（8 张软删 + 2 张硬删）+ activity_logs”允许存在。

Run: `rg -n "revalidateTag|requireOrgContext\\(data\\.orgSlug\\)" docs/architecture/00-overview.md docs/architecture/02-context.md`
Expected: 无输出。

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/00-overview.md docs/architecture/02-context.md
git commit -m "docs(architecture): 校正总览与部署视图"
```

---

### Task 5: 组件与运行时用真实代码组织

**Files:**
- Modify: `docs/architecture/03-components.md:10-136`
- Modify: `docs/architecture/04-runtime.md:10-193`

**Interfaces:**
- Consumes: ADR 0008、canonical facts、`lib/auth/context.ts`、`lib/db/drizzle.ts`、`proxy.ts`。
- Produces: 03/04 不再出现 `src/modules`、`*.service.ts`/`*.repo.ts` 三层、`revalidateTag`、`orgSlug` Action、“一次渲染一个事务”。

- [ ] **Step 1: 重写 `03-components.md` 的目录与分层**

1. §4.1 的 `src/` 树替换为：

```text
app/                 路由、RSC 页面、Route Handler
components/          console / lineage / org / project / marketing / ui
lib/
├── auth/            会话、权限、Better Auth Action 包装
├── org/             组织 Action
├── project/         项目 Action
├── folder/          分类树 Action 与事务
├── lineage/         谱系/人丁 Action、事务服务、导航缓存
├── genealogy/       家谱 Zod schema
└── db/              schema、queries、drizzle、migrations
```

2. 删除 §4.1 下的“目录偏差”注释，改为一句：`这是已采用的代码组织，不是过渡态；代码组织决策见 ADR-01，读通道决策见 ADR 0008。`
3. §4.2 表：
   - 增加 `activity_logs` 行，owner 写 `organization`，说明“账号级事件 org 为空；不是审计表”；
   - `organization_member`/`invite` 的“对外导出”改为“读查询；写由 Better Auth `auth_service` 执行”；
   - “对外导出”列删除 `organizationService`、`lineageService`、`nodeService` 这类不存在的名字，改为实际入口：`lib/db/queries/<domain>.ts` 的查询函数与 `lib/<domain>/actions.ts`。
4. §4.3 的依赖图替换为三条规则，不画虚构模块图：
   - `app/` 与 `components/` 只能 import `lib/<domain>` 的公开函数；
   - `lib/<domain>` 可以 import `lib/db/queries` 与 `lib/auth`，不得 import `app/` 或 `components/`；
   - `lib/db` 不得 import 任何 `lib/<domain>/actions.ts`。
5. §4.4 的固定三层表替换为：

```markdown
默认**垂直切片**：一个域一个目录，schema/query/action/页面就近放。只有满足以下任一条件才抽独立 service：

1. 同一规则被 ≥2 个入口调用；
2. 需要跨模块共享事务；
3. 需要被后台任务复用（M1 后台任务为 0）。

不再要求固定的 service/repo 三层文件；读走 `lib/db/queries/`，多步写走 `lib/<domain>/*-services.ts` 或 `lib/db/services.ts`。
```

6. §7.1 的规则表改为“规则 | 当前执行方式”：

```markdown
| 规则 | 当前执行方式 |
|---|---|
| 客户端组件不得 import `@/lib/db/*` | `server-only` + 评审；Biome `noRestrictedImports` 待接入（评审 P1-12） |
| `lib/db/queries/**` 不得 import Actions | 评审；Biome 规则待接入 |
| 只有 `lib/db/drizzle.ts` 建立连接 | 评审 + import 约定 |
| 认证读写只走 `lib/auth/better-auth.ts` / `lib/db/auth-db.ts` | 运行时角色边界 + 评审 |
```

7. 把 §7.2 整段替换为：`一个写入口 = 一个事务；事务由 Action 或 *-services.ts 打开，同一流程只开一次；*Tx 变体只接收已有事务，不再开新事务；读路径按渲染单元合并（见 04-runtime §5.1）。`
8. §7.3 表格里“行锁 `SELECT ... FOR UPDATE` 写在 repo 内”改为“写在 query 或事务服务内”；删除“repo”这个词。
9. §7.4 表 `Route Handler` 行改为：`健康检查 + 工作区只读刷新 | 4 个（ADR 0008）`；删除下面“读通道待决策”整段。

- [ ] **Step 2: 重写 `04-runtime.md` 的读路径与写路径**

1. §5.1 的读路径替换为：

```text
GET /dashboard/project/[projectRef]/lineages/[lineageId]
  ├─ proxy.ts            只检查 session cookie 是否存在（乐观门禁）
  ├─ project layout      requireProjectContext(projectRef) → 内部 projectId/orgId
  ├─ lineages layout     getNavFolders / getNavLineages（React cache）
  ├─ page.tsx            getLineageById + getNodes
  │    └─ withOrg(userId) SET LOCAL ROLE app_rw + set_config(claims)
  └─ RSC 直出；首屏数据注入 TanStack Query
```

2. 读路径说明改为：
   - `proxy.ts` 不验签、不滑动续期；权威校验与 7 天/1 天 `updateAge` 由 `getSessionUser()` 调 `auth.api.getSession` 完成。
   - 两条性能约束改为：

```markdown
| 约束 | 为什么 |
|---|---|
| **同一渲染单元**的查询合并为一个事务 | `withOrg` 每开一次事务至少 5 个往返（BEGIN / SET LOCAL ROLE / set_config / 查询 / COMMIT）。布局与页面由 Next 独立渲染，不共享事务；不要用 AsyncLocalStorage 把事务横跨整个渲染周期。 |
| 上下文解析一次，页面复用 | `getSessionUser`、`requireOrgContext`、`requireProjectContext` 已用 React `cache()` 做请求级记忆化 |
```

3. §5.2 写路径替换为：

```text
用户提交表单
  │
  ├─ action.ts        Zod 校验（validatedActionWithUser）
  ├─ withOrg(user.id, tx => ...)
  │    └─ 事务内 getOrgRoleInTx + hasPermission 复核
  ├─ 业务写入
  ├─ revalidatePath(具体路径)
  └─ ActionState（error / success / fieldErrors / code）
```

并在下面加一句：`Action 的 orgId/projectId 是服务端解析出的内部 UUID；公开 ID 只用于 URL 与页面解析，不能作为 Action 的授权依据。`
4. §5.3 的组织解析代码改为实际签名：`withOrg(user.id, tx => ...)`，查询函数写 `getOrgWithRoleBySlug` / `getProjectScopeByRef`；说明两套控制台路由：`/dashboard/org/[orgSlug]` 与 `/dashboard/project/[projectRef]`，项目路由不嵌套在组织路由下。
5. §6.1 的“M1 没有公开页面”改为：

```markdown
公开页面：营销首页 `/`、登录 `/sign-in`、注册 `/sign-up`。M1 没有匿名业务数据页、分享页或公开 API；内部页面需要会话。
```

6. §6.2 的读通道表述改为：`queryFn 调用 4 个只读 Route Handler；mutationFn 调用 Server Action。写后按数据来源选择 invalidateQueries 或 revalidatePath，最多两者，不要三套一起上。`
7. §6.2 里所有 `revalidateTag` 改为 `revalidatePath`。
8. §6.4 的组件分层替换为实际目录：`console/`、`lineage/`、`org/`、`project/`、`marketing/`、`ui/`；删除 `form/`、`layout/`、`domain/` 这三个不存在的目录。

- [ ] **Step 3: 验证**

Run: `rg -n "src/modules|\\*\\.service\\.ts|\\*\\.repo\\.ts|revalidateTag|requireOrgContext\\(data\\.orgSlug\\)|验签会话|6h|M1 没有公开页面|一次页面渲染只开一个事务" docs/architecture/03-components.md docs/architecture/04-runtime.md`
Expected: 无输出。

Run: `rg -n "getOrgWithRoleBySlug|getProjectScopeByRef|/dashboard/project/\\[projectRef\\]" docs/architecture/04-runtime.md`
Expected: 出现实际路由与 helper 名称。

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/03-components.md docs/architecture/04-runtime.md
git commit -m "docs(architecture): 对齐组件与运行时"
```

---

### Task 6: 数据文档以迁移为准，补上 activity_logs

**Files:**
- Modify: `docs/architecture/05-data.md:12-78`
- Modify: `docs/data-model.md:5-12`、`:44-57`、`:109-128`、`:358-385`、`:427-496`、`:667-680`、`:747-890`、`:932-944`

**Interfaces:**
- Consumes: `lib/db/migrations/0001_auth_rls.sql`、`0003_better_auth.sql`、`lib/db/drizzle.ts`、`lib/db/schema.ts`。
- Produces: 11 张表的精确清单；RLS 摘要与迁移一致；`withOrg` 签名正确；边约束缺口显式记录。

- [ ] **Step 1: 修 `05-data.md`**

0. 文件头补一行：`> **目标 vs 现状**：本文描述目标架构。差异见 [实现状态](../implementation-status.md)。`
1. §8.1 表 `结构化数据` 行改为：`11 张组织级业务表（10 张业务表 + activity_logs）+ 4 张 auth.* 表`。
2. §8.2 的“RLS 策略基于 `organization_member` 子查询”改为：

```markdown
RLS 统一通过 `auth.has_org_role(organization_id, roles[])` 判断成员与角色；SELECT 含 `viewer`，INSERT/UPDATE 只含 `owner`/`admin`/`editor`；`organization`/`organization_member`/`invite` 的写权限属于 `auth_service`。
```

3. §8.2 下面“迁移角色必须 BYPASSRLS”的段落改为：

```markdown
> **运行前提不是 BYPASSRLS。** 迁移/管理连接用所有者角色执行 DDL；运行期必须降权到 `app_rw`（业务）或 `auth_service`（认证/租户）。`auth_service` 通过显式 `FOR ALL USING (true)` 策略写 `auth.*` 与组织/成员/邀请；`app_rw` 仍受 RLS 约束。详见 [ADR 0006](../decisions/0006-rls-isolation.md) 的 2026-10-24 修订。
```

4. §8.4 `编目引用` 行改为：`对 article/lineage 的引用是 RESTRICT；book/book_catalog 的父引用是 CASCADE，但 app_rw 无 DELETE，级联在应用路径不触发。`
5. §8.6 保留隐私缺口，链接 R18；补一句：`这是产品/合规决策，不是 M1 录入功能的前置。`

- [ ] **Step 2: 修 `data-model.md` 的表清单**

1. 文件头 `表数量` 改为：`11 张组织级业务表（10 张业务表 + activity_logs）+ 4 张 auth.* 表`。
2. §1.2 的“10 张业务表与 4 张 auth”改为 canonical 表述。
3. §1.3 的公共列说明改为：
   - 8 张软删实体表（organization/project/folder/lineage/node/article/book/book_catalog）含 `deleted_at`；
   - `organization_member`/`invite` 是硬删除，不含软删列；
   - `activity_logs` 是产品活动流，不含 `deleted_at`，账号级事件 `organization_id` 为空。
4. §2.1 层级图在 `organization` 下补 `activity_logs`（标注“账号级事件 org 为空”）。
5. §2.2 表增加第 11 行：`activity_logs | 产品活动流 | organization`。
6. §5.2 `folder.parent_id` 的说明保留“不设外键”，但补一句：`这是已登记缺口（评审 P0-1）：跨 project 的父节点在 DB 层合法，不要声称 schema 层已完全阻断跨组织引用。`
7. §6.2 `node` 表后补一段：

```markdown
**边约束的已知缺口**：`parent_id` / `mother_id` / `spouse_of_id` 目前只引用 `node(id)`，没有带 `(organization_id, lineage_id)` 的复合外键。复合外键覆盖的是 node→lineage 这一层，不是 node→node 的边。评审 P0-1 已给出补丁；在迁移落地前，不要把“三层防护”表述成“每条边都被 schema 完全约束”。
```

8. §11.1 的软删表清单保持 8 张实体表，明确写“8 张”；补一行 `activity_logs` “无软删”，并说明 `organization_member`/`invite` 由 Better Auth 硬删除。
9. §12.2：
   - `withOrg` 代码签名改为 `withOrg(userId: string, fn)`；
   - 标题“迁移角色绕过 RLS”改为“运行期必须降权”；
   - 删除“RLS 策略与 SECURITY DEFINER 成立的前提是迁移角色拥有 BYPASSRLS”整段，替换为 Task 6 Step 1 的同一段说明。
10. §12.3 保留 `node_select` 示例；把“组织不写进会话 Cookie”改为“组织不写进会话；当前组织由 URL/项目 scope 决定”。
11. §12.4 删除错误的 `own_membership` SQL（包括 `❌` 与 `✅` 两段），改为一段散文：`organization_member 的策略如果直接子查询自身会递归；实际用 auth.has_org_role 打破递归。organization_member 对 app_rw 只开 SELECT；写由 auth_service 的 FOR ALL 策略执行。`
12. §12.5 删除整个 `FOR ALL` 模板与“套模板的 7 张表”段落，替换为：

```markdown
**策略的权威定义在迁移，不在本文。** `project` 是特例（INSERT/UPDATE 只 owner/admin）；`folder`、`lineage`、`node`、`article`、`book`、`book_catalog` 用同一 DO 块（SELECT 四角色，INSERT/UPDATE 三写角色）；`activity_logs` 另有 `user_id = auth.uid() AND (organization_id IS NULL OR has_org_role(...))` 的 SELECT/INSERT 策略。新增表复制 `lib/db/migrations/0001_auth_rls.sql` 的三段式策略，不要手写 `FOR ALL` 裸子查询。
```

同时更新 §12.5 下面“单独写的 3 张表”表：保留 `organization`（`deleted_at IS NULL AND has_org_role`）、`organization_member`（app_rw 只 SELECT，写属 auth_service）、`invite`（app_rw 无权限）；增加第 4 行 `activity_logs`（app_rw 只 SELECT/INSERT，按 `user_id = auth.uid()` 与组织成员关系）。
13. §12.5 末尾“public schema 的 10 张业务表全部开启”改为 11 张，并把 `activity_logs` 算进去。
14. §12.6 第 3 条 `src/server/db` 改为 `lib/db/drizzle`；把“Biome noRestrictedImports + 评审”改为“当前评审；Biome 规则待接入（评审 P1-12）”。
15. §10 标题改为“关键索引（非穷举）”，并补一句：`完整索引以 0000/0001 迁移为准`。至少补上 `idx_node_parent`、`idx_node_alive`、`idx_folder_project`、`uk_project_ref`、`uk_lineage_name`、`uk_book_name`。

- [ ] **Step 3: 验证**

Run: `rg -n "organization_id IN \\(|FOR ALL TO app_rw|src/server/db|BYPASSRLS.*前提|10 张业务表全部" docs/data-model.md docs/architecture/05-data.md`
Expected: 无输出（只允许散文里解释“不要依赖 BYPASSRLS”）。

Run: `rg -n "activity_logs" docs/data-model.md`
Expected: 至少在表清单、§2、§11、§12.5 出现。

Run: `rg -n "withOrg\\(userId: string" docs/data-model.md`
Expected: 命中实际签名。

- [ ] **Step 4: Commit**

```bash
git add docs/data-model.md docs/architecture/05-data.md
git commit -m "docs(data): 修正表清单与 RLS 说明"
```

---

### Task 7: Action/Route 契约、错误模型与 how-to 对齐

**Files:**
- Modify: `docs/api.md:1-476`
- Modify: `docs/architecture/06-crosscutting.md:14-96`
- Modify: `docs/guides/add-a-feature.md:1-262`

**Interfaces:**
- Consumes: `lib/auth/types.ts`、`lib/auth/middleware.ts`、`lib/lineage/actions.ts`、`app/api/health/route.ts`、ADR 0008。
- Produces: `ActionState` 为唯一 Action 契约；Action 使用 UUID；4 个 Handler；错误模型与健康响应与代码一致；how-to 不再教客户端 `orgSlug` 授权。

- [ ] **Step 1: 修 `api.md`**

1. 文件头“接口风格”改为：`Server Action（内部写）+ RSC（内部首屏读）+ TanStack Query（客户端缓存）+ 4 个只读 Route Handler`；序列化行改为：`JSON；Route Handler 非 2xx 返回 { error, code? }`。
2. §1.1：
   - “内部读（客户端刷新）… 目标收敛为 Server Action”改为 `TanStack Query → 4 个只读 GET Route Handler（ADR 0008）`；
   - 删除“目标收敛为 Server Action”与“M1 唯一的 Route Handler”等旧句；
   - 明确 4 个路由。
3. §1.2：
   - Action 文件路径改为 `lib/<domain>/actions.ts`；
   - 出参类型改为 `ActionState`（权威定义 `lib/auth/types.ts`）。
4. §2.2 整节改写为：

```markdown
页面/布局用 `requireOrgContext(orgSlug)` / `requireProjectContext(projectRef)` 把公开 ID 解析成内部 scope（`organizationId`、`projectId`、`role`）。Action 入参使用内部 UUID（`orgId`、`projectId`、`lineageId` 等），不使用公开 ID 作为授权依据。即使 UUID 被篡改，事务内仍需 `getOrgRoleInTx` + `hasPermission` 复核；非成员返回 404，权限不足返回 403。

公开 ID 只用于 URL 定位；不要新增按公开 ID 写入的入口。
```

5. §2.4 “M1 唯一的 Route Handler 是 GET”改为：`4 个 Route Handler 全部是只读 GET；没有写 Route Handler`。
6. §4.2 的 `ActionResult<T>` 整段替换为：

```markdown
Action 返回 `ActionState`，权威定义在 `lib/auth/types.ts`。语义：

- `error` / `success`：面向用户的中文文案；
- `code`：稳定机器码（如 `FORBIDDEN`、`CONFLICT_DUPLICATE`）；
- `fieldErrors`：字段级错误；
- `orgId` / `projectId` / `lineageId` 等：成功后的内部 UUID，供 UI 导航或刷新。

不要回显密码；不要把异常堆栈放进返回值。
```

7. §4.3 的错误模型改为：

```markdown
Route Handler 非 2xx 统一返回 `{ "error": "Unauthorized" }` 这类 JSON；需要机器码时加 `code`。`/api/health` 503 返回 `{ "status": "error", "database": "down" }`。此前文档写的 RFC 9457 没有落地，删除该承诺。
```

8. §5.1 骨架替换为（使用实际事务服务签名；事务服务内部打开 `withOrg` 并复核权限）：

```typescript
'use server';

export const updateNodeAction = validatedActionWithUser(
  updateNodeSchema,
  async (data, _formData, user) => {
    const result = await updateNodeInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      nodeId: data.nodeId,
      updates: {
        name: data.name,
        surname: data.surname,
        sex: data.sex,
        courtesy: data.courtesy,
        namePrefix: data.namePrefix,
        isAlive: data.isAlive,
        birthText: data.birthText,
        deathText: data.deathText,
        birthYear: data.birthYear,
        deathYear: data.deathYear,
        burialPlace: data.burialPlace,
        biography: data.biography,
      },
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return { success: '人丁信息已保存', nodeId: result.node.id };
  }
);
```

下面注明：`updateNodeInTransaction` 在内部用 `withOrg` + `requireLineageWrite` 复核；Action 只传内部 UUID。`revalidateProject()` 目前仍是整树失效，收窄到项目/谱系是评审 P1-8 的代码任务；文档可以把它写成目标，但不能写成现状。
9. §5.2 Action 清单前加一句：`下表用语义名；实际导出统一为 <verb><Noun>Action（如 createLineageAction、addChildAction）。`
10. §6.1 健康响应改为 `{ "status": "ok", "database": "up" }`；503 为 `{ "status": "error", "database": "down" }`；删除 `version`/`uptime`。
11. §7.1 的页面路径改为 `/dashboard/project/[projectRef]/lineages/[lineageId]`；`requireOrgContext(params.orgSlug)` 改为项目页使用 `requireProjectContext(params.projectRef)`；§7.2 的 `addChild` 改为 `addChildAction`。
12. §7.3 删除对 `lib/error-ui.ts` 的引用；改为：`错误码到 UI 的映射由各表单/Toast 就地处理；当前没有集中映射文件。`
13. §8 契约规则保留；把“M2 加 `lockToken` 改签名”改为“新增带锁的 Action 变体”。

- [ ] **Step 2: 修 `06-crosscutting.md`**

1. §9.1 删除 `// src/server/config.ts` 代码块，替换为：`实现见 lib/config.ts；环境变量表见 ops-target §3。约定：业务代码不直接读 process.env，当前靠评审（Biome 规则未配置）。`
2. §9.2 错误表改为：
   - Server Action：`ActionState`；
   - Route Handler：`{ error, code? }`；`/api/health` 503 为 `{ status, database }`；
   - 删除 RFC 9457 行。
3. §9.5 的“性能：从日志 duration_ms 按路由聚合 p95”改为：`Vercel 日志可检索但不支持聚合；p95 需要导出到外部存储或错误聚合服务。当前只有 duration_ms 原始日志，p95 未聚合（见 R19）。`

- [ ] **Step 3: 修 `add-a-feature.md`**

1. §1 第 ① 步的 `docs/product/glossary.md` 改为 `PRD §2 术语 + 本域 Zod schema`；不创建新文件。
2. §④ 的 RLS 模板保留（它是正确的），但在标题下加一句：`权威定义在 0001_auth_rls.sql；这里是新增表的最小模板。`
2b. 把 §④ 检查点里的裸子查询字样改为“裸子查询会漏 `deleted_at`”，不要保留可复制的 `organization_id IN (SELECT ... FROM organization_member ...)` 片段。
3. §⑤ 的读函数保留，但补一句：`列表查询必须有 limit 或可控条件`。
4. §⑦ 的 Action 示例替换为（事务服务内部打开事务）：

```typescript
export const createThingAction = validatedActionWithUser(
  createThingSchema,
  async (data, _formData, user) => {
    const result = await createThingInTransaction({
      userId: user.id,
      orgId: data.orgId,
      projectId: data.projectId,
      ...data,
    });

    if (!result.ok) {
      return actionError('FORBIDDEN', '没有编辑权限。');
    }

    revalidatePath(`/dashboard/project/${data.projectRef}/things`);
    return { success: '已创建' };
  }
);
```

检查点改为：
- Action 使用内部 UUID（`orgId`/`projectId`），不使用 `orgSlug` 作为授权依据；
- 事务服务内部 `withOrg` + 事务内复核权限；
- 写后 `revalidatePath`（目标是最窄路径；当前若只有整树 helper，登记到 implementation-status）；
- 失败 `actionError`，不 throw；
- 成功返回 `ActionState`。

5. §2 标题“读路径：一个请求一个事务”改为“读路径：一个渲染单元一个事务”；正文改为：
   - 布局与页面由 Next 独立渲染，不共享事务；
   - 同一页面内的查询提供 `*Tx` 变体，在页面层合并；
   - 不要用 AsyncLocalStorage 把事务跨渲染周期传递。
   - 把“至少 4 个往返”改为“至少 5 个往返（BEGIN / SET LOCAL ROLE / set_config / 查询 / COMMIT）”。
6. §4 验收清单“页面只有一个事务”改为“同一渲染单元合并事务”。
7. §⑩ 的状态更新路径改为 `docs/implementation-status.md`；删除 README 速览同步。
8. 删除文末关于 `ActionResult<T>` 与 `ActionState` 不一致的“注意”段，改为一句：`Action 契约统一为 ActionState；见 api.md §4.2。`

- [ ] **Step 4: 验证**

Run: `rg -n "ActionResult|lib/error-ui\\.ts|requireOrgContext\\(data\\.orgSlug\\)|revalidateTag|docs/status/|docs/product/glossary|M1 唯一的 Route Handler" docs/api.md docs/architecture/06-crosscutting.md docs/guides/add-a-feature.md`
Expected: 无输出。

Run: `rg -n "database.*up|ActionState|orgId" docs/api.md`
Expected: 健康响应与 ActionState/内部 UUID 的表述存在。

- [ ] **Step 5: Commit**

```bash
git add docs/api.md docs/architecture/06-crosscutting.md docs/guides/add-a-feature.md
git commit -m "docs(api): 对齐 Action 契约与错误模型"
```

---

### Task 8: 目标、质量与演进只保留可验证的内容

**Files:**
- Modify: `docs/architecture/01-drivers.md:12-54`
- Modify: `docs/architecture/07-quality.md:10-66`
- Modify: `docs/architecture/08-evolution.md:10-90`

**Interfaces:**
- Consumes: Task 2 的决策；Task 6 的容量口径；Task 1 的 `docs:check`。
- Produces: 每条 Gx 有判据或“未验证”；质量表带证据/状态；fitness function 只列真实执行项；08 不再复制待决策表。

- [ ] **Step 1: 修 `01-drivers.md`**

1. G2 改为：

```markdown
| G2 | 组织 50 万人丁、单谱系 5 万、画布 2000 可见节点可交互 | 口径见 [05-data §8.5](./05-data.md)；1000 节点拖拽 ≥45fps，验证见 07-quality QA-PERF-1 |
```

2. G3 改为：

```markdown
| G3 | 新增一个业务实体 ≤5 个源文件 + 1 个迁移 + 1 处状态更新 | 按 [add-a-feature 清单](../guides/add-a-feature.md) 执行；CI 全绿 |
```

3. G5 改为：

```markdown
| G5 | 百级组织的基础设施月成本 ≤ ¥900 | 首次真实部署后按 Vercel/Neon 月度账单核对；当前未验证 |
```

4. G6 改为：

```markdown
| G6 | 只为 PRD 已定义、且 M3 排版会固化的结构预建数据形态（`book_catalog` 引用、`cover_spec`、`hide`）；不为没有消费者的功能预建列/表 | 新增列/表必须在 PRD 或 ADR 中有对应条目；评审 P2-13 列出的无读写列不因 G6 获得保留理由 |
```

5. 删除 §1.1 下“G3 的判据需要一次修订……这是待决策项”整段。
6. §2 的映射表同步 G3/G6 链接。

- [ ] **Step 2: 修 `07-quality.md`**

1. §11 表增加“证据 / 状态”两列；逐行改为：

```markdown
| 属性 | 目标 | 证据 | 状态 |
|---|---|---|---|
| 隔离 | 跨组织查询 0 行 | `pnpm test:integration`（org-scope） | 本地/CI 已验证；生产角色未验证 |
| 注册完整性 | 有账号必有组织 | 集成测试 | 已验证 |
| 性能（画布） | 1000 节点 ≥45fps | Playwright 性能采样 | 未验证（R2） |
| 性能（页面） | TTFB <400ms | 日志/外部聚合 p95 | 部分：有 duration_ms，无聚合 |
| 可用性 | 月度 99.5% | 外部探针 5 分钟 | 未验证（R19） |
| 保存失败率 | <0.1% | 服务端 error.code / 客户端上报 | 未验证（R19） |
| 可维护性 | 单文件 ≤400 行 | 脚本统计 | 未配置（评审 P1-12） |
| 可测试性 | 关键查询/事务模块覆盖率 ≥70% | `pnpm test:coverage` | 已验证 |
| 关键路径 | 注册→建项目→建谱系→录入可用 | Playwright | 已验证（2 条） |
| 部署就绪 | 健康/安全头/鉴权/RLS | `pnpm verify:deploy` | 本地生产模式已验证；云端未验证 |
| 恢复 | RPO≤1 天，RTO≤4 小时 | 季度恢复演练 | 未演练 |
```

2. §11.1 删除“该清单目前是建议，尚未写入本文档正文。补全后应替换……”整段，改为：`上表是 §11 指标的判定场景；场景与证据是一套东西，不再并列两套指标。`
3. §11.1 的 QA-PRIV-1 标注 `当前不成立（R18）`；QA-MAINT-1 保持。
4. §11.2 表拆成两段：

```markdown
**已执行**

| # | 约束 | 检查方式 |
|---|---|---|
| F3 | 每张业务表都启用 RLS | 查 pg_class.relrowsecurity（已有） |
| F8 | 迁移目录与 schema 无漂移 | pnpm db:generate 后无变更（已有） |
| F9 | 文档链接/过期路径/矛盾措辞 | pnpm docs:check --strict（本计划新增） |

**未执行（代码评审 P1-12）**

F1/F2/F4/F5/F6/F7 仍只是评审规则；在 Biome/CI 接入前，不要写成“已由工具拦截”。
```

- [ ] **Step 3: 修 `08-evolution.md`**

1. §12 M1 行改为 `M1 目标`（不带当前状态；状态链接由文件头统一指向 implementation-status）。
2. M2 行删掉“第 2 个 Route Handler”，改为 `按需新增只读 Route Handler（ADR 0008）`。
3. §14.2 标题“本次评审新增的风险”改为“评审补充风险（2026-10-22）”。
4. §15 整节替换为：

```markdown
## 15. 待决策项

统一维护在 [decisions/README §待决策](../decisions/README.md#待决策)。本文件不复制。
```

- [ ] **Step 4: 验证**

Run: `rg -n "待决策项 D-|第 2 个 Route Handler|尚未写入本文档正文|G6.*每一行代码|≤3 个文件" docs/architecture/01-drivers.md docs/architecture/07-quality.md docs/architecture/08-evolution.md`
Expected: 无输出。

Run: `rg -n "未验证|未执行|docs:check" docs/architecture/07-quality.md`
Expected: 质量表与 fitness function 明确区分已验证/未验证。

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/01-drivers.md docs/architecture/07-quality.md docs/architecture/08-evolution.md
git commit -m "docs(architecture): 使目标与质量可验证"
```

---

### Task 9: ADR 与 PRD 的事实校正

**Files:**
- Modify: `docs/decisions/0004-soft-delete-forever.md:15-40`
- Modify: `docs/decisions/0005-zero-background-jobs.md:10-20`
- Modify: `docs/decisions/0006-rls-isolation.md:8-60`
- Modify: `docs/prd.md:121-136`、`:181-211`、`:240-279`、`:291-333`

**Interfaces:**
- Consumes: Task 6 的 RLS/表清单；Task 7 的错误/契约口径。
- Produces: ADR 不再包含过期事实；PRD 与控制台实际路由、公开页、容量口径一致。

- [ ] **Step 1: 修 ADR 0004**

1. “全部 10 张业务表都带 deleted_at”改为：

```markdown
- 8 张软删实体表（organization/project/folder/lineage/node/article/book/book_catalog）带 `deleted_at`；
- `organization_member` 与 `invite` 由 Better Auth 硬删除，不保留软删列；
- `activity_logs` 是产品活动流，不带 `deleted_at`。
```

2. 在“不做物理删除”一条后补：`app_rw 不授予 DELETE；organization_member/invite 的物理删除由 auth_service 执行，这是受控例外。`
3. 文件头加一行修订记录：`2026-10-24 修订：表计数与硬删除例外按 ADR 0007 落地后的 schema 校正。`

- [ ] **Step 2: 修 ADR 0005**

1. 表格“会话过期”行改为：`数据库会话由 Better Auth 管理；过期判断在读取时完成 | M1 没有独立的会话清理任务，不依赖后台任务；如有清理需求，与数据保留期一起破例`。
2. 文件头加：`2026-10-24 修订：认证已切换到 Better Auth 数据库会话（ADR 0007），原“无会话表/JWT 自带 exp”不再成立。`

- [ ] **Step 3: 修 ADR 0006**

1. §1 第 1 点“策略基于 `organization_member` 子查询”改为：`策略最终基于 organization_member 的成员关系（通过 auth.has_org_role）`。
2. 在负面后果的 BYPASSRLS 段落前加：

```markdown
> **2026-10-24 修订（ADR 0007 之后）**：运行期不再依赖迁移角色的 `BYPASSRLS`。`auth_service` 通过显式 `FOR ALL USING (true)` 策略写 `auth.*` 与 `organization`/`organization_member`/`invite`；`app_rw` 仍受 RLS 约束；迁移角色只用于 DDL。下文“必须拥有 BYPASSRLS”与“作为部署校验项断言”两句已失效，保留作历史记录。
```

3. 把“这一条必须作为部署校验项断言”改为：`部署校验项改为：app_rw 无 auth.* 表权限、auth_service 连接固定 role=auth_service、各表策略存在。`
4. §2 第 4 点“注册、登录查询、会话校验、改密、邀请接受全部走 SECURITY DEFINER 函数”改为：`认证/租户写走 Better Auth 的 auth_service 连接；SECURITY DEFINER 函数只用于触发器与受控归档/成员判断。`

- [ ] **Step 4: 修 PRD**

1. §4.2 URL 表改为两套独立控制台：

```markdown
| 层级 | URL | 内容 |
|---|---|---|
| L0 | `/dashboard` | 我所属的组织列表 + 最近访问 |
| L1 | `/dashboard/org/[orgSlug]` | 组织概览、成员、设置 |
| L2 | `/dashboard/project/[projectRef]` | 云谱空间首页：谱系 / 谱文 / 谱书 |
| L3 | `/dashboard/project/[projectRef]/lineages/[id]` | 谱系图编辑器 |
| L3 | `/dashboard/project/[projectRef]/articles/[id]` | 谱文编辑器 |
| L3 | `/dashboard/project/[projectRef]/books/[id]/catalog` | 谱书编目 |
```

并加一句：`projectRef 全局唯一；项目页按 projectRef + 当前用户解析 scope，不要求在 URL 里重复 orgSlug。`
2. “M1 没有公开页面。所有页面都需要登录。”改为：`公开页面只有营销首页 `/` 与登录/注册；M1 没有匿名业务数据页、分享页或公开 API。`
3. FR-LIN-10 的“向下滚动加载更多”改为“向右平移或点按钮每次追加 5 世”。
4. FR-ORG-8 改为：

```markdown
| FR-ORG-8 | 组织停用/归档 | `suspended` 状态下写操作返回 `ORG_SUSPENDED`、只读放行；`closed`/`deleted_at` 表示归档并从控制台隐藏。M1 UI 只提供归档入口 |
```

5. §7 NFR：
   - 容量行加注：`单谱系 5 万、画布 2000 可见节点，口径见 architecture/05-data §8.5`；
   - 可用性 99.5% 与保存失败率 <0.1% 加注：`测量手段见 R19；在探针/上报落地前是目标，不是已验证承诺`；
   - 设备行改为：`桌面优先；现有控制台含移动端抽屉，但不作为 M1 承诺`。
6. §9 开放问题：
   - 删除 Q1（已由 ADR 0002 接受）；同时把 §5.5 FR-ART-4 的“见 §9 Q1”改为“见 ADR 0002 / §6.3 缺口 3”；
   - 删除 Q2（默认组织名可改，已实现）；
   - Q4 改为：`女儿入谱后其子女如何归属；当前 ADR 0003 记录为父系单链缺口，若支持需改关系模型（决策 D-4）`；
   - Q3/Q5/Q6 保留。

- [ ] **Step 5: 验证**

Run: `rg -n "M1 没有公开页面|JWT 自带|全部 10 张业务表都带|必须拥有.*BYPASSRLS|/\\{orgSlug\\}/\\{projectRef\\}" docs/prd.md docs/decisions/0004-soft-delete-forever.md docs/decisions/0005-zero-background-jobs.md docs/decisions/0006-rls-isolation.md`
Expected: 只允许 ADR 0006 的历史引号块命中 `BYPASSRLS`；其余无输出。

Run: `rg -n "/dashboard/org/\\[orgSlug\\]|/dashboard/project/\\[projectRef\\]|公开页面只有" docs/prd.md`
Expected: 命中两套路由与公开页面说明。

- [ ] **Step 6: Commit**

```bash
git add docs/prd.md docs/decisions/0004-soft-delete-forever.md docs/decisions/0005-zero-background-jobs.md docs/decisions/0006-rls-isolation.md
git commit -m "docs: 校正 PRD 与 ADR 前提"
```

---

### Task 10: 让检查成为门禁，跑完整验收

**Files:**
- Modify: `.github/workflows/ci.yml`（在 `pnpm check` 之后加 docs 检查）
- Modify: `docs/README.md:160-166`
- Modify: `docs/guides/testing.md:156-163`
- Modify: `docs/setup.md:247-267`

**Interfaces:**
- Consumes: Task 1 的脚本与所有文档修复。
- Produces: CI 执行 `pnpm docs:check --strict`；`setup/testing` 文档列出该命令；仓库进入可维护状态。

- [ ] **Step 1: CI 加 strict 检查**

在 `.github/workflows/ci.yml` 的 `pnpm check` 步骤后加：

```yaml
      - name: Docs consistency
        run: pnpm run docs:check --strict
```

- [ ] **Step 2: 文档补命令**

1. `docs/README.md §5.5` 第一条加：`pnpm docs:check`（链接/锚点/过期路径/矛盾措辞/文档头）。
2. `docs/guides/testing.md §8 提交前` 加一行：`pnpm docs:check`（文档改动必跑；CI 也跑）。
3. `docs/setup.md` 的命令表（约 247 行）加：

```markdown
| `pnpm docs:check` | 文档一致性检查：相对链接、锚点、过期路径、矛盾措辞、文档头 |
```

- [ ] **Step 3: 跑完整验收**

Run: `pnpm docs:check --strict`
Expected: `0 issue(s)`，exit 0。如果只剩 `setup.md` / `ops-target.md` 的历史断链，按最小改动修链接，不借机改内容。

Run: `pnpm check`
Expected: 通过。如果 Biome 只对新脚本报格式问题，运行 `pnpm exec biome check --write scripts/check-docs.mjs` 后再跑一次；不要用 `pnpm fix` 全仓重排。

Run: `node --check scripts/check-docs.mjs`
Expected: exit 0。

Run: `git diff --stat`
Expected: 只包含本计划的 docs/scripts/CI/package.json 文件；没有 `app/`、`lib/`、迁移改动。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml docs/README.md docs/guides/testing.md docs/setup.md
git commit -m "ci(docs): 启用文档一致性检查"
```

---

## 5. 验收清单（全部任务完成后）

- [ ] `pnpm docs:check --strict` 为 0 issue。
- [ ] `rg "src/modules|revalidateTag|ActionResult|docs/status/|docs/adr/|M1 没有公开页面|一次页面渲染只开一个事务|目标 1 个 / 当前 4 个" docs --glob '!reviews/**' --glob '!superpowers/**'` 无输出。
- [ ] `data-model.md` 含 11 张表的完整清单与 `activity_logs`；RLS 权威指向迁移，不再有 `FOR ALL` 裸子查询。
- [ ] `api.md` 的 Action 契约是 `ActionState`，Action 使用 UUID，4 个 Route Handler，健康响应与代码一致。
- [ ] `04-runtime.md` 的读路径是两套控制台路由，proxy 只做 Cookie 门禁，事务口径是“渲染单元”。
- [ ] `decisions/README.md` 待决策只剩 D-4/D-6；ADR 0008 存在并被 02/03/04/api 引用。
- [ ] `implementation-status.md` 是唯一当前状态源；README 没有当前快照。
- [ ] CI 在 `pnpm check` 后执行 `pnpm docs:check --strict`。

## 6. 不做的事（防止范围膨胀）

- 不把 `docs/` 重组成 `product/` + `reference/` + `status/`；现有目录足够，搬迁会让所有链接失效。
- 不为 D-1/D-3/D-5/D-7 写正式 ADR；它们可逆且已在代码中决定，更新索引与目标文档即可。
- 不在本计划里修 P0-1/P0-2/P0-4/P0-3 的代码与迁移；文档只如实记录缺口并链接评审。
- 不改 `docs/reviews/**`；评审是历史，不是规范。
- 不改 `AGENTS.md`；读通道决策落地后，用单独 PR 把 §5.6/§12 的“过渡”改为“正式设计”。
