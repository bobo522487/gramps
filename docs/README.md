# 文档中心

> 本文件是 `docs/` 的入口。**先看「阅读路径」，再按角色取文档**，不要从头读。

---

## 1. 两套内容，不是同一套系统

本仓库同时存在两层内容：

| 平面 | 说明 | 在哪 |
|---|---|---|
| **目标设计** | 面向家谱编纂场景的 M1 设计：要做什么、表长什么样、接口契约、部署蓝图 | `prd.md` · `decisions/` · `data-model.md` · `api.md` · `ops-target.md` |
| **当前实现** | 仓库里真实运行的代码，以及它现在的结构 | [`implementation-status.md`](./implementation-status.md) · [`architecture/`](./architecture/00-文档说明.md) · [`guides/`](./guides/) · [`setup.md`](./setup.md) · `../AGENTS.md` |

**判断规则：**

- 要跑项目、改代码、加页面、加迁移 → 读 `guides/` + `setup.md`。
- 要了解现在怎么搭的（模块、数据、接口、部署、运行时）→ 读 `architecture/`。
- 要讨论产品需求、目标数据模型、未来形态 → 读 `prd.md` + `data-model.md` + `decisions/`。
- **不要把目标设计里的表名、目录、命令直接套到当前代码上。**
- 一个功能到底实现了没有，**只以 [`implementation-status.md`](./implementation-status.md) 为准**——架构文档只写结构，目标设计文档不各自声明实现状态。

---

## 2. 文档地图

```
docs/
├── README.md                    ← 你在这里
│
├── prd.md                       产品需求：范围、角色、功能需求、验收标准
│
├── architecture/                现在怎么搭的（as-is，15 份）
│   ├── 00-文档说明.md           ★ 文档集导航、阅读路径、术语表
│   ├── 01-架构总览.md           ★ 一页纸 + C4-L1 + 十条要点
│   ├── 02-架构目标与约束.md     业务目标、质量属性、约束
│   ├── 03-逻辑视图-模块设计.md   分层、模块所有权、依赖方向、领域模型
│   ├── 04-数据视图-数据架构.md   存储、表分组、隔离、一致性、生命周期
│   ├── 05-接口与集成设计.md     Action 契约、Route Handler、外部集成
│   ├── 06-部署视图-部署架构.md   C4-L2/L3、环境、CI/CD、扩缩容
│   ├── 07-运行视图-关键流程.md   读写路径、时序、状态机、异常与补偿
│   ├── 08-非功能性设计.md       性能、可用性、容量、fitness function
│   ├── 09-安全架构.md           认证授权、数据安全、威胁建模
│   ├── 10-可观测性与运维.md     日志、探针、告警现状、故障处理、恢复
│   ├── 11-技术选型与决策记录.md  技术栈 + ADR 索引 + 待决策
│   ├── 12-需求追溯矩阵.md       需求 ↔ 模块 ↔ 接口 ↔ 测试
│   ├── 13-风险与演进规划.md     风险登记簿、技术债顺序、演进方向
│   └── 14-附录.md               图集、术语补充、参考资料、旧文件对照
│
├── decisions/                   为什么不是别的方案
│   ├── README.md                决策索引 + 待决策表
│   ├── 0001-foundation-reset.md 基础层重置
│   ├── 0002-no-edit-lock.md     不做编辑锁
│   ├── 0003-tree-storage-ltree.md  树存储与严格父系
│   ├── 0004-soft-delete-forever.md 软删永存
│   ├── 0005-zero-background-jobs.md 零后台任务
│   ├── 0006-rls-isolation.md    RLS 三层隔离
│   ├── 0007-self-hosted-better-auth.md 自托管 Better Auth
│   ├── 0008-read-only-route-handlers.md 保留只读 Route Handler
│   └── 0009…0013、0016-*.md     其余正式 ADR（编号不连续，以索引为准）
│
├── guides/                      怎么用
│   ├── add-a-feature.md         ★ 新增一个实体的 10 步清单
│   ├── runbooks.md              ★ 误删恢复、密码重置、密钥轮换、连接池
│   ├── testing.md               ★ 测试分层与写法
│   └── spec-driven-workflow.md  ★ spec-kit × superpowers 分工
│
├── data-model.md                目标：表结构、索引、RLS 策略、迁移规范
├── api.md                       目标：Action 契约、错误码
├── ops-target.md                目标：环境变量、部署、回滚、恢复
├── setup.md                     教程：本地跑起来
├── implementation-status.md     ★ 唯一状态来源
│
├── architect.md                 跳转页（正文已拆到 architecture/）
└── reviews/                     评审记录（历史，不作为规范）
```

---

## 3. 阅读路径

