# 架构文档集重构（15 份 as-is）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `docs/architecture/` 从 9 份 to-be 架构文档重构成 15 份 as-is 架构文档（编号 00–14），并把仓库入口文档（`docs/README.md`、`AGENTS.md`）的定位措辞同步改到 as-is，最终 `pnpm docs:check --strict` 与 `pnpm test` 全绿。

**Architecture:** 结构级事实（表分组与职责、模块边界、依赖方向、流程步骤、接口清单、部署单元）写进架构文档正文；字段级/契约级/运维级事实（列定义、RLS 策略体、DTO 字段、错误码表、环境变量逐条、命令）仍只写在 `data-model.md` / `api.md` / `ops-target.md` / `setup.md`，架构文档只放链接。15 份全部新写，旧 9 份只作素材，写完后删除。

**Tech Stack:** Markdown + mermaid；校验工具 `node scripts/check-docs.mjs`（`pnpm docs:check`）；提交走 git。

**Spec:** `docs/superpowers/specs/2026-10-30-architecture-doc-set-design.md`

## Global Constraints

以下每一条对每个任务都生效，不再逐任务重复。

1. **文件名逐字固定**（共 15 个，全在 `docs/architecture/` 下）：`00-文档说明.md`、`01-架构总览.md`、`02-架构目标与约束.md`、`03-逻辑视图-模块设计.md`、`04-数据视图-数据架构.md`、`05-接口与集成设计.md`、`06-部署视图-部署架构.md`、`07-运行视图-关键流程.md`、`08-非功能性设计.md`、`09-安全架构.md`、`10-可观测性与运维.md`、`11-技术选型与决策记录.md`、`12-需求追溯矩阵.md`、`13-风险与演进规划.md`、`14-附录.md`。
2. **文件头模板**（必须是文件前 15 行内，逐字使用这四行字段名）：
   ```
   # <标题>

   > **回答什么问题**：<一句话>
   > **读者**：<读者>　**长度上限**：<N> 页
   > **目标 vs 现状**：本文描述当前实现（as-is）。目标设计见 [PRD](../prd.md) 与 [decisions](../decisions/README.md)。
   ```
   第 3 行的 `读者`、`长度上限` 之间用全角空格 `　` 分隔，与旧 9 份保持一致。
3. **单一事实来源边界**：出现下列内容即为缺陷——列定义（`text('`、`uuid(`、`varchar(`）、索引/策略 DDL、触发器函数体、完整错误码表、逐条环境变量说明、`pnpm` 命令清单。这些一律改写成一句话 + 链接。
4. **不写汇总数字**：「17 张表」「4 个 Route Handler」「N 个测试文件」都不写。写枚举（「`person`/`family`/`event` 等六张事实层表」）可以。
5. **不写需求状态判定**：「未实现」「部分实现」「已完成」「🟡」不出现在 01–11 与 14。可以写代码存在性（「表已落库，尚无查询函数引用」）。状态只在 `implementation-status.md`。
6. **链接规则**：跨文件链接**不带 `#锚点`**（唯一例外：指向 `00-文档说明.md#术语表`）。链接目标必须存在，文件名用相对路径 `./03-逻辑视图-模块设计.md` 或 `../data-model.md`。
7. **禁用措辞**（出现即 `docs:check --strict` 失败，逐条避开）：`没有公开页面`、`M1 没有匿名访问者`、`目标收敛为 Server Action`、`目标 1 个 / 当前 4 个`、`1 个 Route Handler`、`M1 唯一的 Route Handler`、`第 2 个 Route Handler`、`一次页面渲染只开`、`revalidateTag`、`requireOrgContext(data.orgSlug)`、`ActionResult`、`lib/error-ui.ts`、`目标 10 张业务表`、`10 张业务表 + 4 张`、`尚未写入本文档正文`、`≤3 个文件`、`JWT 自带 exp`、`全部 10 张业务表都带`、`/{orgSlug}/{projectRef}`、`organization_isolation`、`6 个业务模块`。
   替代写法：写 `revalidatePath`；写 `ActionState`；写「对外不暴露匿名可访问的业务页面」；写「4 个只读 Route Handler」。
8. **禁用写法**：裸 RLS 子查询 `organization_id IN (SELECT ... FROM organization_member)`；过期路径 `src/modules/`、`docs/adr/`、`docs/status/`、`src/server/db`、`docs/product/glossary.md`。
9. **术语统一**（00 章术语表定义一次，其余文件照用）：组织 = 云谱空间；`node` = 人丁；`lineage` = 谱系；公开 ID = `slug`/`ref`（20 位）；事实层 = `person`/`person_name`/`family`/`family_partner`/`family_child`/`event` 六张表；软删 = `deleted_at`。
10. **语言**：简体中文，品牌「云谱」，与仓库其余文档一致。单文件 ≤ 400 行。
11. **事实必须实读**：每个任务的第 1 步是读它列出的来源文件。禁止凭记忆写事实。
12. **阶段 2 的校验放宽**：阶段 2（Task 2–15）允许 `pnpm docs:check` 报「链接目标不存在」（指向尚未写的兄弟文件）；**其他类型的 issue 一律不许有**。阶段 3（Task 16）必须 `0 issue(s)`。
13. **提交格式**：`docs(architecture): <做了什么>`，一个 commit 一份文档（阶段 2）；阶段 3 单独 commit。不要 `git add -A`，按任务 `Files` 块逐条 add。

## Review Focus

这五类是这次重构最可能翻车的地方，每条都在它归属的任务里有对应校验步骤。

1. **事实写错**：表清单、Route Handler 路径、角色/权限字符串、CI 阶段顺序、脚本名写成旧值或不存在的值 → 每个文档任务都有「事实断言」grep 步骤（Task 2–15），Task 16 有全量抽查。
2. **第二份真相**：把列定义、DTO 字段表、环境变量逐条说明、命令清单抄进架构文档 → Task 16 Step 3 用 grep 扫全目录。
3. **状态泄漏**：`未实现`/`部分实现`/`已完成` 出现在 01–11、14 → 各任务写作约束 + Task 16 Step 4 grep。
4. **链接与锚点**：跨文件带 `#锚点`、锚点 slug 不匹配、链接指向已删除的旧文件名 → Task 16 Step 2 的 `docs:check --strict`。
5. **术语漂移**：同一概念在不同文件叫不同名字（组织/云谱空间、人丁/node、谱系/lineage）→ 00 章术语表 + Task 16 Step 5 grep。

---

## File Structure

**新建 15 个文件**（`docs/architecture/`）：

| 文件 | 职责 | 事实来源 |
|---|---|---|
| `00-文档说明.md` | 文档集导航、术语表、参考标准、单一事实来源表 | `docs/README.md`、`AGENTS.md` |
| `01-架构总览.md` | 系统定位、范围、C4-L1 上下文、容器图、架构不做什么 | 旧 `00-overview.md`、`02-context.md` |
| `02-架构目标与约束.md` | 业务目标、质量属性、技术/合规/团队约束 | 旧 `01-drivers.md`、`prd.md` |
| `03-逻辑视图-模块设计.md` | 分层、模块职责、依赖方向与执行手段、领域模型 | 旧 `03-components.md`、`implementation-status.md` §1.5、`biome.json` |
| `04-数据视图-数据架构.md` | 存储选型、表分组、隔离三层、一致性、生命周期 | 旧 `05-data.md`、`data-model.md`、`lib/db/schema/` |
| `05-接口与集成设计.md` | 三通道接口形态、Action 契约、Route 清单、外部集成 | `api.md`、`implementation-status.md` §1.3、`lib/api.ts`、`lib/auth/` |
| `06-部署视图-部署架构.md` | C4-L2/L3、环境矩阵、CI/CD、扩缩容 | 旧 `02-context.md` §3/§10、`ops-target.md`、`.github/workflows/ci.yml` |
| `07-运行视图-关键流程.md` | 读路径、写路径、多步事务时序、状态机、异常补偿 | 旧 `04-runtime.md`、`lib/db/services.ts`、`lib/lineage/*-services.ts` |
| `08-非功能性设计.md` | 质量属性目标、容量口径、可扩展性边界、fitness function | 旧 `07-quality.md`、`scripts/check-*.mjs` |
| `09-安全架构.md` | 认证、会话、授权矩阵、租户隔离、威胁建模 | 旧 `06-crosscutting.md` §9.4、`lib/auth/`、`decisions/0006`/`0007` |
| `10-可观测性与运维.md` | 日志、健康检查、错误处理、告警缺口、恢复能力 | 旧 `06-crosscutting.md` §9.3/§9.5、`lib/logger.ts`、`guides/runbooks.md` |
| `11-技术选型与决策记录.md` | 技术栈清单、版本基线、ADR 索引 | `package.json`、`decisions/README.md`、`decisions/*.md` |
| `12-需求追溯矩阵.md` | FR ↔ 模块 ↔ 接口 ↔ 测试 映射 | `prd.md`、`implementation-status.md` §2/§3、`tests/` |
| `13-风险与演进规划.md` | 风险登记簿、技术债顺序、演进方向 | 旧 `08-evolution.md`、`implementation-status.md` §5 |
| `14-附录.md` | 图集索引、术语补充、参考资料、旧→新对照、变更记录 | 全部 15 份 |

**修改的文件**（只在 Task 16）：`docs/README.md`、`AGENTS.md`、`docs/architect.md`、`docs/prd.md`、`docs/api.md`、`docs/data-model.md`、`docs/ops-target.md`、`docs/implementation-status.md`、`docs/guides/runbooks.md`、`docs/decisions/0001..0013`、`tests/docs-consistency.test.ts`、`lib/config.ts`。

