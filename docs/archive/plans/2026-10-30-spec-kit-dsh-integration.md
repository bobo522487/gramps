# Spec Kit × DeepSeek Harness 集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 spec-kit 的十个核心命令以 DSH 原生 `/speckit-*` 技能形态可用，并把「spec-kit 定规格、superpowers 管执行」的分工写进 `AGENTS.md` 与一份 guide。

**Architecture:** 用 spec-kit 的 `zed` 集成当载体（`SkillsIntegration`，写 `.agents/skills/speckit-<name>/SKILL.md`、调用前缀 `/speckit-<name>`、`requires_cli: false`），DSH 的技能发现（`<repo>/.agents/skills`，rank 200）无需任何胶水代码即可加载；`.specify/` 由 spec-kit 自己管理，仓库侧只补 constitution 薄封装、AGENTS.md 路由规则和一份说明文档。

**Tech Stack:** spec-kit `1.0.2.dev0`（`specify` CLI，uv tool）、DSH 技能发现（`.agents/skills`）、pnpm 校验脚本（`docs:check`、`arch:check`、`check`）。

**Spec:** `docs/superpowers/specs/2026-10-30-spec-kit-dsh-integration-design.md`

## Global Constraints

- 只装核心命令：不装扩展（git / agent-context / bug / assess）、不装 preset。
- 不写 `dsh` 集成包、不改 spec-kit 源码或 `site-packages`、不手改 `.specify/` 里除 `memory/constitution.md` 以外的托管文件。
- 不改业务代码、表结构、迁移、`pnpm` 脚本、CI。
- `.agents/skills` 是技能真身目录；`.claude/skills` 是它的反向软链，本计划不动 `.claude/`。
- 当前分支 `feat/p1-fact-layer` 已有未提交改动（`docs/data-model.md`、`docs/decisions/0016-*`、`docs/implementation-status.md`、`lib/db/schema/person.ts` 与未跟踪的 superpowers 技能软链）：**任何 `git add` 都不得带上它们**。
- 文档一律简体中文；细节只在 `docs/guides/spec-driven-workflow.md` 写一次，`AGENTS.md` 只指路。
- 每个提交前 `pnpm docs:check` 必须 0 issue；最终 `pnpm check`、`pnpm arch:check`、`pnpm docs:check --strict` 全绿。

## Review Focus

1. `specify init --force` 在非空仓库里的覆盖行为 —— 期望只新增 `.specify/` 与 `speckit-*`，既有的 16 个 superpowers 技能、`.claude/skills`、`AGENTS.md` 一字不动。
2. 占位符替换的**方向** —— 期望正文出现 `/speckit-<name>`，不出现 `$speckit-<name>`（那是 codex 的语法）也不残留 `__SPECKIT_COMMAND_*__`。
3. `SKILL.md` frontmatter 是否满足 DSH 解析 —— `name` 必须是 kebab-case 且等于目录名、`description` 必须存在，否则技能被静默丢弃、模型看不到任何诊断。
4. `AGENTS.md` 与 guide 是否说两遍 —— `AGENTS.md` 每次会话都加载，复制流程正文会与 guide 漂移，且 `docs:check` 的矛盾措辞检查会命中。
5. `specs/` 是否被误 gitignore —— 规格文档是需求源头，必须入库；`.specify/.gitignore` 只应忽略机器本地状态。

---

### Task 1: 初始化 spec-kit（zed 载体）并验证技能可被 DSH 解析

**Files:**
- Create: `.specify/**`（`memory/`、`templates/`、`scripts/`、`workflows/`、`integrations/`、`init-options.json`、`.gitignore`）
- Create: `.agents/skills/speckit-{analyze,checklist,clarify,constitution,converge,implement,plan,specify,tasks,taskstoissues}/SKILL.md`

