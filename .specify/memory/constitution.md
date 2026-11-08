# 项目原则（Constitution）

> **回答什么问题**：哪些事永远不能做、偏离了怎么留档、文档怎么维护。
> **读者**：全员 · 新人第一份 · AI Agent　**长度上限**：3 页
> **不写什么**：产品意图与明确不做（`docs/vision.md`）、术语（`docs/glossary.md`）、系统边界与技术栈（`docs/architecture.md`）、表与列（`docs/data-model.md`）、可度量阈值（`docs/nfr.md`）、接口契约（`docs/contracts/`）、编排与进度（`docs/roadmap.md`）、决策理由（`docs/adr/`）、可执行流程与 PR 清单（`CONTRIBUTING.md`）。

治理层唯一文件。原则正文**只在本文**；其余文档只引用编号，不复制第二份。编号沿用 `I`–`V`，是为了让已有 `plan.md` 的 Constitution Check 回链继续成立；正文与权威文本索引按本结构重写，不继承线上版本线。

---

## 1. 怎么用

- 每个 `plan.md` 的 Constitution Check MUST 逐条对照 `I`–`V` 与附加约束名称，只写「编号 / 判定 / 依据」，**依据指向权威文本，不抄原则原文**；只写「符合原则」不算判定。
- 偏离任一原则的例外 MUST 写一条 ADR（`docs/adr/README.md` §2），并在 PR 描述里写明影响面。
- 原则增删或语义变更 MUST 走 PR + 全员评审；本文件一改，全部模板与引用方跟改（`CONTRIBUTING.md` §1）。
- **本文不绑定具体架构**：技术选型在 `docs/architecture.md`，目标态数据规格在 `docs/data-model.md`，编排状态在 `docs/roadmap.md`。实现换代不改本文件；改本文件意味着原则本身变了。

## 2. 不可协商原则（Core Principles）

### I. 组织隔离与服务端授权

组织级读写 MUST 在服务端做组织成员与角色校验；权限判定 MUST 用权限串，不比较角色名；公开 ID（`slug` / `ref`）只用于定位，**MUST NOT 当授权凭证**；非组织成员与不存在的资源一律 404。

- 权威文本：`docs/architecture.md`（隔离模型）、`docs/contracts/README.md`（权限矩阵）
- 证据：集成测试的越权用例；`CONTRIBUTING.md` §7 评审第①项

### II. 认证与业务职责分离

认证身份是全局的、组织成员关系是本系统的，两者 MUST NOT 合并成一套模型；业务侧 MUST NOT 直接读写认证 schema，只引用用户 ID；密钥、密码哈希、整行用户数据 MUST NOT 进入客户端。

- 权威文本：`docs/data-model.md` §2 / §3、`docs/vision.md` §7
- 证据：安全路径测试；评审第②③项「信息泄露 / 认证语义」

### III. 写路径单事务

业务域多步写 MUST 收敛到单个事务，失败 MUST NOT 留下半成品数据；唯一约束 / `CHECK` 冲突 MUST 转成中文错误状态，不吞掉、不重试成重复数据。写通道只有一个，不在请求里串联多个独立写。

- 权威文本：`docs/architecture.md`、`docs/contracts/README.md`
- 证据：`tests/` 的失败路径用例（断言无残留行）

### IV. 先失败测试，后实现（NON-NEGOTIABLE）

行为变更 MUST 先写会失败的测试、确认它真的红，再实现到绿；涉及 SQL / 约束 / 成员隔离 / 多步事务的改动 MUST 补真实 PostgreSQL 集成测试。**声称「完成」前 MUST 有命令输出为证**，不以勾选框代替证据。

- 权威文本：`CONTRIBUTING.md` §6 / §8、`tests/`
- 证据：PR 自查清单对应的命令输出

### V. 单一事实来源与最小改动

同一事实 MUST 只写一份；状态 MUST 只写一处；文档 MUST 只指路、不复制。新增依赖、抽象层、目录结构 MUST 有当前需求作为理由，不为「以后可能用到」提前造。删掉任一 `specs/NNN-xxx/` 后 `docs/` 仍须自洽。

- 权威文本：`README.md` §4、`CONTRIBUTING.md` §2
- 证据：`pnpm docs:check --strict`（检查范围待随本结构修复，见 `docs/runbooks/README.md` §6）