**删除的文件**（Task 16）：旧 9 份 `docs/architecture/00-overview.md` … `08-evolution.md`。

**并行分组**（阶段 2，各组写入范围互斥，可同时跑）：

| 组 | 任务 | 依赖 |
|---|---|---|
| 地基 | Task 1（`00-文档说明.md`） | 无 |
| A | Task 2（`01`）、Task 3（`02`）、Task 15（`13`） | Task 1 |
| B | Task 4（`03`）、Task 8（`07`） | Task 1 |
| C | Task 5（`04`）、Task 6（`05`） | Task 1 |
| D | Task 7（`06`）、Task 9（`08`） | Task 1 |
| E | Task 10（`09`）、Task 11（`10`）、Task 12（`11`） | Task 1 |
| F | Task 13（`12`）、Task 14（`14`） | Task 1、其余全部完成（14 章要索引全部图） |

Task 16 依赖 Task 1–15 全部完成。

---

### Task 1: `00-文档说明.md`（地基）

**Files:**
- Create: `docs/architecture/00-文档说明.md`

**Interfaces:**
- Produces: 文件内必须有一个标题为 `## 术语表` 的小节（其余文件会链接 `./00-文档说明.md#术语表`）；必须有一个标题为 `## 文档集导航` 的小节，内含 15 行表格，列固定为 `编号 | 文件 | 回答什么问题 | 读者`，顺序 00→14。

- [ ] **Step 1: 读来源**

读 `docs/README.md`（重点 §1 两套内容表、§3 阅读路径、§5.1 单一事实来源表、§5.3 文件头模板）与 `AGENTS.md`（§2 按任务读什么）。提取：仓库对「哪份文档是哪种事实的唯一来源」的现行规定。

- [ ] **Step 2: 写文件**

按 Global Constraints 第 2 条写头（标题 `# 架构文档说明`，长度上限 3 页）。正文五个小节，顺序固定：

1. `## 这套文档是什么` —— 一句话定位：15 份 as-is 架构说明，描述代码**现在**怎么搭的；目标设计在 `prd.md` 与 `decisions/`。写明「本目录不写需求状态，状态见 [实现状态](../implementation-status.md)」。
2. `## 文档集导航` —— 15 行表格（列：编号 | 文件 | 回答什么问题 | 读者）。「回答什么问题」列直接取 spec §5 表格里的同名单元格，逐字。
3. `## 阅读路径` —— 四条路径（第一天加入 / 接手一个模块 / 值班故障 / 评估一个改动），每条给 3–4 份文件的有序链接与预计分钟数。沿用 `docs/README.md` §3 的现有四条路径，把旧文件名替换为新文件名。
4. `## 术语表` —— 表格（列：术语 | 含义 | 别写成）。至少覆盖 Global Constraints 第 9 条全部条目，另加：RLS、`app_rw`/`auth_service`、公开 ID、事实层、`withOrg`、Server Action、Route Handler、RSC、`ActionState`。`别写成` 列写常见误称（如「云谱空间」别写成「工作区」）。
5. `## 单一事实来源` —— 表格（列：事实类型 | 唯一来源 | 架构文档里写什么）。至少六行：表结构 → `data-model.md` / 写「表分组与职责」；接口契约 → `api.md` / 写「接口清单与形态」；需求状态 → `implementation-status.md` / 写「不写」；运维与环境变量 → `ops-target.md`、`setup.md` / 写「环境类别与部署单元」；决策理由 → `decisions/` / 写「一句话结论 + 链接」；命令 → `setup.md` / 写「不写」。
6. `## 参考标准` —— 一句话说明借鉴 C4（上下文/容器/部署）、ISO 42010 视图划分、ADR 格式，但**不强制套用**其术语。
7. `## 变更记录` —— 一行表格：`2026-10-30 | 由 9 份 to-be 文档重构为 15 份 as-is 文档 | 见 14-附录.md`。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/00-文档说明.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 验证锚点与导航完整性**

Run: `grep -c "^| 0[0-9] \|^| 1[0-4] " docs/architecture/00-文档说明.md` 与 `grep -c "^## 术语表" docs/architecture/00-文档说明.md`
Expected: 前者 `15`，后者 `1`

- [ ] **Step 5: 验证无禁用措辞**

Run: `pnpm docs:check 2>&1 | grep "00-文档说明" | grep -v "不存在"`
Expected: 无输出

- [ ] **Step 6: 提交**

```bash
git add docs/architecture/00-文档说明.md
git commit -m "docs(architecture): add 00 document set guide and glossary"
```

---

### Task 2: `01-架构总览.md`

**Files:**
- Create: `docs/architecture/01-架构总览.md`

**Interfaces:**
- Consumes: `./00-文档说明.md#术语表`
- Produces: 无（其他文件只单向链接它）

- [ ] **Step 1: 读来源**

读旧 `docs/architecture/00-overview.md`（§1 一页纸、§2 十条要点、§3 架构不做什么）与 `docs/architecture/02-context.md`（§2 系统上下文）。读 `docs/prd.md` 的「范围」小节。**只取结构与判断，措辞按 as-is 重写**：旧文件里凡是「目标」「将」「M1 之后」的表述，改成「现在是什么」或删掉。

- [ ] **Step 2: 写文件**

头：标题 `# 架构总览`，长度上限 4 页。正文六节：

1. `## 系统定位` —— 云谱是什么：组织/项目两层控制台 + 家谱编纂业务；使用者是谱牒编纂者与其协作成员；部署在 Vercel + Neon。
2. `## 范围` —— 两张清单：`在这个系统里`（控制台、成员与邀请、谱系与人丁、活动流、打印视图）与 `不在这个系统里`（邮箱验证、找回密码、邮件发送、后台任务、匿名公开页面、回收站、编辑锁、分享）。每条一行。
3. `## 系统上下文（C4-L1）` —— 一个 mermaid `flowchart` 图：中心「云谱」；外部参与者 谱牒编纂者/组织成员；外部系统 Better Auth（内嵌）、Neon PostgreSQL、Vercel 平台。每条边一句话说明数据流。
4. `## 运行时容器` —— 一个 mermaid 图或表格，列出 4 个容器：Next.js 应用（RSC + Server Action + 4 个只读 Route Handler）、PostgreSQL（`app_rw` 与 `auth_service` 两个登录角色）、Vercel 边缘/函数运行时、浏览器客户端（TanStack Query 缓存 + 谱系工作区 zustand store）。容器之间的连接写协议与连接串来源（`APP_POSTGRES_URL` / `AUTH_POSTGRES_URL`，只说用途不列全部变量）。
5. `## 十条要点` —— 10 条 bullet，每条一句，覆盖：Server Action 为唯一写通道、RSC 首屏 + TanStack Query 交互、双连接双角色、RLS 是兜底不是替代、公开 ID 不是凭证、多步写单事务、软删且无回收站、零后台任务、无 i18n 框架、单文件 ≤400 行与 `process.env` 只在 `lib/config.ts`。
6. `## 架构刻意不做什么` —— 表格（列：不做 | 理由 | 什么条件下重新考虑）。至少 6 行：后台任务/队列、匿名公开页面、编辑锁、回收站、i18n 框架、浏览器 auth client。条件写可观察的触发信号（如「出现需要分钟级以上的异步处理」）。

- [ ] **Step 3: 验证头字段与锚点**

Run: `head -15 docs/architecture/01-架构总览.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 事实断言**

Run: `grep -c "APP_POSTGRES_URL\|AUTH_POSTGRES_URL" docs/architecture/01-架构总览.md`
Expected: ≥1（两个变量名必须拼写正确，去 `lib/config.ts` 核对）

- [ ] **Step 5: 验证无禁用措辞与状态词**

Run: `pnpm docs:check 2>&1 | grep "01-架构总览" | grep -v "不存在"` 与 `grep -n "未实现\|部分实现\|已完成" docs/architecture/01-架构总览.md`
Expected: 前者无输出；后者无输出

- [ ] **Step 6: 提交**

```bash
git add docs/architecture/01-架构总览.md
git commit -m "docs(architecture): add 01 architecture overview"
```

---

### Task 3: `02-架构目标与约束.md`

**Files:**
- Create: `docs/architecture/02-架构目标与约束.md`

**Interfaces:**
- Consumes: `./00-文档说明.md#术语表`
- Produces: 无

- [ ] **Step 1: 读来源**

读旧 `docs/architecture/01-drivers.md`（全文 52 行）与 `docs/prd.md`（范围与非目标小节）、`docs/decisions/0005-zero-background-jobs.md`、`0009-dependency-and-runtime-stance.md`。提取：业务目标 G1–G6 的编号与含义、约束分类。

- [ ] **Step 2: 写文件**

头：标题 `# 架构目标与约束`，长度上限 3 页。正文四节：

