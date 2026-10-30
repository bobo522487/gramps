# 文档中心

> 本文件是 `docs/` 的入口。**先看「阅读路径」，再按角色取文档**，不要从头读。

---

## 1. 两套内容，不是同一套系统

本仓库同时存在两层内容：

| 平面 | 说明 | 在哪 |
|---|---|---|
| **目标设计** | 面向家谱编纂场景的 M1 设计：谱系/谱文/谱书、部署到 Vercel + Neon | `prd.md` · `architecture/` · `decisions/` · `data-model.md` · `api.md` · `ops-target.md` |
| **当前实现** | 仓库里真实运行的代码 | [`implementation-status.md`](./implementation-status.md) · [`guides/`](./guides/) · [`setup.md`](./setup.md) · `../AGENTS.md` |

**判断规则：**

- 要跑项目、改代码、加页面、加迁移 → 读 `guides/` + `setup.md`。
- 要讨论产品需求、目标数据模型、未来架构 → 读 `prd.md` + `architecture/`。
- **不要把目标设计里的表名、目录、命令直接套到当前代码上。**
- 一个功能到底实现了没有，**只以 [`implementation-status.md`](./implementation-status.md) 为准**——目标设计文档不再各自声明实现状态。

---

## 2. 文档地图

```
docs/
├── README.md                    ← 你在这里
│
├── prd.md                       产品需求：范围、角色、功能需求、验收标准
│
├── architecture/                怎么做
│   ├── 00-overview.md           ★ 一页纸：3 张图 + 十条要点
│   ├── 01-drivers.md            目标 G1–G6、约束、非目标
│   ├── 02-context.md            系统边界、部署视图、部署拓扑
│   ├── 03-components.md         模块划分、依赖方向、分层规则、事务边界
│   ├── 04-runtime.md            读/写请求路径、组织解析、前端与画布
│   ├── 05-data.md               存储、隔离、连接、一致性、容量口径
│   ├── 06-crosscutting.md       配置、错误、日志、安全、可观测性
│   ├── 07-quality.md            质量属性、验证手段、fitness function
│   └── 08-evolution.md          演进路线、风险登记簿、待决策项
│
├── decisions/                   为什么不是别的方案
│   ├── README.md                决策索引（21 条）+ 8 篇正式 ADR
│   ├── 0001-foundation-reset.md 基础层重置
│   ├── 0002-no-edit-lock.md     不做编辑锁
│   ├── 0003-tree-storage-ltree.md  树存储与严格父系
│   ├── 0004-soft-delete-forever.md 软删永存
│   ├── 0005-zero-background-jobs.md 零后台任务
│   ├── 0006-rls-isolation.md    RLS 三层隔离
│   ├── 0007-self-hosted-better-auth.md 自托管 Better Auth
│   └── 0008-read-only-route-handlers.md 保留只读 Route Handler
│
├── guides/                      怎么用
│   ├── add-a-feature.md         ★ 新增一个实体的 10 步清单
│   ├── runbooks.md              ★ 误删恢复、密码重置、密钥轮换、连接池
│   ├── testing.md               ★ 测试分层与写法
│   └── spec-driven-workflow.md  ★ spec-kit × superpowers 分工
│
├── data-model.md                是什么：表结构、索引、RLS 策略、迁移规范
├── api.md                       是什么：Action 契约、错误码
├── ops-target.md                是什么：环境变量、部署、回滚、恢复
├── setup.md                     教程：本地跑起来
├── implementation-status.md     ★ 唯一状态来源
│
├── architect.md                 跳转页（内容已拆到 architecture/）
└── reviews/                     评审记录（历史，不作为规范）
```

---

## 3. 阅读路径

