<!--
Sync Impact Report
==================
Version change: (unversioned, 2026-10-30) → 1.1.0
Bump rationale: MINOR — 首次引入可执行的原则条目、附加约束、开发流程与治理版本线；
               既有「原则正文唯一来源是 AGENTS.md、本文件不复制」的定位保持不变。

Modified principles: 无（此前无编号原则，只有一段指向 AGENTS.md 的说明）
Added sections:
  - Core Principles I–V（组织隔离与服务端授权 / 认证与连接分离 / 写路径单事务 /
    先失败测试后实现（NON-NEGOTIABLE）/ 单一事实来源与最小改动）
  - 附加约束（数据与安全）
  - 开发流程与质量门禁
  - Governance（含权威文本索引、修订程序、版本策略、合规复核）
Removed sections: 无（原「唯一原则来源」表移入 Governance 的权威文本索引）

Follow-up TODOs:
  - 若后续希望本文件承载完整原则正文，需先修订 AGENTS.md §0 的「只指路、不复制」约定，
    否则会形成第二份事实来源。
-->

# 云谱项目原则（Spec Kit 视图）

> 原则正文的唯一来源是仓库根目录的 `AGENTS.md`。本文件只声明 spec-kit 阶段**如何执行**它：
> 每条原则给出一句可判定的约束、权威文本位置、以及能证明它被执行的证据。
> 本文件不复述规则细节；细节一律去权威文本读。

## Core Principles

### I. 组织隔离与服务端授权

任何组织级读写 MUST 同时带 `orgId` 并通过 `withOrg` 执行；权限判定 MUST 走
`hasPermission(role, '<permission>')`，不得比较角色名；公开 ID（`slug`/`ref`）只是 URL，
MUST NOT 被当作授权凭证；非成员与不存在的资源一律 404。

- 权威文本：`AGENTS.md` §5.4、§7 规则 1/2/11；`docs/architecture/09-安全架构.md`
- 证据：集成测试中的越权用例；评审第①项「猜 ID 能否访问别的组织」

### II. 认证与连接分离

认证 MUST 只经 Better Auth（`auth_service` 连接），业务 MUST 只经 `withOrg`（`app_rw`）；
MUST NOT 直接读写 `auth.*`、MUST NOT 新增 `/api/auth/*` 或浏览器 auth client；
MUST NOT 把 `BETTER_AUTH_SECRET`、密码哈希或整行用户数据带到客户端。

- 权威文本：`AGENTS.md` §5.3、§7 规则 15；`docs/decisions/0007-self-hosted-better-auth.md`
- 证据：安全路径测试；评审第②③项「信息泄露 / 认证语义」

### III. 写路径单事务

多步写 MUST 收敛到 `lib/db/services.ts` 或 `lib/<domain>/*-services.ts` 的单个事务内，
并在事务内锁定读复核权限；失败 MUST NOT 留下半成品数据；唯一约束/`CHECK` 冲突
MUST 转成中文 `ActionState`，不得吞掉或重试成重复数据。

- 权威文本：`AGENTS.md` §5.2、§7 规则 12/14
- 证据：`tests/integration/**` 的失败路径用例（断言无残留行）

### IV. 先失败测试，后实现（NON-NEGOTIABLE）

行为变更 MUST 先写会失败的测试（RED），确认它确实失败，再实现到通过（GREEN）；
涉及 SQL、约束、成员隔离、多步事务的改动 MUST 补真实 PostgreSQL 集成测试。
声称「完成」前 MUST 有命令输出为证：`pnpm check`、`pnpm typecheck`、`pnpm test` 全绿，
并按改动范围跑 `pnpm arch:check`、`pnpm docs:check --strict`、`pnpm test:integration`、`pnpm test:e2e`。

- 权威文本：`AGENTS.md` §0（TDD 与 verification 技能）、§3、§9；`docs/guides/testing.md`
- 证据：PR 自查清单的勾选项与对应命令输出

### V. 单一事实来源与最小改动

状态 MUST 只写一处；文档 MUST 只指路、不复制同一事实的第二份；新增依赖、抽象层、
目录结构 MUST 有当前需求作为理由（不为「以后可能用到」提前拆）。
架构约束 MUST 保持绿：F6 单文件 ≤400 行且存量豁免只许缩不许涨，F7 只在 `lib/config.ts`
读 `process.env`。