1. `## 业务目标` —— 表格（列：编号 | 目标 | 现在靠什么支撑 | 相关文档）。保留旧文件的 G1–G6 编号（不要重编号，其他文档可能引用）。「现在靠什么支撑」写代码事实，不写「未来会」。
2. `## 质量属性` —— 表格（列：属性 | 场景（刺激→响应） | 目标值或判定方式）。至少 6 行：性能（页面首屏 P95）、可用性（单区域故障时的行为）、可扩展性（数据量增长 10 倍）、安全（越权尝试）、可维护性（单文件行数、依赖方向）、可操作性（一次发布的最短路径）。目标值只写 `08-非功能性设计.md` 会重复定义的那几个，不在这里造新数字。
3. `## 约束` —— 三张子表或一张分组表，分「技术约束」「合规/数据约束」「团队约束」。技术：Node 24、TypeScript 7 `strict` + 4 条额外检查、PostgreSQL 18（依赖 `uuidv7()`）、无后台任务、无 i18n 框架、单文件 ≤400 行、`process.env` 只在 `lib/config.ts`。合规/数据：邮箱只读、密码 scrypt 且应用不接触哈希、业务表软删、`organization_member`/`invite` 硬删、无审计表。团队：单人/小团队、无专职 DBA、评审靠 CI 门禁。
4. `## 驱动因素 → 设计决策的映射` —— 表格（列：驱动因素 | 落到哪个设计 | 记录在哪）。至少 5 行，链接 `../decisions/0005-zero-background-jobs.md`、`0006-rls-isolation.md`、`0007-self-hosted-better-auth.md`、`0008-read-only-route-handlers.md`、`0013-next-react-runtime-layer.md`。**链接前先 `ls docs/decisions/` 确认文件存在。**

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/02-架构目标与约束.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 验证 G 编号与 ADR 链接**

Run: `grep -c "^| G[1-6] " docs/architecture/02-架构目标与约束.md` 与 `pnpm docs:check 2>&1 | grep "02-架构目标与约束"`
Expected: 前者 `6`；后者无「链接目标不存在」以外的 issue

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/02-架构目标与约束.md
git commit -m "docs(architecture): add 02 goals and constraints"
```

---

### Task 4: `03-逻辑视图-模块设计.md`

**Files:**
- Create: `docs/architecture/03-逻辑视图-模块设计.md`

**Interfaces:**
- Consumes: `./00-文档说明.md#术语表`
- Produces: 必须含标题 `## 模块职责与所有权`（`04-数据视图-数据架构.md` 会链接它说明「表 owner 在这里定义」）。

- [ ] **Step 1: 读来源**

读旧 `docs/architecture/03-components.md`（全文 109 行，§4 与 §7）、`docs/implementation-status.md` §1.5（目录树与「哪块代码在哪」）、`biome.json`（`noRestrictedImports` 的三条规则原文）、`scripts/check-file-size.mjs` 与 `scripts/check-env-access.mjs`（F6/F7 的实际判定）。读 `ls lib/` 与 `ls lib/db/` 确认域目录真实存在。

- [ ] **Step 2: 写文件**

头：标题 `# 逻辑视图：模块设计`，长度上限 6 页。正文七节：

1. `## 分层` —— 四层与依赖方向，一张 mermaid 或代码块箭头图：`app/` 页面与 Route Handler → `lib/<domain>/actions.ts` → `lib/db/queries/` → `lib/db/drizzle.ts` → PostgreSQL。写清每层的**职责一句话**与**禁止事项一句话**。
2. `## 目录结构` —— 代码块目录树，只列到二级，逐行注释职责。顶层固定为 `app/` `components/` `lib/` `hooks/` `tests/` `scripts/` `data/` `docs/`。**必须显式写一句「没有 `src/modules`」**——`AGENTS.md` 反复强调这条。
3. `## 模块职责与所有权` —— 表格（列：域 | 拥有的表 | 入口文件）。行：`auth`、`organization`、`project`、`folder`、`lineage`、`content`（`article`）、`publishing`（`book`/`book_catalog`）。表名从 `lib/db/schema/` 实读。`content`/`publishing` 行在「入口文件」列写「表已落库；尚无 Action 与页面引用」（这是代码存在性，不是需求状态，允许）。
4. `## 依赖方向规则` —— 表格（列：规则 | 执行方式）。三条由 Biome `noRestrictedImports` 自动拦截（客户端组件不得 import `@/lib/db/*`；`lib/db/**` 不得 import `next/*`；`lib/db/queries/**` 不得 import Actions），三条靠评审（业务连接只在 `lib/db/drizzle.ts`、认证连接只在 `lib/db/auth-db.ts`；`lib/<domain>` 不得 import `app/`/`components/`；业务代码不得访问 `auth.*`）。**必须写明「新增规则前先确认它能在 CI 里变红」**，并链接 `./08-非功能性设计.md`。
5. `## 领域模型` —— 一张 mermaid `erDiagram`，实体为：`organization`、`organization_member`、`project`、`folder`、`lineage`、`node`、`activity_logs`、`person`/`family`/`event`（事实层，画成一组）。只画关系与基数，**不画字段**；图下一句「字段级定义见 [数据模型](../data-model.md)」。
6. `## 事务边界` —— 三句规则：一个写入口一个事务；事务由 Action 或 `*-services.ts` 打开，同一流程只开一次；`*Tx` 变体只接收已有事务。附一张表（列：场景 | 在哪开事务 | 例子），至少 3 行（单步 CRUD / 多步组织写 / 谱系移动删除）。
7. `## 代码组织约定` —— 垂直切片优先、何时才抽独立 service（三条判据：被 ≥2 个入口调用、需跨模块共享事务、需被后台任务复用）、文件与命名规则（kebab-case 文件、PascalCase 组件、camelCase 函数、`SCREAMING_SNAKE` 常量、snake_case 列）。命名规则只写规则表，不抄 `AGENTS.md` 原文段落。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/03-逻辑视图-模块设计.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 事实断言（模块与规则）**

Run:
```bash
grep -c "^| \`auth\`\|^| \`organization\`\|^| \`project\`\|^| \`folder\`\|^| \`lineage\`" docs/architecture/03-逻辑视图-模块设计.md
grep -n "src/modules" docs/architecture/03-逻辑视图-模块设计.md
grep -n "noRestrictedImports 待接入" docs/architecture/03-逻辑视图-模块设计.md
```
Expected: 第一条 `5`；第二条恰好 1 行且是「没有 `src/modules`」那句；第三条无输出（这条正是 `tests/docs-consistency.test.ts` 断言的，Task 16 会改测试路径但保留断言）

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/03-逻辑视图-模块设计.md
git commit -m "docs(architecture): add 03 logical view and module design"
```

---

### Task 5: `04-数据视图-数据架构.md`

**Files:**
- Create: `docs/architecture/04-数据视图-数据架构.md`

**Interfaces:**
- Consumes: `./00-文档说明.md#术语表`、`./03-逻辑视图-模块设计.md`
- Produces: 必须含标题 `## 表分组`（`12-需求追溯矩阵.md` 会引用它说明模块归属）。

- [ ] **Step 1: 读来源**

读旧 `docs/architecture/05-data.md`（全文 81 行）、`docs/data-model.md` 的**章节目录与表清单**（不要逐列读）、`docs/implementation-status.md` §1.1、`lib/db/schema/` 的导出（`ls` + 每个文件顶部的注释即可）。读 `lib/db/drizzle.ts` 确认 `withOrg` 与 `SET LOCAL ROLE app_rw` 的实现要点。读 `docs/decisions/0003-tree-storage-ltree.md`、`0004-soft-delete-forever.md`、`0006-rls-isolation.md`。

- [ ] **Step 2: 写文件**

头：标题 `# 数据视图：数据架构`，长度上限 6 页。正文七节：

1. `## 存储选型` —— 表格（列：关注点 | 现在是什么 | 为什么）。行：数据库（PostgreSQL 18+，需要 `uuidv7()` 与 ltree）、ORM（Drizzle，迁移即 SQL）、部署（Neon，分支与 PITR）、本地（Docker PostgreSQL + `next dev`）、驱动（本地/CI `postgres.js`，Vercel `pg` + `attachDatabasePool`）。
2. `## 表分组` —— 表格（列：分组 | 表 | 一句话职责）。四组：认证（`auth.users`/`auth.session`/`auth.account`/`auth.verification`，归 Better Auth）、组织与成员（`organization`/`organization_member`/`invite`/`activity_logs`）、内容（`project`/`folder`/`lineage`/`node`/`article`/`book`/`book_catalog`）、事实层（`person`/`person_name`/`family`/`family_partner`/`family_child`/`event`）。**不写总表数**。表名从 `lib/db/schema/` 实读核对。
3. `## 隔离三层` —— 三条 bullet + 一张表：应用层按成员关系过滤（`withOrg` + `orgId` 条件）、数据库 RLS（`app_rw` 角色，策略调 `auth.has_org_role`）、复合外键（租户列不可变）。写明「RLS 是兜底，不是替代品」与「三个连接角色：`app`→`app_rw`、`auth_runtime`→`auth_service`」。
4. `## 一致性与约束` —— 表格（列：约束 | 落在哪 | 违反时的行为）。行：成员唯一 `(organization_id, user_id)`、单组织仅一个 `owner`（部分唯一索引 + 触发器）、角色 `CHECK`、待处理邀请 `(organization_id, lower(email))` 部分唯一、活动邮箱唯一、`23505`/`23514`/`23503` 转中文提示。写「多步写在单事务内完成，失败不留半成品」。**不写 SQL、不写 DDL**。
5. `## 数据流` —— 一个 mermaid 图：写入路径（Action → `withOrg` 事务 → 表）与读取路径（RSC → `queries` → 表），标出 RLS 与复合外键在哪个环节生效。
6. `## 生命周期` —— 表格（列：数据 | 创建 | 软删/硬删 | 恢复可能）。覆盖：业务表软删（`deleted_at`，查询默认 `isNull`）、`organization.deleted_at` 表示归档、`organization_member`/`invite` 硬删、`auth.session` 7 天过期 1 天滑动续期、事实层回填与对账脚本（`data:backfill:fact`、`data:reconcile:fact`）。
7. `## 容量与增长口径` —— 一张表（列：维度 | 口径 | 现状风险）。维度：组织数、单组织成员数、单谱系人丁数、活动日志增长、事实层双写体积。口径写「按什么单位估」，**不写编造的容量数字**；风险写「活动日志无归档策略」「事实层与 `node` 双写期间体积翻倍」这类可验证的事实。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/04-数据视图-数据架构.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 反目标校验（不抄第二份真相）**

