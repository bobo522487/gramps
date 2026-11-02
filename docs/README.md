# 文档中心

> 本文件是 `docs/` 的入口。**先看「阅读路径」，再按角色取文档**，不要从头读。

---

## 1. 只有一层文档集

2026-11-02 起，`docs/` 不再分「根级事实层 + `architecture/` 结构层」两层：**根级文档全部并入 `docs/architecture/`，一个事实只有一份文档**。`docs/` 根目录只留本文件（入口）。

同一份文档里既有现状又有目标时，用前缀标出边界（`docs:check` 会校验文档头的「目标 vs 现状」字段）：

| 写法 | 含义 |
|---|---|
| `[现状]` | 代码里现在就是这样，改动时要同步 |
| `[目标]` | 还没落地、已决定要做；落地后改成 `[现状]` 并更新 [11-需求与实现状态](./architecture/11-需求与实现状态.md) §7 的状态列 |

**两条规则：**

- 同一件事只有一个来源：表与列只在 [04-数据视图-数据架构](./architecture/04-数据视图-数据架构.md)，接口契约只在 [05-接口与集成设计](./architecture/05-接口与集成设计.md)，命令只在 [13-本地开发与命令](./architecture/13-本地开发与命令.md)，环境变量与发布只在 [06-部署视图-部署架构](./architecture/06-部署视图-部署架构.md)，需求与状态只在 [11-需求与实现状态](./architecture/11-需求与实现状态.md)。其他地方用链接指过来。
- 文档之间不复制：发现两处写同一件事，删掉一处、留链接——这条 `docs:check` 拦不住，只能靠评审守。

**判断规则：**

- 要跑项目、改代码、加页面、加迁移 → [13-本地开发与命令](./architecture/13-本地开发与命令.md) + [`guides/`](./guides/)。
- 要了解现在怎么搭的（模块、数据、接口、部署、运行时）→ `architecture/` 对应视图。
- 要知道某个功能做到哪一步 → 只看 [11-需求与实现状态](./architecture/11-需求与实现状态.md) §7 的状态列；其他文档不声明进度。
- 要讨论要不要做、为什么这么定 → [11-需求与实现状态](./architecture/11-需求与实现状态.md) §1–§6 + [`decisions/`](./decisions/README.md)。
- **不要把 `[目标]` 段落里的表名、目录、命令直接套到当前代码上。**

---

## 2. 文档地图

```
docs/
├── README.md                    ← 你在这里（唯一根级文档）
│
├── architecture/                唯一文档集（14 份，00–13）
│   ├── 00-文档说明.md           ★ 文档集导航、阅读路径、术语表、历史对照
│   ├── 01-架构总览.md           ★ 一页纸 + C4-L1 + 十条要点
│   ├── 02-架构目标与约束.md     业务目标 G1–G6、质量属性、技术栈、约束
│   ├── 03-逻辑视图-模块设计.md   分层、模块所有权、依赖方向、领域模型
│   ├── 04-数据视图-数据架构.md   ★ 表/列/索引/RLS 策略/软删/迁移规范
│   ├── 05-接口与集成设计.md     ★ Server Action 清单、DTO、错误模型
│   ├── 06-部署视图-部署架构.md   ★ 环境变量、迁移执行、发布顺序、备份恢复
│   ├── 07-运行视图-关键流程.md   读写路径、时序、状态机、异常与补偿
│   ├── 08-非功能性设计.md       性能、可用性、容量、fitness function
│   ├── 09-安全架构.md           认证授权、数据安全、威胁建模
│   ├── 10-可观测性与运维.md     日志、探针、告警现状、故障处理、恢复
│   ├── 11-需求与实现状态.md     ★ 需求、FR 矩阵、模块状态（唯一状态来源）
│   ├── 12-风险与演进规划.md     风险登记簿 R1–R31、技术债顺序、演进方向
│   └── 13-本地开发与命令.md     ★ 本地跑起来、全部命令、测试与 CI
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
│   └── 0009…0013、0016…0018-*.md  其余正式 ADR（编号不连续，以索引为准）
│
├── guides/                      怎么用
│   ├── add-a-feature.md         ★ 新增一个实体的 10 步清单
│   ├── runbooks.md              ★ 误删恢复、密码重置、密钥轮换、连接池
│   ├── testing.md               ★ 测试分层与写法
│   └── spec-driven-workflow.md  ★ spec-kit × superpowers 分工
│
├── superpowers/plans/           执行计划（只留在飞的那一份）
└── archive/                     归档材料（评审、已完成计划、历史底稿；不参与 docs:check）
```

`specs/` 在 `docs/` 之外（仓库根），是 spec-kit 的规格层：[`../specs/001-lineage-edit-preview/spec.md`](../specs/001-lineage-edit-preview/spec.md) 是 M2 专项需求的现行版本。

---

## 3. 阅读路径

