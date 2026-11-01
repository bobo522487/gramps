# Specification Quality Checklist: 谱系录编与实时预览

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-01
**Updated**: 2026-11-01（`/speckit-clarify` 两轮后复核；第二轮三条交互指令已并入）
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **2026-11-01 澄清后重写**：`/speckit-clarify` 做了两轮问答。第一轮 6 问（3 条用户指令 + 3 次逐项确认）把范围从「附件全量 + 早期草案的导出/房支/撤销/结构编辑」收缩到**录入闭环 + 实时预览 + 删除 + 权限收紧**；第二轮 3 条交互指令（信息卡改抽屉、操作入口改选中态、去掉出生地）把 FR 从 28 条调整为 **30 条**（`FR-001..FR-030` 连续）。用户故事 **4 个**，验收标准 **8 条**。
- **移出本期的能力**（均已在 [spec.md §Assumptions](../spec.md#assumptions) 的收敛点表记账，且每条写明理由）：导出与导入（含单支 GEDCOM 7，转独立 M2 块）、房支与房支管理、30 秒撤销、挂接 / 拆支 / 承嗣关系类型、别名多值（仅保留已有的「字」）、头像、收藏、造字工具、整页预览、统计仪表盘、快捷键。
- **本期真正的增量只有四处**（第二轮澄清后）：① 信息卡改抽屉（未选中不显示，`FR-012`）；② 操作入口从节点卡片菜单搬到「选中态」的底部快捷条 + 右键菜单（`FR-028/029/030`）；③ 删除确认补「配偶关系一并归档」并修正人数口径（`FR-018`）；④ 删除谱系收紧为仅所有者/管理员（`FR-003`）。**零表结构变更**——出生地设计已在第二轮删除。其余 FR 标注「现状」表示仓库已交付（`FR-001/002/004/005/006/007/008/009/010/011/013/014/015/016/017/019/020/021/022/023/024/025/026/027`）。
- 与附件口径不同的 **10 处**已在收敛点表逐条记账：6 处来自澄清裁决，2 处来自仓库既有决策（三层容器、4 角色），2 处来自附件自身的裁剪结论（三档详略、范围外清单）。
- 附件原列的 10 条待确认问题收敛为 [spec.md §Assumptions](../spec.md#assumptions) 的「待确认（暂按默认值执行）」**6 行**；每条都写明了默认值与推翻它的代价，因此无需 `[NEEDS CLARIFICATION]` 标记，也不阻塞 `/speckit-plan`。
- **已过一轮独立评审**（2026-11-01，6 条 P1 全部修正）与**两轮澄清**（9 问）。当前唯一的对外依赖是「编辑者权限收紧的落地方式」，它属于 plan 阶段的实现选择，不影响规格本身的可验收性。