Run:
```bash
grep -nE "text\('|uuid\(|varchar\(|CREATE POLICY|CREATE INDEX" docs/architecture/04-数据视图-数据架构.md
grep -c "has_org_role" docs/architecture/04-数据视图-数据架构.md
grep -n "organization_id IN (SELECT" docs/architecture/04-数据视图-数据架构.md
```
Expected: 第一条无输出；第二条 ≥1（策略**名称**允许出现，策略**体**不允许）；第三条无输出

- [ ] **Step 5: 验证表名与 schema 一致**

Run: 从 `lib/db/schema/` 列出真实表名，逐个在文档里 grep 确认拼写一致（`grep -c "<表名>" docs/architecture/04-数据视图-数据架构.md` 均 ≥1）
Expected: 六张事实层表 + 七个内容表 + 三个组织表全部命中

- [ ] **Step 6: 提交**

```bash
git add docs/architecture/04-数据视图-数据架构.md
git commit -m "docs(architecture): add 04 data view"
```

---

### Task 6: `05-接口与集成设计.md`

**Files:**
- Create: `docs/architecture/05-接口与集成设计.md`

**Interfaces:**
- Consumes: `./00-文档说明.md#术语表`
- Produces: 必须含标题 `## 接口形态总览`（`12-需求追溯矩阵.md` 会引用它作为「接口」列的口径）。

- [ ] **Step 1: 读来源**

读 `docs/api.md` 的**章节目录**、`docs/implementation-status.md` §1.3（4 个 Route Handler 的路径与 DTO 说明）、`app/api/**/route.ts` 四个文件（读实现，确认路径、状态码、`withApiLogging` 用法）、`lib/api.ts`、`lib/auth/actions/`（目录） 里的 `validatedAction`/`validatedActionWithUser`、`lib/errors.ts` 的 `actionError()` 与错误码清单、`lib/auth/schemas.ts` 与 `lib/genealogy/schemas.ts` 的导出名。读 `docs/decisions/0008-read-only-route-handlers.md`。

- [ ] **Step 2: 写文件**

头：标题 `# 接口与集成设计`，长度上限 6 页。正文六节：

1. `## 接口形态总览` —— 表格（列：通道 | 用途 | 数量或范围 | 授权方式）。四行：RSC（首屏读，全部页面，`requireOrgContext`/`requireProjectContext`）、Server Action（唯一写通道 + 工作区读刷新，`lib/<domain>/actions.ts`，`validatedAction*` + `hasPermission`）、Route Handler（只读刷新与健康检查，路径枚举 4 条，`getSessionUser` + `getOrgRole`）、TanStack Query（客户端缓存，读只读 Route Handler）。**必须写明「认证类 handler 数量为 0，不新增 `/api/auth/*`」**。
2. `## Server Action 契约` —— 表格（列：要素 | 约定）。行：入参（Zod schema，位置在 `lib/auth/schemas.ts` 与 `lib/genealogy/schemas.ts`）、包装器（`validatedAction` / `validatedActionWithUser`）、返回值（`ActionState`：`error`/`success`/`fieldErrors`，可带稳定 `code`）、错误文案（简体中文，不回显密码、不抛堆栈）、副作用（`revalidatePath`，按需 `invalidateQueries`）。**不列具体 Action 清单**——那是 `api.md` 的职责；只给 2 个代表性 Action 的签名作为示例。
3. `## Route Handler 清单` —— 表格（列：路径 | 方法 | 用途 | 授权 | 状态码类别）。四行，路径逐字：`/api/health`、`/api/orgs`、`/api/orgs/[orgId]/projects`、`/api/user`。状态码只写类别（`200`/`401`/`403`/`404`），DTO 字段写「见 [接口契约](../api.md)」。写一句：错误体是英文 JSON，用户可见文案是中文。
4. `## 外部集成` —— 三个子小节：`### 认证（Better Auth）`（自托管、数据库会话、`auth.*` schema、应用不接触哈希、不建浏览器 auth client、不建 `/api/auth/*`）、`### 数据库`（双连接、两个登录角色、`attachDatabasePool` 只在 Vercel）、`### 部署平台`（Vercel 函数、环境变量分必需/可选两组，逐条说明链 `ops-target.md`）。每节结尾一句话说明「集成失败时系统怎么表现」。
5. `## 消息与事件` —— 明确写：当前没有队列、没有定时器、没有事件总线；`activity_logs` 是**产品活动流表**，不是领域事件，写入与业务写在同一个事务里。写一句「引入后台任务的前提条件」并链接 `../decisions/0005-zero-background-jobs.md`。
6. `## 协议与数据格式` —— 一句一个：浏览器 ↔ 服务端 = HTTP/2 + React Flight（RSC）；Action = POST + Flight 序列化；Route Handler = JSON；数据库 = PostgreSQL wire protocol（`postgres.js` / `pg`）。限流：`checkRateLimit` 是进程内实现，只能当辅助，不作为安全边界。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/05-接口与集成设计.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 事实断言（路径与状态码）**

Run:
```bash
for p in "/api/health" "/api/orgs" "/api/orgs/\[orgId\]/projects" "/api/user"; do grep -c "$p" docs/architecture/05-接口与集成设计.md; done
find app/api -name route.ts | wc -l
grep -n "ActionResult\|revalidateTag" docs/architecture/05-接口与集成设计.md
```
Expected: 四个计数均 ≥1；`find` 输出 `4` 与文档枚举一致；最后一条无输出

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/05-接口与集成设计.md
git commit -m "docs(architecture): add 05 interface and integration design"
```

---

### Task 7: `06-部署视图-部署架构.md`

**Files:**
- Create: `docs/architecture/06-部署视图-部署架构.md`

**Interfaces:**
- Consumes: `./00-文档说明.md#术语表`
- Produces: 必须含标题 `## 环境矩阵`

- [ ] **Step 1: 读来源**

读旧 `docs/architecture/02-context.md` §3（部署视图）与 §10（部署拓扑）、`docs/ops-target.md` 的章节目录与「环境」小节、`.github/workflows/ci.yml` 全文（提取 job/step 顺序）、`package.json` 的 scripts、`next.config.*`、`docs/decisions/0013-next-react-runtime-layer.md`。

- [ ] **Step 2: 写文件**

头：标题 `# 部署视图：部署架构`，长度上限 5 页。正文六节：

1. `## 容器视图（C4-L2）` —— 一个 mermaid `flowchart`：浏览器 → Vercel Edge/Function（Next.js 应用）→ Neon PostgreSQL（两个数据库或两个角色）；标注 TLS、连接池。
2. `## 部署单元（C4-L3）` —— 表格（列：部署单元 | 跑什么 | 伸缩单位 | 冷启动影响）。行：Vercel 函数（RSC 渲染、Server Action、Route Handler）、Neon 计算实例（连接池 + 自动挂起）、本地 Docker（仅 PostgreSQL）、CI runner（构建与测试）。**不写具体实例规格或价格**。
3. `## 环境矩阵` —— 表格（列：环境 | 数据库 | 驱动 | 认证连接 | 启动方式）。行：本地开发（Docker PostgreSQL，`postgres.js`，`.env` 读取，`pnpm dev`）、本地生产模式（同上但 `pnpm build && pnpm start`）、CI（`postgres:18` service，`_test` 结尾的库）、生产（Neon，`pg` + `attachDatabasePool`，Vercel）。每格写事实，不写「应该」。
4. `## CI/CD 流水线` —— 有序列表，阶段名逐字取自 `ci.yml`：Install dependencies → Lint & format check → Docs consistency → Architecture constraints (F6/F7) → Typecheck → Migrate test database → Provision runtime login roles → Unit + integration tests with coverage → Upload coverage → Check migration drift → Build → Install Playwright browser → E2E critical path → Upload Playwright artifacts → Deployment verification。每个阶段一句话说「它挡住什么」。写清「哪几步会真正拦发布」。
5. `## 发布与回滚` —— 三句：发布即 `main` 合并触发 Vercel 构建；迁移与业务代码分开提交，先迁移后代码；回滚靠 Vercel 重新部署上一版本 + Neon 分支/PITR，**没有应用层回滚脚本**。
6. `## 扩缩容与连接**` —— 写清三件事：函数实例无状态、可水平扩；连接池 `attachDatabasePool` 只用于 Vercel，避免连接耗尽；RLS 与 `SET LOCAL` 依赖连接复用安全（会话级 `SET` 会污染连接池）。附一句容量观测手段（Neon 指标 + 日志），细节链 `../ops-target.md`。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/06-部署视图-部署架构.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 事实断言（CI 阶段顺序）**