| 你要做什么 | 按顺序读 | 约 |
|---|---|---|
| **第一天加入** | [00-overview](./architecture/00-overview.md) → [01-drivers](./architecture/01-drivers.md) → [03-components](./architecture/03-components.md) → [setup](./setup.md) → [add-a-feature](./guides/add-a-feature.md) | 40 min |
| **接手一个模块** | [03-components](./architecture/03-components.md) → [04-runtime](./architecture/04-runtime.md) → [05-data](./architecture/05-data.md) → [data-model](./data-model.md) | 50 min |
| **值班 / 故障** | [runbooks](./guides/runbooks.md) → [ops-target](./ops-target.md) → [08-evolution 风险登记簿](./architecture/08-evolution.md) | 15 min |
| **评估一个改动** | [01-drivers](./architecture/01-drivers.md) → [07-quality](./architecture/07-quality.md) → [decisions](./decisions/README.md) → [08-evolution](./architecture/08-evolution.md) | 30 min |
| **产品 / 需求评审** | [prd](./prd.md) → [implementation-status](./implementation-status.md) | 20 min |
| **AI Agent** | [../AGENTS.md](../AGENTS.md) → [implementation-status](./implementation-status.md) → 仅在任务要求「按目标架构实现」时才读 `architecture/` | — |

---

## 4. 当前状态

本文件不再维护“当前值”快照。框架版本、表数、Route Handler、测试数量与已实现功能，一律以 [implementation-status](./implementation-status.md) 为准。

需要产品背景读 [PRD](./prd.md)；需要架构目标读 [architecture/](./architecture/00-overview.md)；需要本地命令读 [setup](./setup.md)。

---

## 5. 文档维护规则

### 5.1 单一事实来源

| 事实 | 只写在这 |
|---|---|
| 产品范围、功能需求、验收标准 | `prd.md` |
| 架构目标、约束、模块边界、运行时 | `architecture/` 对应文件 |
| 表结构、约束、索引、RLS 策略 | `data-model.md` |
| Action 契约、错误码 | `api.md` |
| 环境变量、部署、回滚 | `ops-target.md` |
| 实现状态、表/Route Handler 数量、测试统计 | `implementation-status.md` |
| 决策与放弃的方案 | `decisions/` |
| 当前命令 | `setup.md` |
| 需求规格与两层工作流分工 | `guides/spec-driven-workflow.md` |

**同一事实不要在多个文档里各写一份。** 其他地方用链接指过来。

### 5.2 状态只写一处

- **目标设计文档不写实现状态横幅。** 不要写「本文档尚未实现」这类话——它会在下一次更新时变成谎话。
- 实现状态只在 `implementation-status.md` 维护。
- 一次实现推进只需更新**一份**文档的状态。

### 5.3 每份文档的契约

新增文档时先回答四个问题，写进文件头的引用块：

```markdown
> **回答什么问题**：...
> **读者**：...　**长度上限**：N 页
> **来源**：原 xxx.md §N（若为拆分）
> **目标 vs 现状**：本文描述目标架构。差异见 实现状态（子目录文档写 `../implementation-status.md`，根目录写 `./implementation-status.md`）。
```

### 5.4 代码变化时同步

| 变化 | 要更新 |
|---|---|
| 新增 / 删除表、Action、Route Handler | `implementation-status.md` §1 + 对应 FR 行 |
| 某个 FR 从 ⬜ 变 ✅ | `implementation-status.md` 对应行 |
| 做出一个「不可逆」的决策 | 新增 `decisions/NNNN-*.md`，并在 `decisions/README.md` 索引加一行 |
| 发现新的架构风险 | `architecture/08-evolution.md` §14 风险登记簿 |
| 解决一个待决策项 | 从 `decisions/README` 待决策表移除，转为 ADR 或更新目标文档 |

### 5.5 提交前检查

- `pnpm docs:check`（链接、锚点、过期路径、矛盾措辞、文档头）。
- 相对链接目标存在，锚点与标题一致。
- 命令在 `package.json` 中存在。
- 环境变量在代码或 `.env.example` 中真实出现。
- 没有在目标设计文档里新加状态声明。

### 5.6 文档边界

`reviews/` 下是评审记录，**不是规范**。其中的建议在转化为 `architecture/` 或 `decisions/` 的内容之前，不具备约束力。