**Interfaces:**
- Produces: 十个技能名 `speckit-analyze`、`speckit-checklist`、`speckit-clarify`、`speckit-constitution`、`speckit-converge`、`speckit-implement`、`speckit-plan`、`speckit-specify`、`speckit-tasks`、`speckit-taskstoissues`，每个的调用串形如 `/speckit-specify <描述>`（Task 3、Task 4 引用这些名字）。

- [ ] **Step 1: 记录基线**

```bash
cd /home/bobo/project/gramps
git status --short .agents .claude; ls .agents/skills | wc -l
```

Expected: 只列出未跟踪的 superpowers 软链；计数为 `16`（此刻还没有 `speckit-*`）。

- [ ] **Step 2: 跑初始化**

```bash
specify init --here --force --non-interactive --script sh --integration zed
```

Expected: 退出码 0，输出包含 `Spec Kit` 与 `zed`，不出现交互提示。

- [ ] **Step 3: 验证产物存在**

```bash
ls .specify
ls -d .agents/skills/speckit-* | wc -l
specify integration status
```

Expected: `.specify` 列出 `memory scripts templates workflows integrations init-options.json .gitignore`（顺序不限）；计数为 `10`；`status` 显示 zed 已安装/激活。

- [ ] **Step 4: 验证 frontmatter 与调用串（失败即回滚重装）**

```bash
node -e '
const fs=require("fs"),path=require("path");
const dirs=fs.readdirSync(".agents/skills").filter(d=>d.startsWith("speckit-"));
const bad=[];
for(const d of dirs){
  const p=path.join(".agents/skills",d,"SKILL.md");
  if(!fs.existsSync(p)){bad.push(d+": missing SKILL.md");continue;}
  const t=fs.readFileSync(p,"utf8");
  const m=t.match(/^---\n([\s\S]*?)\n---/);
  if(!m){bad.push(d+": no frontmatter");continue;}
  const fm=m[1];
  const name=(fm.match(/^name:\s*(.+)$/m)||[])[1]||"";
  const desc=(fm.match(/^description:\s*(.+)$/m)||[])[1]||"";
  const n=name.trim().replace(/^["\x27]|["\x27]$/g,"");
  if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n))bad.push(d+": bad name "+n);
  if(n!==d)bad.push(d+": name mismatch "+n);
  if(desc.trim().length<10)bad.push(d+": bad description");
  if(t.includes("__SPECKIT_COMMAND"))bad.push(d+": unreplaced placeholder");
  if(!t.includes("/speckit-"))bad.push(d+": no /speckit- invocation");
  if(t.includes("$speckit-"))bad.push(d+": codex-style $ invocation");
}
console.log(dirs.length+" skills checked");
console.log(bad.length?bad.join("\n"):"ok");
process.exit(bad.length?1:0);
'
```

Expected: 打印 `10 skills checked` 与 `ok`，退出码 0。

- [ ] **Step 5: 验证没有动到既有文件**

```bash
git status --short .agents .claude AGENTS.md
```

Expected: 只有十个 `.agents/skills/speckit-*/` 目录新增；`AGENTS.md`、`.claude/` 无变化。

- [ ] **Step 6: 提交（只带 spec-kit 产物）**

```bash
git add .specify .agents/skills/speckit-*
git status --short --cached
git commit -m "chore(spec): init spec-kit with dsh-compatible skills"
```

Expected: 暂存区只含 `.specify/` 与十个 `speckit-*` 目录；提交成功。若 `git add` 带进了未跟踪的 superpowers 软链或既有改动，先 `git reset` 再用显式路径重加。

---

### Task 2: 把 constitution 写成薄封装

**Files:**
- Modify: `.specify/memory/constitution.md`（整个文件替换）

**Interfaces:**
- Consumes: Task 1 生成的 `.specify/memory/constitution.md` 模板骨架。
- Produces: 一份 20 行以内的原则文件，`/speckit-constitution` 仍可重写它；`AGENTS.md` 是唯一原则正文来源。

- [ ] **Step 1: 读现有骨架**

```bash
sed -n 1,40p .specify/memory/constitution.md
```