Run:
```bash
grep -c "^- " docs/architecture/06-部署视图-部署架构.md
grep -n "Docs consistency" docs/architecture/06-部署视图-部署架构.md
grep -n "Provision runtime login roles" docs/architecture/06-部署视图-部署架构.md
```
Expected: 第一条 ≥15；后两条各命中 1 次且拼写与 `ci.yml` 完全一致

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/06-部署视图-部署架构.md
git commit -m "docs(architecture): add 06 deployment view"
```

---

### Task 8: `07-运行视图-关键流程.md`

**Files:**
- Create: `docs/architecture/07-运行视图-关键流程.md`

**Interfaces:**
- Consumes: `./00-文档说明.md#术语表`、`./03-逻辑视图-模块设计.md`、`./04-数据视图-数据架构.md`
- Produces: 必须含标题 `## 写路径`

- [ ] **Step 1: 读来源**

读旧 `docs/architecture/04-runtime.md`（全文 192 行，§5 运行时视图、§6 前端架构）、`lib/auth/context.ts`（`requireOrgContext`/`getOrgContext`/`requireProjectContext`/`getProjectContext`）、`lib/db/drizzle.ts`（`withOrg`）、`lib/db/services.ts`（多步事务）、`lib/lineage/` 下的 `*-services.ts`（列出真实文件名）、`proxy.ts`、`lib/ids.ts`（`generatePublicId`、`isPublicId`）、`lib/lineage/nav.ts`、`components/query-provider.tsx`、`lib/query-keys.ts`。

- [ ] **Step 2: 写文件**

头：标题 `# 运行视图：关键流程`，长度上限 7 页。正文七节：

1. `## 读路径` —— 一个 mermaid `sequenceDiagram`：浏览器 → `proxy.ts`（乐观门禁，只查 cookie 是否存在）→ RSC 页面 → `requireOrgContext(orgSlug)`（`isPublicId` 校验 → `getSessionUser()` 查库 → 成员校验 → 非成员/不存在 `notFound()`）→ `lib/db/queries/<domain>.ts`（`withOrg` + `orgId`）→ 返回 → `dehydrate`/`HydrationBoundary` 注入 → 客户端 `useQuery` 用 `lib/query-keys.ts` 的 key 读取。图后 4 条 bullet 说明每步的失败表现。
2. `## 写路径` —— 一个 mermaid `sequenceDiagram`：表单（`noValidate` + `useActionState`）→ Server Action（`validatedActionWithUser` → Zod）→ `hasPermission(role, '<permission>')` → 单步走 `lib/db/queries`，多步走 `*-services.ts` 单事务（事务内 `getOrgRoleInTx` 锁定读复核）→ 写 → `revalidatePath` → 返回 `ActionState`。图后说明：失败返回中文文案不抛异常；不串联多个独立写。
3. `## 多步事务时序` —— 三个子小节，每个一个 mermaid `sequenceDiagram` 或有序列表：`### 注册与默认组织`、`### 接受邀请`、`### 成员角色变更 / 删号`。每步写「失败时回滚到什么状态」。事实从 `lib/db/services.ts` 实读。
4. `## 状态机` —— 两张状态图或表格：`### 组织`（`active` / 归档 `deleted_at`，触发与不可逆点）、`### 人丁 node`（`path` 树位置 + `deleted_at` 软删；移动、删除、恢复的可能性）。写明「没有回收站，软删后无 UI 恢复路径」。
5. `## 并发与冲突` —— 三句事实：没有编辑锁（ADR 0002）；并发写靠事务 + 唯一约束兜底；`ref` 冲突时重新生成最多重试 3 次。链接 `../decisions/0002-no-edit-lock.md`。
6. `## 异常与补偿` —— 表格（列：异常 | 现在怎么处理 | 有没有补偿）。行：数据库约束冲突（`23505`/`23514`/`23503` → 中文提示）、事务中途失败（整体回滚）、认证失败（401/重定向登录）、权限不足（中文提示 / 403）、外部系统不可用（Neon 不可用 → 500，无降级）。明确写「**没有补偿任务、没有重试队列**」。
7. `## 前端渲染与交互` —— 表格（列：场景 | 渲染方式 | 状态来源）。行：首屏（RSC + dehydrate）、交互工作区（TanStack Query + `query-keys`）、谱系画布（zustand store 只存视图状态，不存实体、不 persist）、打印视图（RSC）。写清 `refetchOnMount` 不单独设置、新鲜度只由 `createQueryClient` 的 `staleTime` 决定。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/07-运行视图-关键流程.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 事实断言（函数名拼写）**

Run:
```bash
for f in requireOrgContext getOrgContext requireProjectContext withOrg getOrgRoleInTx validatedActionWithUser generatePublicId isPublicId; do grep -c "$f" docs/architecture/07-运行视图-关键流程.md; done
grep -c '```mermaid' docs/architecture/07-运行视图-关键流程.md
```
Expected: 八个函数名计数均 ≥1；mermaid 代码块 ≥4

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/07-运行视图-关键流程.md
git commit -m "docs(architecture): add 07 runtime view"
```

---

### Task 9: `08-非功能性设计.md`

**Files:**
- Create: `docs/architecture/08-非功能性设计.md`

**Interfaces:**
- Consumes: `./00-文档说明.md#术语表`、`./02-架构目标与约束.md`（质量属性编号）
- Produces: 必须含标题 `## Fitness functions`（`03-逻辑视图-模块设计.md` 会链接它说明「新规则要能在 CI 变红」）。

- [ ] **Step 1: 读来源**

读旧 `docs/architecture/07-quality.md`（全文 71 行，§11 质量属性与验证、§11.1 场景、§11.2 fitness function）、`scripts/check-file-size.mjs`、`scripts/check-env-access.mjs`、`scripts/check-docs.mjs` 的规则清单、`scripts/verify-deployment.mjs`、`vitest.config.*` 的覆盖率阈值、`package.json` 的 `test:coverage`。

- [ ] **Step 2: 写文件**

头：标题 `# 非功能性设计`，长度上限 4 页。正文五节：

1. `## 质量属性与目标` —— 表格（列：属性 | 目标 | 现在的实际手段 | 未达标时的症状）。至少 6 行：性能（首屏与交互的可接受延迟）、可用性（单区域、无降级设计）、可扩展性（组织数/人丁数增长时先坏在哪）、安全（越权与信息泄露）、可维护性（单文件行数、依赖方向）、可运维性（一次发布与一次回滚的步骤数）。**目标值只写能从现有脚本/配置读出来的**（如单文件 400 行、覆盖率阈值），其余写定性判定。
2. `## 容量口径` —— 一张表（列：维度 | 估算方式 | 现在的约束）。维度：组织数、单组织成员、单谱系人丁、活动日志年增长、事实层双写体积、函数并发。**不编造数字**，写「按 X 估算，约束是 Y」。
3. `## 可扩展性边界` —— 有序列表，写清会先坏的三个点与对应触发信号：活动日志无归档、谱系画布单页渲染窗口、连接池上限。每条给「先坏的症状」。
4. `## Fitness functions` —— 表格（列：编号 | 约束 | 执行者 | 违反时）。行必须**只列真有执行者的**：F3（单文件 ≤400 行，`scripts/check-file-size.mjs`，存量豁免只许缩不许涨）、F5（RLS 策略调 `auth.has_org_role`，`scripts/verify-deployment.mjs` 查 `pg_policies`）、F6/F7（`pnpm arch:check`）、F8（文档链接/锚点/措辞，`pnpm docs:check --strict`）、F9（依赖方向三条，Biome `noRestrictedImports`）、F10（迁移漂移，CI `Check migration drift`）。**不出现 F1/F2/F4，不出现 `| F2 |`**（`tests/docs-consistency.test.ts` 会断言这两条）。表后一句：「没有执行者的约束不是约束，删掉而不是承诺」。
5. `## 性能取舍` —— 四句：读路径按渲染单元合并查询而不是逐组件查；不做 N+1（列表页关联数据用 `with` 或一次 `IN`）；首屏走 RSC 不用客户端瀑布；画布用渲染窗口限制同屏节点数。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/08-非功能性设计.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 事实断言（Fitness function 与执行者）**

Run:
```bash
grep -nE "F1/F2/F4|\| F2 \|" docs/architecture/08-非功能性设计.md
for s in check-file-size.mjs check-env-access.mjs verify-deployment.mjs check-docs.mjs; do grep -c "$s" docs/architecture/08-非功能性设计.md; done
```
Expected: 第一条无输出；四个脚本名计数均 ≥1

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/08-非功能性设计.md
git commit -m "docs(architecture): add 08 non-functional design"
```

---

### Task 10: `09-安全架构.md`

**Files:**
- Create: `docs/architecture/09-安全架构.md`

**Interfaces:**
- Consumes: `./00-文档说明.md#术语表`、`./04-数据视图-数据架构.md`
- Produces: 必须含标题 `## 授权矩阵`

- [ ] **Step 1: 读来源**

读旧 `docs/architecture/06-crosscutting.md` §9.4（安全）、`lib/auth/access-control.ts`（`ORG_ROLES`、`ORG_PERMISSIONS`、`roles` 的 `authorize` 实现、`PERMISSION_REQUESTS`）、`lib/auth/permissions.ts`（`hasPermission`、`getOrgRoleInTx`、`PERMISSION_DENIED_MESSAGES`）、`lib/auth/better-auth.ts`、`lib/db/auth-db.ts`、`proxy.ts`、`lib/auth/context.ts`、`docs/decisions/0006-rls-isolation.md`、`0007-self-hosted-better-auth.md`、`0016-*.md`（先 `ls docs/decisions/` 确认真实文件名）。

- [ ] **Step 2: 写文件**

头：标题 `# 安全架构`，长度上限 5 页。正文七节：

