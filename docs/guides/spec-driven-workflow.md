# 规格驱动工作流（spec-kit × superpowers）

> **回答什么问题**：一个需求从规格到实现走哪几个阶段、谁负责、产物落在哪
> **读者**：接手新功能的人与 AI Agent　**长度上限**：3 页
> **性质**：how-to。描述当前仓库的真实做法（spec-kit 1.0.2.dev0 + `zed` 集成），不是目标设计。

---

## 1. 两层分工

spec-kit 管**源头需求对不对**，superpowers 管**执行稳不稳**。两者的技能都在 `.agents/skills/`，都用斜杠命令调用，区别在阶段和产物。

| 层 | 回答的问题 | 产物 | 谁写 |
|---|---|---|---|
| 需求层（spec-kit） | 要做的东西对不对：目标、范围、边界、验收标准 | `specs/NNN-<feature>/spec.md`、`plan.md` | `/speckit-*` |
| 执行层（superpowers） | 怎么改才不翻车：顺序、测试、验证、收尾 | `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` | `writing-plans` 等流程技能 |

- 接缝在 `plan.md` → 执行计划：`plan.md` 说技术方案与影响面，执行计划说这次按什么顺序动哪些文件。
- 范围要变，回 `spec.md` 改一条，别在执行计划里悄悄扩。
- 每次会话加载的路由规则在 [AGENTS.md §0](../../AGENTS.md#0-技能系统superpowers)，命令与环境见 [setup.md](../setup.md)，测试分层见 [testing.md](./testing.md)。

---

## 2. 七个阶段与产物

| # | 阶段 | 负责方 | 命令 | 产物 |
|---|---|---|---|---|
| 1 | 原则 | spec-kit | `/speckit-constitution` | `.specify/memory/constitution.md`（薄封装，正文在 `AGENTS.md`） |
| 2 | 需求 | spec-kit | `/speckit-specify` | `specs/NNN-<feature>/spec.md` |
| 3 | 规格自检 | spec-kit | `/speckit-clarify`、`/speckit-checklist`、`/speckit-analyze` | `specs/NNN-<feature>/checklists/requirements.md`；澄清结果写回 `spec.md` |
| 4 | 技术方案 | spec-kit | `/speckit-plan` | `specs/NNN-<feature>/plan.md` |
| 5 | 执行计划 | superpowers | `writing-plans` | `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` |
| 6 | 实现 | superpowers | `test-driven-development`（需要任务清单时先 `/speckit-tasks`） | 代码 + `specs/NNN-<feature>/tasks.md`（可选） |
| 7 | 收尾 | superpowers | `verification-before-completion` | 检查输出 + `docs/` 同步 + 一个 commit（[AGENTS.md §9](../../AGENTS.md#9-提交与评审)） |

- `tasks.md` 不是必需；要写就把任务并进执行计划，两份清单只能活一份。
- `NNN` 按 `feature_numbering: sequential` 递增，一个需求一个目录，编号不复用。

---

## 3. 裁决规则

| 情况 | 走哪条 |
|---|---|
| 新功能、行为变更、改数据模型或接口契约 | 需求层：`/speckit-specify` →（说不清时 `/speckit-clarify`）→ `/speckit-plan`，再进执行层 |
| 需求本身还在变 | 先 `brainstorming` 把意图问清，再 `/speckit-specify` |
| bugfix | 不走 spec：`systematic-debugging` → `test-driven-development` |
| 重构（行为不变） | 不走 spec：`writing-plans` + `test-driven-development` |
| 纯文档、配置、依赖升级 | 不走 spec：直接改，跑 `pnpm check` 与 `pnpm docs:check` |
| 实现中发现规格漏了 | 回 `spec.md` 补一条需求，再用 `/speckit-converge` 把差量追加成任务 |

- 判据是「**源头需求**是否变了」：变了才写 spec，没变就别另造一份。
- 目录名用 kebab-case，命名规则见 [AGENTS.md §4](../../AGENTS.md#4-目录与命名)。

---

## 4. 命令速查

| 命令 | 用途 |
|---|---|
| `/speckit-constitution` | 建立或更新 `.specify/memory/constitution.md`；本仓库里它只指向 `AGENTS.md` |
| `/speckit-specify` | 把一段需求描述写成 `specs/NNN-<feature>/spec.md` |
| `/speckit-clarify` | 对 `spec.md` 提最多 5 个澄清问题，答案直接写回规格 |
| `/speckit-checklist` | 按需求生成验收清单 `specs/NNN-<feature>/checklists/requirements.md` |
| `/speckit-analyze` | 跨 `spec.md`、`plan.md`、`tasks.md` 查不一致，只报告不改文件 |
| `/speckit-plan` | 生成 `specs/NNN-<feature>/plan.md`：技术方案、影响面、验证方式 |
| `/speckit-tasks` | 生成 `specs/NNN-<feature>/tasks.md`，按用户故事排出任务顺序 |
| `/speckit-implement` | 按 `tasks.md` 逐条执行；只在 `tasks.md` 就是唯一清单时用 |
| `/speckit-converge` | 对照 `spec`、`plan`、`tasks` 算差量，把没做的追加进 `tasks.md` |
| `/speckit-taskstoissues` | 把 `tasks.md` 转成 GitHub issues；本仓库没有 issue 流程，通常不用 |

---

## 5. 常见误区

- **两套计划并行**：`specs/NNN-*/tasks.md` 与 `docs/superpowers/plans/*.md` 各写一份，改一处忘另一处；只留一份任务清单。
- **手改 `.specify/`**：模板、脚本、workflows 由集成管理，升级即被覆盖；只改 `memory/constitution.md` 与 `specs/`。
- **把实现细节写进 `spec.md`**：那里只写要什么、为什么、怎么验收；表结构、文件路径、函数名属于 `plan.md`。
- **`specs/` 被 gitignore**：规格是需求源头，必须入库；`.specify/.gitignore` 只该忽略机器本地状态。
- **照抄模板的 `src/` 路径**：`plan-template.md` 与 `tasks-template.md` 假设 `src/` + `tests/`，本仓库是 `app/` `components/` `lib/` `hooks/` `tests/`；`plan.md`、`tasks.md` 必须改写成真实路径。
- **装扩展 / preset 与提交规范打架**：本仓库只装这十个命令；扩展会新增命令名与配置文件，与「一个 commit 只做一件事」冲突，要装就单独提交并回本文件补一行。
