# 云谱（gramps）

> **30 秒导航**：是什么 · 怎么跑 · 去哪看设计。
> 本文件只指路，不复制事实：具体内容都在它自己的归属文件里。
> 现在做到哪、下一步做什么，只看 [`docs/roadmap.md`](docs/roadmap.md)；本文件不维护「当前值」快照。

---

## 1. 是什么

面向**家族修谱场景**的在线谱牒编纂平台：一个组织（家族或修谱工作室）在云端建「云谱空间」，录入世系、撰写谱文、编排谱书目录。使用者是修谱主事人、修谱工作室与族内协作者；M1 只解决「把信息结构化地存下来」，呈现与协作留到 M2 之后。

形态是**模块化单体**：单个 Next.js 应用承载页面、Server Action 与只读 Route Handler，全部业务域共用一个 PostgreSQL；没有微服务、消息队列、后台任务或独立缓存层。运行在 Vercel（应用）+ Neon（数据库），界面全简体中文，品牌「云谱」。

- 产品意图、目标用户、成功度量与明确不做：[`docs/vision.md`](docs/vision.md)
- 系统边界、模块划分、技术栈与部署形态：[`docs/architecture.md`](docs/architecture.md)

**明确不做**：邮箱验证 / 找回密码 / 邮件发送、`/api/auth/*`、后台任务、匿名业务页与公开 API、回收站 UI、编辑锁、分享、i18n、谱书编目编辑与成品排版。范围调整先改 `vision.md` 与 `roadmap.md`，再动受影响的子 spec。

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
pnpm arch:check
```

完整命令表、环境变量、测试分层与 CI：[`docs/runbooks/`](docs/runbooks/) 与 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
**不存在的命令**：`pnpm db:reset`、ESLint、dependency-cruiser。

---

## 3. 去哪看设计

### 3.1 目录结构

```
/
├── README.md                      30 秒导航
├── CONTRIBUTING.md                变更→跟改文档、提交与评审
├── CHANGELOG.md
│
├── .specify/                      治理层（最稳定，改动影响全项目）
│   ├── memory/constitution.md     不可协商的原则 + 文档维护约定
│   └── templates/                 项目定制的 spec / plan / tasks / checklist 模板
│
├── docs/                          项目层（长期活文档，跨 feature 共用）
│   ├── vision.md                  产品意图、范围边界、明确不做
│   ├── glossary.md                全项目唯一术语表
│   ├── architecture.md            系统边界、模块划分、技术栈、部署形态
│   ├── interfaces.md              接口地图（谁调谁），细节指向 contracts/
│   ├── data-model.md              全局实体与关系，各 feature 的根
│   ├── nfr.md                     性能 / 安全 / 可用性 / 合规 + 可度量阈值
│   ├── contracts/                 跨 feature 接口契约，唯一真相源
│   ├── adr/                       决策记录，只写「为什么」
│   ├── roadmap.md                 编排核心：切片顺序、范围、依赖、状态
│   └── runbooks/                  上线、排障、回滚
│
├── specs/                         交付层（每个 feature 自包含，可整目录归档）
│   ├── _template/                 可复制骨架，不占编号
│   ├── 001-xxx/
│   └── _archive/
│
└── tests/                         可执行的验收标准（最终事实来源）
```

### 3.2 按变化频率分层

| 层 | 回答什么 | 位置 | 变化频率 | 改动影响 |
| --- | --- | --- | --- | --- |
| 治理层 | 哪些事永远不能做、文档怎么维护 | `.specify/` | 年级 | 全项目 |
| 项目层 | 整体意图、跨 feature 一致性、编排顺序 | `docs/` | 季度～周 | 跨 feature |
| 交付层 | 这一片怎么建、怎么验 | `specs/NNN-xxx/` | 迭代～天 | 单个 feature |
| 事实来源 | 系统实际被验收成什么样 | `tests/` | 随代码 | 可执行 |

变化快的放深、变化慢的放浅：一次变更的影响范围被自然隔离，评审时也清楚该找谁签字。

### 3.3 新人只读三份

`README.md` → `docs/architecture.md` → `docs/roadmap.md`。
读完应能说清：系统边界在哪、现在做到哪、下一步是什么。说不清，说明项目层漏了东西。

### 3.4 按任务读什么

| 你要做的事 | 先读 |
| --- | --- |
| 任何事 | constitution → roadmap |
| 第一天加入 | README → architecture → runbooks → CONTRIBUTING |
| 改表 / 加迁移 | data-model → contracts → 对应 spec |
| 加页面 / Action / API | interfaces → contracts → 对应 spec |
| 写测试 | 对应 spec 的验收标准 → `tests/` |
| 值班 / 故障 | runbooks → nfr |
| 评估一个改动 / 讨论要不要做 | vision → architecture → `adr/` |
| 产品 / 需求评审 | vision → roadmap → 对应 spec |
| AI Agent | constitution → roadmap → 对应 spec |

---

## 4. 文档纪律

> 不可协商的原则在 `.specify/memory/constitution.md`；本节只写日常可执行的规则，不重述原则。

- **单一真相源**：术语只在 `glossary.md`；接口契约只在 `docs/contracts/`；整体架构只在 `architecture.md`；全局实体只在 `data-model.md`；非功能阈值只在 `nfr.md`；状态与编排只在 `roadmap.md`。feature 文档只引用，不复制。
- **原则只引用**：`plan.md` 的 Constitution Check 逐条对照 constitution 编号，不把原则抄进每个 plan。
- **roadmap 先改，再改 spec**：范围变化先落到 roadmap 那一行，再动受影响的子 spec；条目 ID 一旦被引用就不可改，子 spec 在头部 `Input` 行写 `Parent roadmap → entry <ID>` 回链。
- **feature 目录可整体删除而不失真**：删掉任一 `specs/NNN-xxx/` 后，`docs/` 仍须讲得清系统在做什么。
- **ADR 只记为什么**：为什么选 A 不选 B、代价是什么，不记「我们用了 A」——后者属于 architecture。
- **测试是最终事实来源**：文字与 `tests/` 冲突时先确认哪个是意图，再同步两边，不允许长期双轨。
- **交付后归档**：每次交付完成，整目录打版本标签移入 `specs/_archive/`；已归档目录只读，行为变化开新目录。

变更要跟改哪些文档、提交与评审规则见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

---

## 5. 维护

- 结构或原则变更走 PR，并在 constitution 与 `adr/` 留记录。
- 提交前跑项目门禁（命令见 `CONTRIBUTING.md`）。
- 冲突时以代码与 `tests/` 为准；constitution 的禁止清单优先于任何技能或目标文档的建议。