1. `## 认证` —— 自托管 Better Auth 1.7.12、数据库会话（表在 `auth` schema）、密码 scrypt 且应用不接触哈希、关闭 cookie cache、邮箱只读且验证关闭。一张表（列：会话参数 | 值）：过期 7 天、滑动续期 1 天、撤销即时生效、`changePassword({ revokeOtherSessions: true })` 语义。**不写具体 cookie 名以外的密钥信息**。
2. `## 会话校验链路` —— 三条 bullet：`proxy.ts` 是乐观门禁（只查 cookie 存在，**不是授权边界**）、`getSessionUser()` 是权威校验（`auth.api.getSession` 查库 + 请求级缓存）、页面/Action/Route 内再做组织成员校验。写明「只信 Cookie 存在而不查库 = 伪造/过期会话通过」。
3. `## 授权矩阵` —— 表格：行 = 4 个角色（`owner`/`admin`/`editor`/`viewer`），列 = 9 个权限（`content.read`、`lineage.write`、`article.write`、`book.write`、`project.write`、`member.invite`、`member.manage`、`org.settings`、`org.transfer`），格内 `✓`/`—`。**必须从 `lib/auth/access-control.ts` 的 `roles` 定义逐个推导，不许凭直觉填**。表后写判定入口 `hasPermission(role, permission)`，并写「业务代码检查权限字符串，不比较角色名」。权限字符串全集只给这一张表的列头，不再另列代码常量。
4. `## 租户隔离` —— 四条 bullet：应用层按成员关系过滤、RLS 兜底（`app_rw` + `auth.has_org_role`）、复合外键 + 租户列不可变、公开 ID 不是授权凭证（能猜到 `slug`/`ref` 不等于能访问；非成员与不存在一律 404）。链接 `./04-数据视图-数据架构.md`。
5. `## 威胁建模` —— 表格（列：威胁 | 现在的缓解 | 残余风险）。至少 8 行，覆盖：越权读（猜 ID）、越权写（伪造 `orgId`/角色）、会话伪造/固定、密码泄露、密钥进 bundle（`BETTER_AUTH_SECRET`）、SQL 注入、信息泄露（整行用户/堆栈）、限流绕过（进程内限流重启清零）、唯一 owner 被删导致无主组织、硬删除不可恢复。每行「残余风险」写「已接受」或具体缺口。
6. `## 数据安全` —— 四句：密码 scrypt 不可逆；日志不记录密码/token/身份证/完整住址；返回给 UI 只传 `SessionUser`（`{ id, name, email }`），不传整行；`organization_member`/`invite` 是硬删除，生产清理走工单与备份。
7. `## 合规与审计现状` —— 明确写：没有独立审计表，`activity_logs` 是产品活动流、不等于审计日志；没有数据导出/删除请求流程；没有 GDPR 类合规评估。写「做合规前需要先补什么」三条。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/09-安全架构.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 事实断言（角色 × 权限矩阵）**

Run:
```bash
grep -c "^| \`owner\`\|^| \`admin\`\|^| \`editor\`\|^| \`viewer\`" docs/architecture/09-安全架构.md
for p in content.read lineage.write article.write book.write project.write member.invite member.manage org.settings org.transfer; do grep -c "$p" docs/architecture/09-安全架构.md; done
```
Expected: 第一条 `4`；九个权限计数均 ≥1

- [ ] **Step 5: 人工核对矩阵**

打开 `lib/auth/access-control.ts`，逐个角色 × 权限比对文档表格的 `✓`/`—`。任何一格不一致就改文档（不改代码）。在提交信息里注明「矩阵已对照 `lib/auth/access-control.ts` 核对」。

- [ ] **Step 6: 提交**

```bash
git add docs/architecture/09-安全架构.md
git commit -m "docs(architecture): add 09 security architecture (matrix cross-checked against access-control.ts)"
```

---

### Task 11: `10-可观测性与运维.md`

**Files:**
- Create: `docs/architecture/10-可观测性与运维.md`

**Interfaces:**
- Consumes: `./00-文档说明.md#术语表`、`./06-部署视图-部署架构.md`
- Produces: 无

- [ ] **Step 1: 读来源**

读旧 `docs/architecture/06-crosscutting.md` §9.3（日志）与 §9.5、`lib/logger.ts`（字段与 `AsyncLocalStorage` 用法）、`lib/server/request-context.ts`（若存在；否则用 `ls lib/server/` 找真实文件名）、`lib/api.ts` 的 `withApiLogging`、`app/api/health/route.ts`、`docs/guides/runbooks.md` 全文、`docs/ops-target.md` 的「监控/告警」小节。

- [ ] **Step 2: 写文件**

头：标题 `# 可观测性与运维`，长度上限 4 页。正文六节：

1. `## 日志` —— 表格（列：字段 | 来源 | 何时出现）。行：`level`、`msg`、`request_id`、`user_id`、`duration_ms`（仅 Route Handler）、`route`。写清「结构化 JSON、服务端自动注入、业务代码不散落 `console.log`」，以及「禁止记录的内容」清单。
2. `## 健康检查` —— `/api/health` 的用途、返回什么（不写字段级 DTO，链 `../api.md`）、它**不检查数据库**这一事实，以及因此带来的盲区。
3. `## 错误处理与用户可见文案` —— 三句：Server Action 返回 `ActionState`（中文文案 + 稳定 `code`）；Route Handler 返回英文 JSON + 明确状态码；不把数据库错误/堆栈展示给用户。写清 `lib/errors.ts` 的 `actionError()` 是唯一入口。
4. `## 告警与监控现状` —— 明确写：没有外部告警系统、没有 APM、没有追踪（trace）；现有观测手段只有 Vercel 日志与 Neon 指标。表格（列：想知道的事 | 现在怎么看 | 缺口）。
5. `## 故障处理` —— 表格（列：症状 | 先查什么 | 处置）。至少 6 行：登录不上（cookie `Secure` + 非 localhost 域名）、500 集中出现（Neon 连接/连接池耗尽）、Action 全部报权限（角色读取或 RLS 配置）、迁移未应用（构建成功但运行报列不存在）、构建通过但 E2E 失败、硬删除误操作。每条链 `../guides/runbooks.md` 的对应小节（**先读 runbooks 确认小节标题存在**）。
6. `## 恢复能力` —— 表格（列：场景 | 手段 | 最坏情况的数据损失）。行：误删业务数据（软删可查库恢复，无 UI）、硬删成员/邀请（不可恢复，靠备份）、Neon 故障（PITR / 分支）、发布引入缺陷（Vercel 回滚 + 先迁移后代码的顺序约束）。写「当前没有应用层备份脚本」。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/10-可观测性与运维.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 事实断言（日志字段）**

Run:
```bash
for f in request_id user_id duration_ms withApiLogging; do grep -c "$f" docs/architecture/10-可观测性与运维.md; done
grep -n "没有外部告警\|没有 APM" docs/architecture/10-可观测性与运维.md
```
Expected: 四个计数均 ≥1；最后一条 ≥1

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/10-可观测性与运维.md
git commit -m "docs(architecture): add 10 observability and operations"
```

---

### Task 12: `11-技术选型与决策记录.md`

**Files:**
- Create: `docs/architecture/11-技术选型与决策记录.md`

**Interfaces:**
- Consumes: `./00-文档说明.md#术语表`
- Produces: 必须含标题 `## ADR 索引`（`13-风险与演进规划.md` 会链接它说明「待决策项在哪登记」）。

- [ ] **Step 1: 读来源**

读 `package.json`（dependencies/devDependencies 全量）、`docs/decisions/README.md`（索引与「待决策」表）、`ls docs/decisions/` 列出全部 ADR 文件，逐个读**标题行 + 「决策」小节**（不要通读全文，控制上下文）。读 `docs/implementation-status.md` §1.5 确认工具链版本。

- [ ] **Step 2: 写文件**

头：标题 `# 技术选型与决策记录`，长度上限 5 页。正文四节：

1. `## 技术栈` —— 表格（列：层 | 选型 | 版本 | 为什么是它 | 放弃的替代）。行：框架（Next.js 16 App Router）、语言（TypeScript 7，Go 原生实现）、运行时（Node 24 LTS / pnpm 12）、数据库（PostgreSQL 18）、ORM（Drizzle）、认证（自托管 Better Auth）、客户端数据（TanStack Query 5）、UI 状态（zustand 5，仅谱系工作区）、样式（Tailwind v4 + shadcn/ui）、图（`@xyflow/react` 12）、检查（Biome 2）、测试（Vitest 5 + Playwright 1.64）。版本号**逐字取自 `package.json`**。
2. `## 版本与依赖立场` —— 三条：版本基线锁定在 `package.json`（不在文档里另立基线表）；依赖准入看 ADR 0009；「决策 ≠ 现在安装」（ADR 0010 的富文本编辑器选型尚未安装）。链接对应 ADR。
3. `## ADR 索引` —— 表格（列：编号 | 标题 | 结论一句话 | 可逆性 | 链接）。行数 = `docs/decisions/` 里实际 ADR 文件数（**逐个数，不写「N 篇」这类汇总数字**）。链接形如 `../decisions/0006-rls-isolation.md`。表后写「新增不可逆决策时在这里加一行」。
4. `## 待决策项` —— 只写一句「待决策清单的唯一来源是 [decisions 索引](../decisions/README.md) 的待决策表，本文件不复制」，并列出**当前仍未决**的条目编号与标题（从 `decisions/README.md` 的待决策表实读；注意 `D-1`/`D-2`/`D-3`/`D-5`/`D-7`/`D-9` 已被 linter 判定为「已解决仍在待决策表」，若读到这些编号说明源文件需要修——记录下来交给 Task 16，不要在本文件里复制它们）。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/11-技术选型与决策记录.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 事实断言（版本与 ADR 链接）**