- 权威文本：`AGENTS.md` §0、§3、§4、§8；`docs/README.md` §5.1
- 证据：`pnpm arch:check`（`scripts/check-file-size.mjs`、`scripts/check-env-access.mjs`）

## 附加约束（数据与安全）

- **软删语义**：业务表默认 `isNull(deletedAt)` 过滤；当前**没有**回收站 UI，MUST NOT 把软删
  当作可恢复承诺；`organization_member` 与 `invite` 是硬删除。
- **迁移纪律**：表结构变更 MUST 只由 `pnpm db:generate` 生成后人工 review；迁移与业务代码
  分开提交；迁移 MUST 能在空库一次执行，且 MUST NOT 夹带数据修复逻辑。
- **主键与约束**：主键 UUIDv7；20 位公开 ID 只用于 URL；组织范围的新表 MUST 带
  `organization_id`、在所有查询中过滤并启用 RLS；RLS 是兜底，不替代应用层过滤。
- **界面**：简体中文文案，不引入 i18n 框架；默认 Server Component；不写裸色值；
  不把数据库错误或堆栈展示给用户。
- **禁止**：新增后台任务/队列/定时器（见 `docs/decisions/0005-zero-background-jobs.md`）；
  未经实现计划就做未完成的家谱业务功能；把目标文档里的 `src/modules` 当作现状。

## 开发流程与质量门禁

- **规格层纪律**：`specs/NNN-<feature>/spec.md` 只写「要什么、为什么、怎么验收」，不写实现方案；
  `plan.md` 与 `tasks.md` 是实现层输入，执行计划以 `docs/superpowers/plans/` 下的计划为准，
  两边不并行维护两份任务清单；`specs/` 入库不 gitignore；`.specify/` 里除本文件外由
  `specify integration upgrade` 管理，不手改；规格与计划一律简体中文。
- **提交**：`<type>(<scope>): <描述>`，一个 commit 只做一件事，迁移与业务代码分开提交。
- **评审顺序**：① 越权 ② 信息泄露 ③ 认证语义 ④ 错误处理（401/403/404）⑤ 迁移（可重复、
  可回滚、影响现有数据）⑥ 命名与风格。
- **完成定义**：本地门禁全绿 + 集成/E2E（按范围）+ 文档同步（行为或命令变化时更新
  `docs/setup.md`、`docs/implementation-status.md`，状态只写一处）。

## Governance

- **权威文本索引**：

  | 关注点 | 去哪读 |
  |---|---|
  | 项目边界、数据规则、禁止清单、提交与评审 | `AGENTS.md` |
  | 架构现状与模块边界 | `docs/architecture/01-架构总览.md` |
  | 表结构与约束 | `docs/data-model.md` |
  | 命令与测试分层 | `docs/setup.md`、`docs/guides/testing.md` |
  | 实现状态（唯一） | `docs/implementation-status.md` |
  | 决策理由 | `docs/decisions/` |

- **优先级**：本文件与 `AGENTS.md` 冲突时以 `AGENTS.md` 与代码为准；`AGENTS.md` 的仓库约定
  （安全、数据规则、禁止清单）优先于任何技能或目标文档的建议。
- **修订程序**：原则增删或语义变更 MUST 走 PR 并在 PR 描述里写明理由与影响面；
  影响架构方向的变更 MUST 同时落一份 `docs/decisions/` 下的 ADR（编号一旦发布不改不重用）。
- **版本策略**：语义化版本。MAJOR = 删除或重定义原则；MINOR = 新增原则/章节或实质扩展；
  PATCH = 澄清、措辞与笔误。
- **合规复核**：每个 PR MUST 按 `AGENTS.md` §9 的自查清单逐项勾选并提供命令输出；
  CI 的 `docs:check --strict`、`arch:check`、`test:coverage`、迁移漂移检查、`build`、
  `test:e2e`、`verify:deploy` 必须通过。

**Version**: 1.1.0 | **Ratified**: 2026-10-30 | **Last Amended**: 2026-11-02