Expected: 模板正文带 `[PROJECT_NAME]`、`[PRINCIPLE_1_NAME]` 之类的占位符。

- [ ] **Step 2: 替换为薄封装**

写入以下内容（标题与措辞照抄，别扩写）：

```markdown
# 云谱项目原则（Spec Kit 视图）

> 原则正文的唯一来源是仓库根目录的 `AGENTS.md`。本文件只声明 spec-kit 阶段如何遵守它，不复制原则内容。

## 唯一原则来源

| 关注点 | 去哪读 |
|---|---|
| 项目边界、数据规则、禁止清单、提交与评审 | `AGENTS.md` |
| 架构目标与模块边界 | `docs/architecture/00-overview.md` |
| 表结构与约束 | `docs/data-model.md` |
| 命令与测试分层 | `docs/setup.md`、`docs/guides/testing.md` |

## spec-kit 阶段的补充约定

1. `specs/NNN-<feature>/spec.md` 只写「要什么、为什么、怎么验收」，不写实现方案。
2. `plan.md` 与 `tasks.md` 是实现层输入；执行计划以 `docs/superpowers/plans/` 下的计划为准，两边不并行维护两份任务清单。
3. `specs/` 入库，不做 gitignore；`.specify/` 里除本文件外由 `specify integration upgrade` 管理，不手改。
4. 规格与计划文档一律简体中文。
```

- [ ] **Step 3: 验证**

```bash
grep -c "AGENTS.md" .specify/memory/constitution.md
grep -nE "\[(PROJECT_NAME|PRINCIPLE_[0-9]+_NAME)\]" .specify/memory/constitution.md || echo "no placeholders"
```

Expected: 计数 `>=1`；打印 `no placeholders`。

- [ ] **Step 4: 提交**

```bash
git add .specify/memory/constitution.md
git commit -m "chore(spec): make the constitution defer to AGENTS.md"
```

---

### Task 3: AGENTS.md §0 增加路由规则

**Files:**
- Modify: `AGENTS.md`（`## 0. 技能系统（Superpowers）` 小节末尾）

**Interfaces:**
- Consumes: Task 1 的十个 `/speckit-*` 命令名；Task 4 的 `docs/guides/spec-driven-workflow.md` 路径。
- Produces: 每次会话都加载的路由规则（不超过 8 行），指向 guide 取细节。

- [ ] **Step 1: 在 §0 的三条要点之后、`调用格式 skill({ name: "<技能名>" })` 那行之前插入**

```markdown
**两层分工（spec-kit 定规格，superpowers 管执行）**：spec-kit 的技能也在 `.agents/skills/`，用 `/speckit-*` 调用。

- 新功能 / 行为变更 → 先 `/speckit-specify` 出 `specs/NNN-*/spec.md`，需要消歧义就 `/speckit-clarify`，再进入上面的 superpowers 流程（`brainstorming` → `writing-plans` → `test-driven-development`）。
- bugfix / 重构 / 纯文档 → 直接走执行类技能，不产 spec。
- 执行计划只写一份：`docs/superpowers/plans/`；`tasks.md` 的任务合并进该计划，不并行两套清单。
- 阶段、产物路径与裁决细节见 [guides/spec-driven-workflow.md](docs/guides/spec-driven-workflow.md)，本文件不复述。
```

- [ ] **Step 2: 验证**

```bash
grep -n "spec-driven-workflow" AGENTS.md
sed -n '/## 0\. 技能系统/,/^---$/p' AGENTS.md | wc -l
```