Run:
```bash
ls docs/decisions/*.md | grep -v README | wc -l
grep -c "^| 0[0-9][0-9][0-9] \|^| 0[0-9][0-9][0-9] " docs/architecture/11-技术选型与决策记录.md
grep -n "21 条\|8 篇" docs/architecture/11-技术选型与决策记录.md
grep -c "16.4\|19.3\|7.0.2\|1.7.12" docs/architecture/11-技术选型与决策记录.md
```
Expected: 前两条数字一致（ADR 索引行数 = 实际 ADR 文件数）；第三条无输出；第四条 ≥2

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/11-技术选型与决策记录.md
git commit -m "docs(architecture): add 11 tech stack and ADR index"
```

---

### Task 13: `12-需求追溯矩阵.md`

**Files:**
- Create: `docs/architecture/12-需求追溯矩阵.md`

**Interfaces:**
- Consumes: `./03-逻辑视图-模块设计.md`、`./05-接口与集成设计.md`、`./00-文档说明.md#术语表`
- Produces: 无

- [ ] **Step 1: 读来源**

读 `docs/prd.md` 的**功能需求章节**（提取 FR 编号体系与编号清单；若无编号，按「章-节」编号并在文档里说明这套编号是本文件定义的映射用编号）、`docs/implementation-status.md` §2（功能状态表）与 §3、`ls tests/` 与 `ls tests/**` 列出真实测试文件名、`docs/guides/testing.md`（测试分层）。

- [ ] **Step 2: 写文件**

头：标题 `# 需求追溯矩阵`，长度上限 5 页。正文四节：

1. `## 编号体系` —— 说明本文件用哪套编号、从哪来。若 `prd.md` 无稳定编号，则写明「本文件按 PRD 章节建立映射编号 R-<章>-<序>，仅用于追溯，不改变 PRD 正文」。
2. `## 追溯矩阵` —— 表格（列：需求编号 | 需求摘要 | 模块 | 接口（Action / Route / RSC 页面） | 测试文件 | 状态）。规则：**状态列只放链接**，形如 `[见实现状态](../implementation-status.md)`；不留空、不写「已实现」「未实现」。「测试文件」列写真实存在的路径（`tests/<name>.test.ts` 或 `tests/e2e/<name>.spec.ts`），**没有测试的写 `—`**。
3. `## 覆盖缺口` —— 列出矩阵里「测试文件 = —」的需求，按模块分组。每条一句话说明缺的是单测还是集成测试还是 E2E。这张表是 13 章的输入。
4. `## 目标外已有能力` —— 表格（列：能力 | 代码位置 | 不在 PRD 哪一条里）。列出已实现但 PRD 未显式要求的能力（如打印视图、字辈、按代渲染窗口），避免下次评审以为它们是需求。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/12-需求追溯矩阵.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 事实断言（测试文件与状态列）**

Run:
```bash
grep -c "见实现状态" docs/architecture/12-需求追溯矩阵.md
grep -n "未实现\|已完成\|部分实现" docs/architecture/12-需求追溯矩阵.md
```
Expected: 第一条 ≥5（每行一个链接）；第二条无输出

- [ ] **Step 5: 验证测试路径真实存在**

Run: 把文档里所有 `tests/` 开头的路径抓出来逐个 `test -f`
```bash
grep -oE 'tests/[A-Za-z0-9_./-]+\.(test|spec)\.(ts|tsx)' docs/architecture/12-需求追溯矩阵.md | sort -u | while read -r p; do test -f "$p" || echo "MISSING $p"; done
```
Expected: 无 `MISSING` 输出

- [ ] **Step 6: 提交**

```bash
git add docs/architecture/12-需求追溯矩阵.md
git commit -m "docs(architecture): add 12 requirements traceability matrix"
```

---

### Task 14: `13-风险与演进规划.md`

**Files:**
- Create: `docs/architecture/13-风险与演进规划.md`

**Interfaces:**
- Consumes: `./12-需求追溯矩阵.md`（覆盖缺口）、`./11-技术选型与决策记录.md#ADR 索引` 不适用（用无锚点链接 `./11-技术选型与决策记录.md`）
- Produces: 无

- [ ] **Step 1: 读来源**

读旧 `docs/architecture/08-evolution.md`（全文 80 行，§12 演进路线与条件触发、§14 风险登记簿、§15 待决策）、`docs/implementation-status.md` §5（风险/缺口）、Task 13 产出的 `12-需求追溯矩阵.md` 的「覆盖缺口」小节。

- [ ] **Step 2: 写文件**

头：标题 `# 风险与演进规划`，长度上限 5 页。正文四节：

1. `## 风险登记簿` —— 表格（列：编号 | 风险 | 影响 | 触发信号 | 现在的缓解 | 状态）。保留旧文件的风险编号（R1…），新增的续编号。至少 12 行，覆盖：事实层双写未切换（读写仍在 `node`）、谱文/谱书表存在但无读写路径、无回收站且业务删除不可恢复、`organization_member`/`invite` 硬删、无编辑锁导致并发覆盖、限流是进程内实现、无外部告警、无审计表、迁移与代码同 PR 的风险、单文件 400 行豁免清单只增不减、`ref` 冲突重试上限、Neon 冷启动。「状态」列只写 `已接受` / `缓解中` / `需决策`。
2. `## 技术债偿还顺序` —— 有序列表，每条写「为什么排这个位置」。顺序建议：先补读写路径（事实层切换）→ 再补回收站 → 再补告警 → 最后补审计。
3. `## 演进方向` —— 三条路线，每条写「触发条件 + 第一步做什么 + 不做什么」。方向：家谱业务 M1 收尾（谱文/谱书接入）、多实例化（共享限流与后台任务）、生产化（真实 Vercel/Neon 部署与告警）。**不重新设计目标架构**，只写方向与触发条件。
4. `## 待决策项` —— 一句「唯一来源是 [decisions 索引](../decisions/README.md) 的待决策表」，然后列出影响架构演进的那几条编号与标题。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/13-风险与演进规划.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 事实断言（风险编号与链接）**

Run:
```bash
grep -c "^| R[0-9]\+ " docs/architecture/13-风险与演进规划.md
grep -c "已接受\|缓解中\|需决策" docs/architecture/13-风险与演进规划.md
```
Expected: 第一条 ≥12；第二条 ≥12

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/13-风险与演进规划.md
git commit -m "docs(architecture): add 13 risks and evolution"
```

---

### Task 15: `14-附录.md`

**Files:**
- Create: `docs/architecture/14-附录.md`

**Interfaces:**
- Consumes: 全部 14 份（要索引它们的图）；`./00-文档说明.md#术语表`

- [ ] **Step 1: 收集图集**

Run: `grep -n '```mermaid' docs/architecture/*.md`
把每张图记下来（文件名 + 图前的标题）。这一步必须等 Task 1–14 全部完成后再做。

- [ ] **Step 2: 写文件**

头：标题 `# 附录`，长度上限 4 页。正文五节：

1. `## 图集索引` —— 表格（列：图 | 所在文档 | 用途）。行数 = Step 1 收集到的 mermaid 块数，逐条链接 `./<文件>.md`。
2. `## 术语补充` —— 只放 00 章术语表没覆盖的偏门术语（如 ltree、部分唯一索引、复合外键、`SET LOCAL`、`AsyncLocalStorage`、Flight）。与 00 章不重复。
3. `## 参考资料` —— 外部标准与文档：C4 model、ISO/IEC/IEEE 42010、ADR（Nygard）、Next.js App Router 文档、PostgreSQL 18 文档（`uuidv7()`）、Drizzle 文档、Better Auth 文档、OWASP ASVS。每条给名称 + 链接 + 一句话「本仓库哪份文档用了它」。
4. `## 旧文件对照` —— 表格（列：旧文件 | 新位置 | 备注）。九行：`00-overview.md` → `01`、`01-drivers.md` → `02`、`02-context.md` → `01` + `06`、`03-components.md` → `03`、`04-runtime.md` → `07`、`05-data.md` → `04`、`06-crosscutting.md` → `09` + `10`、`07-quality.md` → `08`、`08-evolution.md` → `13`。备注列写「原章节号在新文档中不再保留」。表后一句：本表保留一个版本周期后删除。
5. `## 变更记录` —— 表格（列：日期 | 变更 | 影响文件）。第一行：`2026-10-30 | 9 份 to-be 文档重构为 15 份 as-is 文档 | docs/architecture/ 全部`。

- [ ] **Step 3: 验证头字段**

Run: `head -15 docs/architecture/14-附录.md | grep -c "回答什么问题\|读者\|长度上限\|目标 vs 现状"`
Expected: `4`

- [ ] **Step 4: 验证图集完整**

Run:
```bash
grep -c '```mermaid' docs/architecture/*.md | grep -v ":0"
grep -c "^| " docs/architecture/14-附录.md
```
Expected: 第一个命令列出的每个文件都在附录图集表里有对应行（人工比对）；第二个 ≥5

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/14-附录.md
git commit -m "docs(architecture): add 14 appendix"
```

---

### Task 16: 收口（删旧、改引用、改定位、全绿）

