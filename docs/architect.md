# 架构设计（已拆分）

> **本文件是跳转页。** 原 658 行的 `architect.md` 已按「读者 + 视图」拆成 9 份；章节编号保持与原文档一致，正文已按当前实现与 ADR 0007/0008 校正（2026-10-24），因此其他文档中「architect §3.2」这类引用仍可直接对应到「[02-context](./architecture/02-context.md) §3.2」。

**从这里开始读**：[架构总览](./architecture/00-overview.md)（一页纸 + 3 张图 + 十条要点）

---

## 章节对照

| 原章节 | 内容 | 新位置 |
|---|---|---|
| §1 | 架构目标 G1–G6、约束、非目标 | [01-drivers](./architecture/01-drivers.md) |
| §2 · §3 · §10 | 系统上下文、部署视图、部署拓扑 | [02-context](./architecture/02-context.md) |
| §4 · §7 | 模块划分、依赖方向、分层规则、事务边界、接口形态 | [03-components](./architecture/03-components.md) |
| §5 · §6 | 读/写请求路径、组织解析、注册、并发、前端渲染与画布 | [04-runtime](./architecture/04-runtime.md) |
| §8 | 存储模型、隔离、连接、一致性（+ 新增 §8.5 容量口径、§8.6 生命周期） | [05-data](./architecture/05-data.md) |
| §9 | 配置、错误、日志、安全、可观测性 | [06-crosscutting](./architecture/06-crosscutting.md) |
| §11 | 质量属性与验证（+ 新增 §11.1 场景、§11.2 fitness function） | [07-quality](./architecture/07-quality.md) |
| §12 · §14 | 演进路线、条件触发、风险登记簿（+ 新增 R16–R20、§15 待决策） | [08-evolution](./architecture/08-evolution.md) |
| §13 | 21 条决策索引 + 可逆性标注 | [decisions/](./decisions/README.md) |

---

## 为什么要拆

原来的 37KB 单文件同时服务 4 类读者（新人、模块接手者、值班、产品），却没有任何阅读路径——要么全读 1.5 小时，要么全不读。

拆分后每份文档有自己的契约（回答什么问题 / 读者 / 长度上限 / 更新触发条件），阅读路径写在 [docs/README.md](./README.md) §3。