## 3. 附加约束（按名称引用，与已有 `plan.md` 的「附加：…」一致）

| 约束 | 权威文本 | 证据 |
| --- | --- | --- |
| 租户数据不出组织；邮箱只读、密码不可逆、应用不接触哈希 | `docs/vision.md` §7 | 安全路径测试 |
| 日志脱敏：不记录密码、token、身份证、完整住址；结构化 JSON 带请求 ID | `docs/nfr.md`、`docs/runbooks/README.md` §4 | 巡检 SQL |
| 不把数据库错误或堆栈展示给用户，失败返回中文文案 | `docs/contracts/README.md` §2 | 错误态用例 |
| 全简体中文，不引入 i18n 框架 | `docs/vision.md` §7 | 文案评审 |
| 零后台任务 / 队列 / 定时器，无独立缓存层 | `docs/architecture.md`、`docs/adr/` 的 `0005` | `docs/data-model.md` §7 非目标 |
| 迁移与业务代码分开提交，不在构建流程里执行 DDL | `CONTRIBUTING.md` §5、`docs/architecture.md` | CI 迁移漂移检查 |

## 4. 禁止清单

以下 MUST NOT，**优先级高于任何技能或目标文档的建议**（`CONTRIBUTING.md` §9）：

- 不做匿名可访问的业务页面、公开 API、分享；不做邮箱验证 / 找回密码 / 邮件发送。
- 不新增后台任务、队列、定时器、独立缓存层；不引入 i18n 框架。
- 不把公开 ID 当授权凭证；不把密钥、哈希、整行用户、异常堆栈带到客户端。
- 不在没有失败测试的情况下先写业务代码；不把「实现完了再补测试」算作完成。
- 不为未来可能的需求提前拆目录、加抽象、加依赖；不交付半成品业务功能。
- 不在两份文档里写同一事实；不回改已发布 ADR 的结论或编号。

冲突时以代码与 `tests/` 为准：先确认哪个是意图，再同步两边，不允许长期双轨（`CONTRIBUTING.md` §9）。

## 5. 治理（Governance）

| 关注点 | 去哪读 |
| --- | --- |
| 产品意图、范围边界、明确不做 | `docs/vision.md` |
| 术语 | `docs/glossary.md` |
| 系统边界 / 模块 / 技术栈 / 部署形态 | `docs/architecture.md` |
| 接口地图与契约 | `docs/interfaces.md`、`docs/contracts/README.md` |
| 全局实体与关系（目标态规格） | `docs/data-model.md` |
| 可度量阈值 | `docs/nfr.md` |
| 编排与状态 | `docs/roadmap.md` |
| 决策理由 | `docs/adr/` |
| 上线 / 排障 / 回滚 | `docs/runbooks/README.md` |
| 可执行流程、提交与评审 | `CONTRIBUTING.md` |
| 测试分层与运行 | `tests/` |

- **修订程序**：原则增删或语义变更 MUST 走 PR，写明理由与影响面；影响架构方向的变更 MUST 同时落一条 ADR，编号发布后不改不复用。
- **版本策略**：语义化。MAJOR = 删除或重定义原则；MINOR = 新增原则 / 章节或实质扩展；PATCH = 澄清与笔误。仓库无 tag / release，此版本号只属于本文件，不是发布版本（`CHANGELOG.md` 口径）。
- **合规复核**：每个 PR 按 `CONTRIBUTING.md` §6 的自查清单逐项勾选并提供命令输出；执行者是那里的清单与 CI，本文件不重抄命令。
- **没有执行者的原则等于没有原则**：`I`–`V` 每条都已写明证据来源；写不出「怎么验」的新原则，不该进本文。

**Version**: 1.0.0 | **首次落地**: 2026-11-08 | **编号来源**: 已有 `plan.md` 的 `I`–`V` Constitution Check

## 6. 追溯

```bash
# plan 是否逐条引用编号，而不是抄原则原文
grep -rn "Constitution Check" specs/
grep -rn -E "^\| (I|II|III|IV|V) " specs/*/plan.md
# 偏离原则是否留了 ADR
grep -rn "偏离\|superseded" docs/adr/README.md
# 本文被谁引用
grep -rn "constitution" README.md CONTRIBUTING.md docs/adr/README.md
```

*本文件按新结构首次落地，未改动其他文档或代码。*
