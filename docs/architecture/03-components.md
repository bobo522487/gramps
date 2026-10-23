# 组件视图与后端架构

> **回答什么问题**：代码怎么分层？模块边界在哪？依赖只允许朝哪个方向？事务边界怎么定？
> **读者**：开发　**长度上限**：4 页
> **来源**：原 `architect.md` §4 · §7（编号保持不变）
> **目标 vs 现状**：本文描述目标架构。差异见 [实现状态](../implementation-status.md)。

---

## 4. 组件视图

### 4.1 模块划分

按**业务能力 + 数据所有权**切分，不按技术层切分。

```
src/
├── app/                        # 路由与页面（只做适配）
├── modules/
│   ├── identity/               # 成员、邀请
│   ├── organization/           # 组织、默认组织
│   ├── project/                # 云谱空间、分类
│   ├── lineage/                # 谱系、人丁、世次
│   ├── content/                # 谱文
│   └── publishing/             # 谱书、编目
├── server/                     # 基础设施：db、auth、errors、logger、config
└── components/                 # 通用 UI 组件
```

M1 只有 6 个模块。`collab`（锁/回收站）与 `media`（上传）随对应功能一起进 M2。

> **目录偏差**：当前实现位于 `lib/<domain>/`（`lib/org`、`lib/project`、`lib/lineage`、`lib/folder`、`lib/auth`、`lib/db`），未采用 `src/modules/`。这是**目录约定**层面的差异，不影响模块划分与依赖规则本身。是否搬迁见 [decisions/README](../decisions/README.md#待决策)。

### 4.2 模块职责与所有权

| 模块 | 拥有的表 | 对外导出 |
|---|---|---|
| `identity` | `organization_member`、`invite` | `requireOrgContext`、`orgMemberQuery` |
| `organization` | `organization` | `organizationService`、`organizationQuery` |
| `project` | `project`、`folder` | `projectQuery`、`folderQuery` |
| `lineage` | `lineage`、`node` | `lineageQuery`、`lineageService`、`nodeService` |
| `content` | `article` | `articleQuery`、`articleService` |
| `publishing` | `book`、`book_catalog` | `bookQuery`、`catalogService` |

每张表有且只有一个 owner。**跨模块读数据必须调对方导出的 query，禁止直接 join 别人的表。**

### 4.3 模块依赖方向

```
        ┌────────────────────────────────────────┐
        │  server（db / auth / errors / logger）  │  ← 所有模块可用
        └───────────────────┬────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
   identity                              organization
        └───────────────────┬───────────────────┘
                            ▼
                        project
                 ┌──────────┴──────────┐
                 ▼                     ▼
             lineage                content
                 └──────────┬──────────┘
                            ▼
                       publishing
```

依赖只允许**向下**。`lineage` 不能 import `publishing`；`publishing` 可以 import `lineage`（编目要引用谱系）。

### 4.4 分层职责

每个模块内部固定三层：

| 层 | 文件 | 职责 | 禁止 |
|---|---|---|---|
| 适配层 | `app/**/page.tsx`、`actions.ts`、`route.ts` | 解析输入、调 service、格式化输出 | 写业务规则、直接查库 |
| 服务层 | `*.service.ts` | 业务规则、事务边界、权限校验 | import `next/*`、拼 SQL |
| 仓储层 | `*.repo.ts` | SQL、映射到领域对象 | 业务判断 |

`service.ts` 里出现 `import { cookies } from 'next/headers'` 是**架构违规**，目标设计用 Biome 的 `noRestrictedImports` 规则拦截，配合代码评审与测试约束。

> **待决策：三层 vs 垂直切片。** 三层的收益来自「同一条规则被多处调用」。本项目 6 个模块、30 个 Action，绝大多数业务规则是「校验 + 权限 + 一次写入 + 失效缓存」，服务层没有独立逻辑可放；真正有规则的地方（子树重算、级联软删）自然聚成了长文件。当前代码已自发漂向按域聚合。
>
> 建议把规则改为：**默认垂直切片；满足以下任一条件才抽服务层**——① 同一规则 ≥2 个入口调用 ② 需要跨模块共享事务 ③ 需要被定时任务复用。见 [decisions/README](../decisions/README.md#待决策)。

---

## 7. 后端架构

### 7.1 分层与依赖规则

```
route.ts / actions.ts  →  *.service.ts  →  *.repo.ts  →  db
        (适配)              (业务)          (SQL)
```

| 规则 | 强制方式 |
|---|---|
| `service.ts` 不得 import `next/*` | Biome `noRestrictedImports` + 评审 |
| `repo.ts` 不得 import `*.service.ts` | Biome `noRestrictedImports` + 评审 |
| 只有 `repo.ts` 能 import `src/server/db` | Biome `noRestrictedImports` + 评审 |
| 跨模块只能 import 对方 `index.ts` 导出的内容 | Biome `noRestrictedImports` |
| `server-only` 模块不得被客户端组件引用 | `server-only` 包 |

> **约束状态**：`server-only` 已在用；`noRestrictedImports` 规则**尚未配置**。在没有 lint 执行的情况下，上表前四条只是建议。补齐这组规则是 [07-quality §11](./07-quality.md) 中「fitness function」的第一批候选。

### 7.2 事务边界

**一个 Server Action = 一个事务。** 事务在 `withOrg` 里开，service 不自己开事务，避免嵌套。

跨模块的写操作共享同一个 `tx`：编目引用谱系时，`catalogService` 拿到的是 `publishing` 模块的 `tx`，通过参数传递，不新建事务。

> **一致性提示**：一个页面渲染如果跨多个 `withOrg` 调用，会落在多个快照上，`lineage.node_count` 这类冗余计数可能与同页的节点列表不一致。读路径应尽量收敛到**一个请求级事务**，见 [04-runtime §5.1](./04-runtime.md)。

### 7.3 数据访问

| 场景 | 方式 |
|---|---|
| 单表查询 | Drizzle Query Builder |
| 复杂查询（ltree、窗口函数） | `sql` 模板 + 手写 SQL |
| 批量插入 | `db.insert().values([...])`，单条语句 |
| 行锁 | `SELECT ... FOR UPDATE` 写在 repo 内 |

**禁止 N+1**：列表页的关联数据必须用 `with`（Drizzle relations）或一次 `IN` 查询。Code review 检查项。

### 7.4 接口形态

| 通道 | 用途 | 数量 |
|---|---|---|
| RSC | 内部首屏读 | 全部页面 |
| TanStack Query | 交互工作区的客户端服务端状态缓存；刷新调用只读 Route Handler，变更经 Server Action | 画布、检查器及后续编辑器 |
| Server Action | 内部写 + 工作区读刷新 | 全部写操作 |
| Route Handler | 健康检查 + 只读刷新端点 | 目标 1 个 / 当前 4 个 |

> **读通道待决策**：原设计写「只读端点目标收敛为 Server Action」。这条建议被质疑：Server Action 本质是 POST，不可缓存、不可预取、Next 会串行化排队，且会让「按路由聚合 p95」失去意义（所有读挤在同一个 POST 上）。建议改为**保留只读 Route Handler**，并把它写进设计而非过渡态。见 [decisions/README](../decisions/README.md#待决策)。