| 你要做什么 | 按顺序读 | 约 |
|---|---|---|
| **第一天加入** | [00-文档说明](./architecture/00-文档说明.md) → [01-架构总览](./architecture/01-架构总览.md) → [03-逻辑视图-模块设计](./architecture/03-逻辑视图-模块设计.md) → [13-本地开发与命令](./architecture/13-本地开发与命令.md) → [add-a-feature](./guides/add-a-feature.md) | 40 min |
| **接手一个模块** | [03-逻辑视图-模块设计](./architecture/03-逻辑视图-模块设计.md) → [07-运行视图-关键流程](./architecture/07-运行视图-关键流程.md) → [04-数据视图-数据架构](./architecture/04-数据视图-数据架构.md) | 50 min |
| **值班 / 故障** | [runbooks](./guides/runbooks.md) → [10-可观测性与运维](./architecture/10-可观测性与运维.md) → [06-部署视图-部署架构](./architecture/06-部署视图-部署架构.md) → [12-风险与演进规划](./architecture/12-风险与演进规划.md) | 15 min |
| **评估一个改动** | [02-架构目标与约束](./architecture/02-架构目标与约束.md) → [08-非功能性设计](./architecture/08-非功能性设计.md) → [decisions](./decisions/README.md) → [12-风险与演进规划](./architecture/12-风险与演进规划.md) | 30 min |
| **产品 / 需求评审** | [11-需求与实现状态](./architecture/11-需求与实现状态.md) §1–§6 → 同文件 §7 追溯矩阵 | 20 min |
| **AI Agent** | [../AGENTS.md](../AGENTS.md) → [11-需求与实现状态](./architecture/11-需求与实现状态.md) → 需要知道当前结构时读 [00-文档说明](./architecture/00-文档说明.md) 与 [01-架构总览](./architecture/01-架构总览.md) | — |

---

## 4. 当前状态

本文件不维护“当前值”快照。框架版本、表数、Route Handler、测试数量与已实现功能，一律以 [11-需求与实现状态](./architecture/11-需求与实现状态.md) 为准。

---

## 5. 文档维护规则

### 5.1 单一事实来源

| 事实 | 只写在这 |
|---|---|
| 产品范围、功能需求、FR 追溯、实现状态 | [11-需求与实现状态](./architecture/11-需求与实现状态.md) |
| 架构结构（模块、数据、接口、部署、运行时） | `architecture/` 对应文件 |
| 表结构、约束、索引、RLS 策略、软删 | [04-数据视图-数据架构](./architecture/04-数据视图-数据架构.md) |
| Action 契约、DTO、错误码 | [05-接口与集成设计](./architecture/05-接口与集成设计.md) |
| 环境变量、迁移执行、发布与回滚、备份 | [06-部署视图-部署架构](./architecture/06-部署视图-部署架构.md) |
| 本地命令、测试与 CI 怎么跑 | [13-本地开发与命令](./architecture/13-本地开发与命令.md) |
| 决策与放弃的方案 | [`decisions/`](./decisions/README.md) |
| 风险与演进触发条件 | [12-风险与演进规划](./architecture/12-风险与演进规划.md) |
| 质量目标与 fitness function | [08-非功能性设计](./architecture/08-非功能性设计.md) |
| 需求规格与两层工作流分工 | [`guides/spec-driven-workflow.md`](./guides/spec-driven-workflow.md) |

**同一事实不要在多个文档里各写一份。** 其他地方用链接指过来。

### 5.2 状态只写一处

- **状态只写在 [11-需求与实现状态](./architecture/11-需求与实现状态.md) §7 的矩阵状态列。** 其他文档不写「本文档尚未实现」「FR-X 未完成」这类话——它会在下一次更新时变成谎话。
- 一次实现推进只需更新**一份**文档的状态。
- 计划文件里的 `- [ ]` 不代表进度，判断做到哪一步只看 §7。

### 5.3 每份文档的契约

新增或重写文档时先回答三个问题，写进文件头的引用块（`docs:check` 会校验这些关键词在前 15 行内）：

```markdown
> **回答什么问题**：...
> **读者**：...　**长度上限**：N 页
> **目标 vs 现状**：本文哪部分是 `[现状]`、哪部分是 `[目标]`；目标设计的理由见 decisions。
```

### 5.4 代码变化时同步

| 变化 | 要更新 |
|---|---|
| 新增 / 删除表、Action、Route Handler | [11-需求与实现状态](./architecture/11-需求与实现状态.md) §8 + 对应 FR 行的状态 |
| 某个 FR 从「未实现」变「已实现」 | [11-需求与实现状态](./architecture/11-需求与实现状态.md) §7 状态列 |
| 做出一个「不可逆」的决策 | 新增 `decisions/NNNN-*.md`，并在 [`decisions/README.md`](./decisions/README.md) 索引加一行 |
| 发现新的架构风险 | [12-风险与演进规划](./architecture/12-风险与演进规划.md) 风险登记簿 |
| 解决一个待决策项 | 从 [`decisions/README.md`](./decisions/README.md) 待决策表移除，转为 ADR |
| 模块边界、依赖方向、部署单元变化 | `architecture/` 对应文件（结构变了才改，状态变了不改这里） |
| 命令、环境变量、迁移流程变化 | [13-本地开发与命令](./architecture/13-本地开发与命令.md) 或 [06-部署视图-部署架构](./architecture/06-部署视图-部署架构.md) |

### 5.5 提交前检查

- `pnpm docs:check`（链接、锚点、过期路径、矛盾措辞、文档头）。
- 相对链接目标存在，锚点与标题一致。
- 命令在 `package.json` 中存在。
- 环境变量在代码或 `.env.example` 中真实出现。
- 没有在架构文档里新加状态声明（状态只写 11 §7）。

### 5.6 文档边界

- `archive/` 下是归档材料（评审记录、已执行完的计划、历史底稿），**不是规范**，也不参与 `docs:check`。引用规则见 [archive/README.md](./archive/README.md)。
- `superpowers/plans/` 只留在飞计划；计划完成后移入 `archive/plans/`。
- `decisions/` 是不可改写的历史：已发布的 ADR 不改结论，只允许补充「后续」小节。