Expected: 恰好 1 处引用；§0 段落行数不超过 30（说明没有把流程正文抄进来）。

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md
git commit -m "docs(agents): route requirement work through spec-kit"
```

---

### Task 4: 新增 guide 并在 docs 索引里挂链接

**Files:**
- Create: `docs/guides/spec-driven-workflow.md`
- Modify: `docs/README.md`（目录树 `guides/` 分支 + §5.1 单一事实来源表）

**Interfaces:**
- Consumes: Task 1 的命令名、Task 3 引用的锚点。
- Produces: 唯一的流程细节文档；`docs/README.md` 通过相对链接指向它。

- [ ] **Step 1: 写 guide**

文件内容按这五节组织，每节不超过 15 行：

1. `## 1. 两层分工` —— spec-kit 管源头需求对不对，superpowers 管执行稳不稳。
2. `## 2. 七个阶段与产物` —— 表格：原则 / 需求 / 规格自检 / 技术方案 / 执行计划 / 实现 / 收尾，逐行给出负责方、命令、产物路径（`specs/NNN-<feature>/spec.md`、`specs/NNN-<feature>/plan.md`、`docs/superpowers/plans/YYYY-MM-DD-<topic>.md`）。
3. `## 3. 裁决规则` —— 新功能/行为变更走 spec；bugfix/重构/纯文档不走。
4. `## 4. 命令速查` —— `/speckit-constitution`、`/speckit-specify`、`/speckit-clarify`、`/speckit-checklist`、`/speckit-analyze`、`/speckit-plan`、`/speckit-tasks`、`/speckit-implement`、`/speckit-converge`、`/speckit-taskstoissues` 各一行用途。
5. `## 5. 常见误区` —— 两套计划并行、手改 `.specify/`、把实现细节写进 `spec.md`、`specs/` 被 gitignore、装扩展与仓库提交规范打架。

文件开头按 `docs/README.md` §5.3 的文档契约写引用块（只写适用的三行，**不要**写「目标 vs 现状」banner —— 那是 `docs/architecture/` 的要求）：

```markdown
> **回答什么问题**：一个需求从规格到实现走哪几个阶段、谁负责、产物落在哪
> **读者**：接手新功能的人与 AI Agent　**长度上限**：3 页
> **文档状态：当前做法** · 最后更新：2026-10-30
```

- [ ] **Step 2: 在 docs/README.md 两处挂链接**

目录树 `guides/` 分支当前以 `│   └── testing.md               ★ 测试分层与写法` 收尾：把该行的 `└──` 改成 `├──`，并在其后补一行新的收尾项：

```
│   ├── testing.md               ★ 测试分层与写法
│   └── spec-driven-workflow.md  ★ spec-kit × superpowers 分工
```

§5.1「单一事实来源」表格（列：`| 事实 | 只写在这 |`）在 `| 当前命令 | \`setup.md\` |` 之后加一行：

```
| 需求规格与两层工作流分工 | `guides/spec-driven-workflow.md` |
```

- [ ] **Step 3: 验证文档校验**

```bash
pnpm docs:check --strict
```

Expected: `0 issue(s)`。

- [ ] **Step 4: 提交**

```bash
git add docs/guides/spec-driven-workflow.md docs/README.md
git commit -m "docs(guides): document spec-kit × superpowers division"
```

---

### Task 5: 端到端验收（DSH 真的加载了技能）

**Files:** 无（只读验证）

**Interfaces:**
- Consumes: Task 1–4 的全部产物。

- [ ] **Step 1: 用子代理证明技能可见**

派一个子代理，要求它**只**回答自己当前可见的技能清单里以 `speckit-` 开头的条目及其描述首句。

Expected: 列出 10 个 `speckit-*` 技能，描述与其命令语义相符（例如 `speckit-specify` 是「Create or update the feature specification…」）。

- [ ] **Step 2: 跑仓库校验**

```bash
pnpm check && pnpm arch:check && pnpm docs:check --strict
```

Expected: 全部通过（本计划不碰 `app/`、`components/`、`lib/`、`hooks/`，`pnpm test` 不受影响，无需重跑全量测试；若 `pnpm check` 报既有改动的问题，只报告不修）。

- [ ] **Step 3: 向人确认最后一步**

请对方在输入框敲 `/speckit` 看补全列表（DSH 监听技能目录，无需重启会话），并确认 `git log --oneline -4` 里是四个独立提交。

Expected: 补全里出现十个 `/speckit-*`。