| 你要做什么 | 按顺序读 | 约 |
|---|---|---|
| **第一天加入** | [00-文档说明](./architecture/00-文档说明.md) → [01-架构总览](./architecture/01-架构总览.md) → [03-逻辑视图-模块设计](./architecture/03-逻辑视图-模块设计.md) → [setup](./setup.md) → [add-a-feature](./guides/add-a-feature.md) | 40 min |
| **接手一个模块** | [03-逻辑视图-模块设计](./architecture/03-逻辑视图-模块设计.md) → [07-运行视图-关键流程](./architecture/07-运行视图-关键流程.md) → [04-数据视图-数据架构](./architecture/04-数据视图-数据架构.md) → [data-model](./data-model.md) | 50 min |
| **值班 / 故障** | [runbooks](./guides/runbooks.md) → [10-可观测性与运维](./architecture/10-可观测性与运维.md) → [ops-target](./ops-target.md) → [13-风险与演进规划](./architecture/13-风险与演进规划.md) | 15 min |
| **评估一个改动** | [02-架构目标与约束](./architecture/02-架构目标与约束.md) → [08-非功能性设计](./architecture/08-非功能性设计.md) → [decisions](./decisions/README.md) → [13-风险与演进规划](./architecture/13-风险与演进规划.md) | 30 min |
| **产品 / 需求评审** | [prd](./prd.md) → [implementation-status](./implementation-status.md) → [12-需求追溯矩阵](./architecture/12-需求追溯矩阵.md) | 20 min |
| **AI Agent** | [../AGENTS.md](../AGENTS.md) → [implementation-status](./implementation-status.md) → 需要知道当前结构时读 [00-文档说明](./architecture/00-文档说明.md) 与 [01-架构总览](./architecture/01-架构总览.md) | — |

---

## 4. 当前状态

本文件不再维护“当前值”快照。框架版本、表数、Route Handler、测试数量与已实现功能，一律以 [implementation-status](./implementation-status.md) 为准。

需要产品背景读 [PRD](./prd.md)；需要当前架构结构读 [architecture/](./architecture/00-文档说明.md)；需要本地命令读 [setup](./setup.md)。

---

## 5. 文档维护规则

### 5.1 单一事实来源

| 事实 | 只写在这 |
|---|---|
| 产品范围、功能需求、验收标准 | `prd.md` |
| 架构结构（模块、数据、接口、部署、运行时） | `architecture/` 对应文件 |
| 表结构、约束、索引、RLS 策略 | `data-model.md` |
| Action 契约、错误码 | `api.md` |
| 环境变量、部署、回滚 | `ops-target.md` |
| 实现状态、表/Route Handler 数量、测试统计 | `implementation-status.md` |
| 决策与放弃的方案 | `decisions/` |
| 当前命令 | `setup.md` |
| 需求规格与两层工作流分工 | `guides/spec-driven-workflow.md` |

**同一事实不要在多个文档里各写一份。** 其他地方用链接指过来。

### 5.2 状态只写一处

- **架构文档不写实现状态。** 不要写「本文档尚未实现」「FR-X 未完成」这类话——它会在下一次更新时变成谎话。
- 实现状态只在 `implementation-status.md` 维护。
- 一次实现推进只需更新**一份**文档的状态。

### 5.3 每份文档的契约

新增文档时先回答四个问题，写进文件头的引用块：

```markdown
> **回答什么问题**：...
> **读者**：...　**长度上限**：N 页
> **来源**：原 xxx.md §N（若为拆分）
> **目标 vs 现状**：本文描述当前实现（as-is）。目标设计见 PRD 与 decisions（子目录文档写 `../prd.md`，根目录写 `./prd.md`）。
```

### 5.4 代码变化时同步

| 变化 | 要更新 |
|---|---|
| 新增 / 删除表、Action、Route Handler | `implementation-status.md` §1 + 对应 FR 行 |
| 某个 FR 从 ⬜ 变 ✅ | `implementation-status.md` 对应行 |
| 做出一个「不可逆」的决策 | 新增 `decisions/NNNN-*.md`，并在 `decisions/README.md` 索引加一行 |
| 发现新的架构风险 | `architecture/13-风险与演进规划.md` 风险登记簿 |
| 解决一个待决策项 | 从 `decisions/README` 待决策表移除，转为 ADR 或更新目标文档 |
| 模块边界、依赖方向、部署单元变化 | `architecture/` 对应文件（结构变了才改，状态变了不改这里） |

### 5.5 提交前检查

- `pnpm docs:check`（链接、锚点、过期路径、矛盾措辞、文档头）。
- 相对链接目标存在，锚点与标题一致。
- 命令在 `package.json` 中存在。
- 环境变量在代码或 `.env.example` 中真实出现。
- 没有在架构文档里新加状态声明。

### 5.6 文档边界

`reviews/` 下是评审记录，**不是规范**。其中的建议在转化为 `architecture/` 或 `decisions/` 的内容之前，不具备约束力。
