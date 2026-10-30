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