**Files:**
- Delete: `docs/architecture/00-overview.md`、`01-drivers.md`、`02-context.md`、`03-components.md`、`04-runtime.md`、`05-data.md`、`06-crosscutting.md`、`07-quality.md`、`08-evolution.md`
- Modify: `tests/docs-consistency.test.ts:216-217`、`lib/config.ts:66`、`docs/architect.md`（全文重写）、`docs/README.md`（§1/§2/§3/§5.1/§5.3/§5.4）、`AGENTS.md:5,59,82`、`docs/prd.md`、`docs/api.md`、`docs/data-model.md`、`docs/ops-target.md`、`docs/implementation-status.md`、`docs/guides/runbooks.md`、`docs/decisions/0001..0013`（仅链接行）

**Interfaces:**
- Consumes: Task 1–15 产出的全部 15 份文件

- [ ] **Step 1: 找出全部需要改的引用**

Run: `grep -rn "architecture/0" --include=*.md --include=*.ts . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.worktrees --exclude-dir=reviews --exclude-dir=superpowers`
把结果按「文件:行 → 旧目标 → 新目标」列成清单再动手。对照表用 Task 15 的「旧文件对照」小节。

- [ ] **Step 2: 改测试与代码注释（必须与删旧文件同一个 commit）**

`tests/docs-consistency.test.ts`：把第 216–217 行的路径改为
```ts
const quality = read('docs/architecture/08-非功能性设计.md');
const components = read('docs/architecture/03-逻辑视图-模块设计.md');
```
**断言内容一个字都不改**（`not.toMatch(/F1\/F2\/F4/)`、`not.toMatch(/\|\s*F2\s*\|/)`、两处 `not.toContain('noRestrictedImports 待接入')`）。测试标题保持原样。
`lib/config.ts:66`：注释里的 `docs/architecture/07-quality.md` 改为 `docs/architecture/08-非功能性设计.md`。

- [ ] **Step 3: 重写 `docs/architect.md`**

保留「跳转页」性质，三节：`## 从这里开始读`（链接 `./architecture/00-文档说明.md` 与 `./architecture/01-架构总览.md`）、`## 章节对照`（旧 `architect.md` §1–§15 → 新 15 份的两列表）、`## 与目标设计的关系`（一句话：本目录描述当前实现，目标设计见 `./prd.md` 与 `./decisions/README.md`）。

- [ ] **Step 4: 重写 `docs/README.md` 的定位措辞**

- §1 两套内容表：把 `architecture/` 从「目标设计」行移到「当前实现」行；「目标设计」行保留 `prd.md`、`decisions/`、`data-model.md`、`api.md`、`ops-target.md`。
- §2 目录树：`architecture/` 注释从「怎么做」改为「现在怎么搭的」；`architect.md` 注释保持「跳转页」。
- §3 阅读路径：四条路径的文件名换成新 15 份；「AI Agent」行的「仅在任务要求『按目标架构实现』时才读 `architecture/`」改为「读 `architecture/00-文档说明.md` 与 `01-架构总览.md` 了解现状」。
- §5.1 单一事实来源表：「架构目标、约束、模块边界、运行时」行改为「架构结构（模块、数据、接口、部署、运行时）」→ `architecture/` 对应文件。
- §5.3 文件头模板：「本文描述目标架构」改为「本文描述当前实现」。
- §5.4 同步表：`architecture/08-evolution.md` §14 → `architecture/13-风险与演进规划.md`。
- 顺手修 §2 里「21 条 + 8 篇正式 ADR」的漂移：改成与 `ls docs/decisions/*.md | wc -l` 一致的写法，或直接不写数量。

- [ ] **Step 5: 改 `AGENTS.md` 三处**

- 第 5 行：`架构目标 → [architecture/](docs/architecture/00-overview.md)` 改为 `架构现状与结构 → [architecture/](docs/architecture/00-文档说明.md)`；另在同句末尾已有的 `决策理由 → [decisions/]` 前补 `目标设计 → [prd.md](docs/prd.md)；`。
- 第 59 行：`| 讨论家谱目标架构 | [architecture/](docs/architecture/00-overview.md)、[decisions/](docs/decisions/README.md) |` 改为 `| 了解架构现状与结构 | [architecture/](docs/architecture/00-文档说明.md) |`，并新增一行 `| 讨论家谱目标架构 | [prd.md](docs/prd.md)、[decisions/](docs/decisions/README.md) |`。
- 第 82 行：`[03-components](docs/architecture/03-components.md)` 改为 `[03-逻辑视图-模块设计](docs/architecture/03-逻辑视图-模块设计.md)`。
- **不动 AGENTS.md 的仓库约定正文**（安全、数据规则、禁止清单）。

- [ ] **Step 6: 改其余引用**

`docs/prd.md`、`docs/api.md`、`docs/data-model.md`、`docs/ops-target.md`、`docs/implementation-status.md`、`docs/guides/runbooks.md`、`docs/decisions/0001..0013`：按 Step 1 的清单逐条替换旧文件名 → 新文件名。只改链接目标，不改正文论证。`docs/reviews/` 与 `docs/superpowers/` 下的历史记录**不改**。

- [ ] **Step 7: 删除旧 9 份**

```bash
git rm docs/architecture/00-overview.md docs/architecture/01-drivers.md docs/architecture/02-context.md \
       docs/architecture/03-components.md docs/architecture/04-runtime.md docs/architecture/05-data.md \
       docs/architecture/06-crosscutting.md docs/architecture/07-quality.md docs/architecture/08-evolution.md
```

- [ ] **Step 8: 跑文档校验**

Run: `pnpm docs:check --strict`
Expected: `0 issue(s)`。若有 issue，逐条修；**不要**为了让文档过关而放宽 `check-docs.mjs`（若确实某条禁令与 as-is 事实正面冲突，删该条并在提交信息里写理由）。

- [ ] **Step 9: 跑代码门禁**

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: 三条全绿，`tests/docs-consistency.test.ts` 通过。

- [ ] **Step 10: 反目标全量抽查**

Run:
```bash
grep -rnE "text\('|uuid\(|varchar\(|CREATE POLICY|CREATE INDEX" docs/architecture/
grep -rn "未实现\|部分实现\|已完成\|🟡" docs/architecture/0[1-9]-*.md docs/architecture/1[0-4]-*.md
grep -rn "pnpm db:" docs/architecture/
grep -rn "src/modules" docs/architecture/
grep -rn 'architecture/[0-9][0-9]-[a-z]' docs/ AGENTS.md
```
Expected: 五条命令**全部无输出**（第二条允许 00 章与 12 章之外的 0 命中；最后一条确保没有残留的旧小写文件名）。

- [ ] **Step 11: 术语一致性抽查**

Run:
```bash
grep -rn "工作区" docs/architecture/ | grep -v "谱系工作区"
grep -rn "家谱空间" docs/architecture/
```
Expected: 无输出（统一用「云谱空间」，例外是「谱系工作区」这个既有概念）。

- [ ] **Step 12: 提交**

```bash
git add -A docs/architecture/ docs/README.md docs/architect.md docs/prd.md docs/api.md docs/data-model.md \
           docs/ops-target.md docs/implementation-status.md docs/guides/runbooks.md docs/decisions/ \
           AGENTS.md tests/docs-consistency.test.ts lib/config.ts
git commit -m "docs(architecture): replace 9 to-be docs with 15 as-is docs and realign entry docs"
```

---

## Self-Review 记录

**1. Spec 覆盖**：spec §5 的 15 行逐行对应 Task 1–15；§6 阶段 0（事实核查）折进每个任务的 Step 1；§6 阶段 3 对应 Task 16；§7 验收标准 7 条分别落在 Task 16 Step 8/9/10/11 与各任务的「事实断言」；§10.1 五条裁决分别落在 Global Constraints 第 4/5 条（B2、B3）、Task 12 Step 2 第 3 节（B4）、Global Constraints 第 13 条（B5）、Task 16 Step 8（B6）；§10.2 B1 落在 Task 16 Step 4/5。无缺口。

**2. 步骤扫描**：每个 Step 都是单一动作 + 可校验结果。写作步骤给了固定小节顺序与每节内容要求，没有「写得好一点」这类空指令。

**3. 类型一致性**：跨任务引用的标识符统一为——文件名 15 个（Global Constraints 第 1 条）、锚点仅 `#术语表`（Task 1 产出）、函数名 `requireOrgContext`/`getOrgContext`/`requireProjectContext`/`withOrg`/`getOrgRoleInTx`/`validatedAction`/`validatedActionWithUser`/`hasPermission`/`generatePublicId`/`isPublicId`、类型 `ActionState`/`SessionUser`、脚本 `check-docs.mjs`/`check-file-size.mjs`/`check-env-access.mjs`/`verify-deployment.mjs`。Task 4 产出的 `## 模块职责与所有权`、Task 5 的 `## 表分组`、Task 6 的 `## 接口形态总览`、Task 9 的 `## Fitness functions`、Task 10 的 `## 授权矩阵`、Task 12 的 `## ADR 索引` 在 Interfaces 的 Produces 里声明，下游任务只做无锚点链接，不依赖锚点。

**4. Review Focus**：五条各自有归属校验——事实写错（各任务「事实断言」步骤 + Task 16 Step 10）、第二份真相（Task 5 Step 4、Task 16 Step 10）、状态泄漏（各任务写作约束 + Task 16 Step 10 第二条）、链接与锚点（Task 16 Step 8 + Global Constraints 第 6 条）、术语漂移（Task 1 术语表 + Task 16 Step 11）。

**5. 比例**：计划约 700 行，spec 约 300 行；15 份文档合计约 70 页。计划里没有文档正文，只有小节顺序、必含要素与校验命令。
