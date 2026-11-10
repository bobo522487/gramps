# 云谱（gramps）

> **30 秒导航**：是什么 · 怎么跑 · 去哪看设计。
> 本文件只指路，不复制事实：具体内容都在它自己的归属文件里。
> 现在做到哪、下一步做什么，只看 [`docs/roadmap.md`](docs/roadmap.md)；本文件不维护「当前值」快照。

---

## 1. 是什么

面向**家族修谱场景**的在线谱牒编纂平台：一个组织（家族或修谱工作室）在云端建「云谱空间」，录入世系、撰写谱文、编排谱书目录。使用者是修谱主事人、修谱工作室与族内协作者；M1 只解决「把信息结构化地存下来」，呈现与协作留到 M2 之后。

形态是**模块化单体**：单个 Next.js 应用承载页面、Server Action 与只读 Route Handler，全部业务域共用一个 PostgreSQL；没有微服务、消息队列、后台任务或独立缓存层。运行在 Vercel（应用）+ Neon（数据库），界面全简体中文，品牌「云谱」。

- 产品意图、目标用户、成功度量与明确不做：[`docs/overview.md`](docs/overview.md)
- 系统边界、模块划分、技术栈与部署形态：[`docs/architecture.md`](docs/architecture.md)

**明确不做**：邮箱验证 / 找回密码 / 邮件发送、`/api/auth/*`、后台任务、匿名业务页与公开 API、回收站 UI、编辑锁、分享、i18n、谱书编目编辑与成品排版。目标态数据层**没有软删列、删除一律 `ON DELETE RESTRICT`**，所以「回收站 UI」不做是结构决定，不是排期推迟；`book` / `book_catalog` / `book_export` 已落库但没有写入口，编目编辑仍不做。范围调整先改 `overview.md` 与 `roadmap.md`，再动受影响的子 spec。

---

## 2. 怎么跑

前置：Node.js 24 LTS · pnpm 12 · PostgreSQL 18（本地可用 Docker）。

```bash
pnpm install
pnpm db:setup      # 交互生成 .env、本地 Postgres、BETTER_AUTH_SECRET
pnpm db:migrate
pnpm db:seed       # 可选，本地演示数据
pnpm dev           # http://localhost:3000
```

提交前门禁：

```bash
pnpm check && pnpm typecheck && pnpm test
pnpm arch:check && pnpm docs:check
```

完整命令表、环境变量、测试分层与 CI：[`docs/runbooks/`](docs/runbooks/) 与 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
**不存在的命令**：`pnpm db:reset`、ESLint、dependency-cruiser。

---

## 3. 去哪看设计

### 3.1 去哪看文档

文档清单、阅读路线与「改什么 → 读什么」只在 [`docs/README.md`](docs/README.md) 维护一份，本文件不复制。

### 3.2 按变化频率分层

| 层 | 回答什么 | 位置 | 变化频率 | 改动影响 |
| --- | --- | --- | --- | --- |
| 治理层 | 哪些事永远不能做、文档怎么维护 | `.specify/` | 年级 | 全项目 |
| 项目层 | 整体意图、跨 feature 一致性、编排顺序 | `docs/` | 季度～周 | 跨 feature |
| 交付层 | 这一片怎么建、怎么验 | `specs/NNN-xxx/` | 迭代～天 | 单个 feature |
| 事实来源 | 系统实际被验收成什么样 | `tests/` | 随代码 | 可执行 |

变化快的放深、变化慢的放浅：一次变更的影响范围被自然隔离，评审时也清楚该找谁签字。

---

## 4. 文档纪律

> 不可协商的原则在 `.specify/memory/constitution.md`；本节只写日常可执行的规则，不重述原则。

- **单一真相源**：术语、契约、架构、实体、阈值、状态各有唯一归属文件；完整映射只在 [`.specify/memory/constitution.md`](.specify/memory/constitution.md) §5，本文件不复制那张表。
- **测试是最终事实来源**：文字与 `tests/` 冲突时先确认哪个是意图，再同步两边，不允许长期双轨。

其余可执行规则（原则只引用、roadmap 先改、feature 目录可删、ADR 只记为什么）、变更要跟改哪些文档、提交与评审规则，见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

---

## 5. 维护

- 结构或原则变更走 PR，并在 constitution 与 `adr/` 留记录。
- 提交前跑项目门禁（命令见 `CONTRIBUTING.md`）。
- 冲突时以代码与 `tests/` 为准；constitution 的禁止清单优先于任何技能或目标文档的建议。
