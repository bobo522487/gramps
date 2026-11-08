# 协作与文档维护

> 回答三件事：改一处东西要跟改哪些文档、怎么提 PR、什么才算完成。
> 不可协商的原则在 [`.specify/memory/constitution.md`](.specify/memory/constitution.md)；本文件只写可执行流程，**不重述原则**。

---

## 1. 变更 → 跟改文档 对照表

| 你要改的东西 | 唯一归属地 | 必须跟改 | 建议评审人 |
| --- | --- | --- | --- |
| 产品意图、范围边界、明确不做 | `docs/vision.md` | `docs/roadmap.md` | 产品负责人 |
| 需求范围、切片顺序、依赖、状态 | `docs/roadmap.md` | 受影响子 spec 的 `Input` 行 | 产品 + 技术负责人 |
| 术语、领域语言 | `docs/glossary.md` | 所有引用该术语的 spec、`docs/data-model.md` | 全员（语言对齐） |
| 系统边界、模块、技术栈、部署形态 | `docs/architecture.md` | `docs/interfaces.md`、相关 `docs/adr/` | 技术负责人 |
| 接口契约（Action、DTO、错误码） | `docs/contracts/` | `docs/interfaces.md`、相关 feature 的 `contracts/` | 调用双方负责人 |
| 全局实体与关系 | `docs/data-model.md` | 相关 spec 的实体引用 | 技术负责人 |
| 性能 / 安全 / 可用性 / 合规阈值 | `docs/nfr.md` | `tests/` 中对应验收用例 | 测试 + 运维 |
| 技术选型理由 | `docs/adr/NNNN-xxx.md` | 一般不改已生效 ADR，新增一条 supersede | 技术负责人 |
| 单个 feature 的行为 | `specs/NNN-xxx/spec.md` | `plan.md`、`tasks.md`、`tests/` | 产品 + 测试 |
| 上线 / 排障 / 回滚步骤 | `docs/runbooks/` | `CHANGELOG.md` | 运维 |
| 文档结构或原则本身 | `.specify/memory/constitution.md` | 全部模板与引用方 | 全员评审 |

**同一事实只写一份。** 发现两处写同一件事，删掉一处、留链接，不要两边都改。

---

## 2. 单一真相源速记

- 术语只在 `glossary.md`；契约只在 `docs/contracts/`；整体架构只在 `architecture.md`；全局实体只在 `data-model.md`；阈值只在 `nfr.md`；状态与编排只在 `roadmap.md`。feature 文档只引用，不复制。
- 原则只在 `constitution.md`：`plan.md` 的 Constitution Check 逐条对照原则编号，不把原则原文抄进每个 plan。
- **roadmap 先改，再改 spec**：范围变化先落到 roadmap 那一行，再动受影响的子 spec；条目 ID 一旦被引用就不可改、不复用。
- ADR 只记「为什么选 A 不选 B、代价是什么」，不记「我们用了 A」——后者属于 `architecture.md`。

---

## 3. 每份文档的开头

新增或重写文档时，先在开头写清三件事，便于读者判断该不该读：

```
> **回答什么问题**：...
> **读者**：...　**长度上限**：N 页
> **不写什么**：...（明确排除的内容，指向它的归属文件）
```

正文里既有现状又有目标时，用 `[现状]` / `[目标]` 前缀标出段落边界，不要靠目录位置暗示。

---

## 4. feature 交付流程

1. **roadmap 先改**：在 `docs/roadmap.md` 建行，拿到不可变条目 ID。
2. **specify**：从 `.specify/templates/` 的模板生成 `specs/NNN-xxx/`（编号三位递增、旧 `001`–`003` 不复用），在 `spec.md` 头部 `Input` 行写 `Parent roadmap → entry <ID>`。
3. **写 spec.md**：按 EARS 句式写需求（始终约束 / 事件触发 / 异常处理 / 状态期间 / 可选特性），补齐边界值、异常状态、权限矩阵、数据口径、埋点与可验收标准；每条需求有稳定 `FR-xxx` ID。
4. **plan**：Constitution Check 逐条引用原则编号；记录技术方案、接口、数据结构、兼容性与风险；选型理由落一条 ADR。
5. **tasks**：拆到可执行粒度，每条任务标注覆盖的 `FR-xxx`。任务清单只留一份。
6. **implement**：代码与 `tests/` 同批提交，测试用例 ID 回链 `FR-xxx`。
7. **归档**：整目录打版本标签（如 `specs/_archive/NNN-xxx@YYYY-MM-DD/`）移入归档区，归档目录只读；后续行为变化开新目录，不回改历史目录。

`spec.md` 只写「要什么、为什么、怎么验收」；表结构、文件路径、函数名属于 `plan.md`。

---

## 5. 提交规范

**Commit**：`<type>(<scope>): <描述>`；一个 commit 只做一件事；迁移与业务代码分开提交；规格与文档一律简体中文。

| 字段 | 取值 |
| --- | --- |
| `type` | `feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `perf` |
| `scope` | `auth` / `org` / `project` / `db` / `ui` / `docs` / `ci` / `ts` / `spec` / `agents` |

---

## 6. PR 自查清单

勾选前须有命令输出为证。

- [ ] `pnpm check && pnpm typecheck && pnpm test` 全绿；`pnpm arch:check`、`pnpm docs:check --strict` 无 issue。
- [ ] 涉及 SQL / 约束 / 成员隔离 / 多步事务的改动补了 `pnpm test:integration`，失败路径不留半成品数据。
- [ ] CI 的 `test:coverage`、`test:e2e`、`verify:deploy` 与迁移漂移检查能通过。
- [ ] 新增的组织级查询 / 写入都带 `orgId` 且做成员校验；公开 ID 查询带 `userId`，非成员一律 404。
- [ ] 没有返回密码哈希或整行用户；新表有已 review 的迁移并已启用 RLS。
- [ ] 安全路径有测试（越权、信息泄露、认证语义、错误处理）。
- [ ] 没有把业务功能做成半成品。
- [ ] 文档已按第 1 节对照表跟改；**状态只写 `docs/roadmap.md`**，其他文档不声明进度。
- [ ] 任一 `FR-xxx` 能一路 grep 到 plan 决策、ADR、tasks 任务与 `tests/` 用例。
- [ ] 删掉本 feature 目录后，`docs/` 仍然自洽。
- [ ] `CHANGELOG.md` 已记录。

---

## 7. 评审顺序

① **越权**（猜 ID 能否访问别的组织）→ ② **信息泄露**（整行数据 / 密钥 / 内部错误）→ ③ **认证语义**（会话是否查库、撤销是否正确）→ ④ **错误处理**（401 / 403 / 404）→ ⑤ **迁移**（可重复、可回滚、影响现有数据）→ ⑥ **命名与风格**。

---

## 8. 完成定义

- 本地门禁全绿，并按改动范围跑集成 / E2E。
- 行为、命令或环境变化时，文档按第 1 节同步；状态只更新一处。
- `tests/` 是最终事实来源：文字与测试冲突时，先确认哪个是意图，再同步两边，不允许长期双轨。
- 声称「完成」前要有命令输出为证，不以勾选框代替证据。

---

## 9. 维护本结构

- 目录结构或文档约定的变更走 PR，并在 `constitution.md` 与 `docs/adr/` 留记录。
- 新增文档前先确认：这件事是否已有归属文件？能加章节就不要新建文件。
- 冲突时以代码与 `tests/` 为准；`constitution.md` 的禁止清单优先于任何技能或目标文档的建议。
