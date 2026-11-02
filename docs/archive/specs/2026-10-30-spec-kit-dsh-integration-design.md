# Spec Kit × DeepSeek Harness 集成设计

- 日期：2026-10-30
- 分支：`feat/p1-fact-layer`
- 状态：待批准（批准后才进入 writing-plans）

## 意图

spec-kit 管「源头需求对不对」，superpowers 管「执行过程稳不稳」。本设计把 spec-kit 的十个核心命令接成 DSH 会话里的原生 `/speckit-*` 命令，并规定两层工作流的接缝与裁决规则，让两者各管一段、不重复产出。

## 目标

1. `.specify/` 初始化完成，十个核心命令以 DSH 技能形态可用（`/speckit-specify`、`/speckit-plan`、`/speckit-tasks`、`/speckit-implement` 等）。
2. `AGENTS.md` §0 增加路由规则：需求层走 spec-kit，执行层走 superpowers，bugfix/重构不强制产 spec。
3. 新增 `docs/guides/spec-driven-workflow.md`：阶段、产物路径、接缝、裁决规则。
4. `.specify/memory/constitution.md` 不另立一套，写成薄封装指向 `AGENTS.md`。

## 非目标

- 不写 `dsh` 集成包，不改 spec-kit 源码或 `site-packages`。
- 不装扩展（git / agent-context / bug / assess），不装 preset。
- 不改现有 superpowers 技能，不改业务代码、表结构、迁移。
- 不把 spec-kit 接进 `pnpm` 脚本或 CI。

## 反目标

- 出现两套并行计划文档：`specs/NNN-*/plan.md` 与 `docs/superpowers/plans/*.md` 各写一份、内容漂移。
- `AGENTS.md` 变成第二份重复的流程说明（细节应只在 guide 里写一次）。
- 把 `.specify/` 当成可随手手改的配置（它由 `specify integration upgrade` 管理）。

## 约束（已核实）

- spec-kit `1.0.2.dev0`，`specify` 在 `~/.local/bin`；集成清单里没有 `dsh` 键。
- DSH 只从 `<repo>/.agents/skills`（rank 200）与 `.dsh/skills` 发现技能；斜杠命令不能由文件定义，但**每个 user-invocable 技能就是输入框里的 `/名称`**。
- `.agents/skills` 是技能真身目录，`.claude/skills` 是它的反向软链（`neon -> ../../.agents/skills/neon`）。
- spec-kit 的 skills 形态产物正好是 `speckit-<name>/SKILL.md`（agentskills 布局），正文里的 `__SPECKIT_COMMAND_<NAME>__` 占位符会被替换成该集成的调用串。
- 仓库校验：`pnpm check` / `typecheck` / `test` / `arch:check` / `docs:check --strict`。只有 `docs/architecture/**` 强制文档头，`docs/superpowers/**` 不参与。
- 当前分支有未提交改动（`docs/data-model.md`、`docs/decisions/0016-*`、`docs/implementation-status.md`、`lib/db/schema/person.ts` 及未跟踪的 superpowers 技能），init 产物必须单独提交。

## 方案（已选 A）

**用 `zed` 集成当载体。**

```bash
specify init --here --force --non-interactive --script sh --integration zed
```

`zed` 集成就是 `SkillsIntegration`：`folder: .agents/`、`commands_subdir: skills`、`requires_cli: false`、调用前缀 `/speckit-<name>`、不写任何额外配置文件（无 events config）。它写出的路径与调用语法和 DSH 的技能发现、斜杠语法逐字对上，不需要胶水代码，`specify integration upgrade` 还能正常升级。

产物：

- `.specify/`：`memory/constitution.md`、`templates/`（spec / plan / tasks / checklist / constitution）、`scripts/bash/`（含 `check-prerequisites.sh`、`create-new-feature.sh` 等）、`workflows/speckit/`、`integrations/`（manifest）、`init-options.json`、托管 `.gitignore`。
- `.agents/skills/speckit-{analyze,checklist,clarify,constitution,converge,implement,plan,specify,tasks,taskstoissues}/SKILL.md`（10 个）。

代价：spec-kit 的记账里这个项目是「zed 项目」，`specify integration status` 会这么显示。

被否方案：

- **C 自写 `dsh` 集成包**：名字正统，但 spec-kit 的自定义集成只能从 HTTPS catalog 装，本地开发要么起 `http://127.0.0.1` catalog、要么改 `site-packages`（升级即丢），为一个 key 长期维护不划算。
- **B `claude` 集成 + 软链**：会写 `.claude/skills/`，而本仓库方向相反（`.agents/skills` 为真身），装完再反向软链是跟现有约定打架。

## 工作流接缝

| 阶段 | 谁负责 | 产物 |
|---|---|---|
| 原则 | spec-kit `/speckit-constitution` | `.specify/memory/constitution.md`（指向 `AGENTS.md`） |
| 需求 | `/speckit-specify` → `/speckit-clarify` | `specs/NNN-*/spec.md` |
| 规格自检 | `/speckit-checklist`、`/speckit-analyze` | 检查结论，就地修正 spec |
| 技术方案 | superpowers `brainstorming` + spec-kit `/speckit-plan` | `specs/NNN-*/plan.md` |
| 执行计划 | superpowers `writing-plans` | `docs/superpowers/plans/YYYY-MM-DD-*.md`，任务清单与 `tasks.md` 合并成一份 |
| 实现 | superpowers `test-driven-development` + `/speckit-implement` | 代码 + 测试 |
| 收尾 | `verification-before-completion` | `pnpm check && pnpm typecheck && pnpm test` 全绿 |

裁决规则：新功能 / 行为变更 → 先 spec-kit 出 spec，再进 superpowers；bugfix / 重构 / 纯文档 → 直接走 `systematic-debugging`、`writing-plans` 等执行类技能，不产 spec。

## 验收

1. `specify integration status` 报告 zed 已安装；`.specify/` 与 10 个 `speckit-*` 技能目录存在。
2. 每个 `SKILL.md` 的 frontmatter 有合法 kebab-case `name` 与 `description`（DSH 解析要求），正文 `__SPECKIT_COMMAND_*__` 占位符已替换为 `/speckit-*`。
3. 端到端证据：起一个子代理，让它列出自己可见的 `speckit-*` 技能（证明 DSH 真的加载了），再由人在输入框敲 `/speckit` 看补全。
4. `pnpm docs:check --strict`、`pnpm arch:check` 全绿；`pnpm check` / `typecheck` / `test` 不受影响。
5. 两个提交：`chore(spec): init spec-kit with dsh-compatible skills`、`docs(guides): document spec-kit × superpowers division`。

## 留给我的判断

- constitution 写成薄封装（项目原则以 `AGENTS.md` 为准 + spec-kit 阶段的补充），不复制原则正文。
- 只装核心命令，不装扩展，避免 `/speckit-git-commit` 之类与仓库提交规范打架。
- 暂不给 `.claude/skills` 补同向软链；若以后要在 Claude Code 里共用同一套，再加 10 个软链即可。
