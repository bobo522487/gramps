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
app/                 路由、RSC 页面、Route Handler
components/          console / lineage / org / project / marketing / ui
lib/
├── auth/            会话、权限、Better Auth Action 包装
├── org/             组织 Action
├── project/         项目 Action
├── folder/          分类树 Action 与事务
├── lineage/         谱系/人丁 Action、事务服务、导航缓存
├── genealogy/       家谱 Zod schema
└── db/              schema、queries、drizzle、migrations
```

这是已采用的代码组织，不是过渡态；代码组织决策见 ADR-01，读通道决策见 ADR 0008。M1 的域是 `auth` / `org` / `project` / `folder` / `lineage`；`article` / `book` 是目标域。

### 4.2 模块职责与所有权

| 域 | 拥有的表 | 入口 |
|---|---|---|
| `auth` | `auth.*`（Better Auth） | `lib/auth/better-auth.ts`、`lib/auth/context.ts` |
| `organization` | `organization`、`organization_member`、`invite`、`activity_logs` | `lib/org/actions.ts`、`lib/db/queries/organizations.ts`、`lib/db/queries/activity.ts` |
| `project` | `project`、`folder` | `lib/project/actions.ts`、`lib/folder/actions.ts`、`lib/db/queries/projects.ts`、`lib/db/queries/folders.ts` |
| `lineage` | `lineage`、`node` | `lib/lineage/actions.ts`、`lib/lineage/node-services.ts`、`lib/db/queries/lineages.ts`、`lib/db/queries/nodes.ts` |
| `content`（目标） | `article` | 未实现；表已存在 |
| `publishing`（目标） | `book`、`book_catalog` | 未实现；表已存在 |

每张表有且只有一个 owner。跨域读数据调用 owner 域导出的查询函数，不直接 join 别人的表。

`organization_member` / `invite` 的写由 Better Auth 的 `auth_service` 执行，应用层只读；`activity_logs` 是产品活动流，账号级事件 `organization_id` 为空。

### 4.3 模块依赖方向

依赖方向只有三条：

1. `app/` 与 `components/` 只能 import `lib/<domain>` 的公开函数；
2. `lib/<domain>` 可以 import `lib/db/queries` 与 `lib/auth`，不得 import `app/` 或 `components/`；
3. `lib/db` 不得 import 任何 `lib/<domain>/actions.ts`。

### 4.4 分层职责

默认**垂直切片**：一个域一个目录，schema/query/action/页面就近放。只有满足以下任一条件才抽独立 service：

1. 同一规则被 ≥2 个入口调用；
2. 需要跨模块共享事务；
3. 需要被后台任务复用（M1 后台任务为 0）。

不再要求固定的 service/仓储三层文件；读走 `lib/db/queries/`，多步写走 `lib/<domain>/*-services.ts` 或 `lib/db/services.ts`。

---

## 7. 后端架构

### 7.1 分层与依赖规则

```
app/actions.ts / route.ts  →  lib/<domain>  →  lib/db/queries  →  lib/db/drizzle.ts
```

| 规则 | 执行方式 |
|---|---|
| 客户端组件不得 import `@/lib/db/*` | `biome.json` `noRestrictedImports`（`pnpm check`），另有 `server-only` |
| `lib/db/**` 不得 import `next/*` | `biome.json` `noRestrictedImports`（`pnpm check`） |
| `lib/db/queries/**` 不得 import Actions | `biome.json` `noRestrictedImports`（`pnpm check`） |
| 业务连接只由 `lib/db/drizzle.ts`、认证连接只由 `lib/db/auth-db.ts` 建立 | 评审 + import 约定 |
| 认证读写只走 `lib/auth/better-auth.ts` / `lib/db/auth-db.ts` | 运行时角色边界 + 评审 |
| `lib/<domain>` 不得 import `app/` 或 `components/` | 评审（尚无规则） |

> **约束状态**：前三条已由 Biome 在 `pnpm check` 中拦截，可违反即红；后三条仍靠评审。新增规则前请先确认它能在 CI 里变红——见 [07-quality §11.2](./07-quality.md)。

### 7.2 事务边界

一个写入口 = 一个事务；事务由 Action 或 `*-services.ts` 打开，同一流程只开一次；`*Tx` 变体只接收已有事务，不再开新事务；读路径按渲染单元合并（见 [04-runtime §5.1](./04-runtime.md)）。

跨域写操作共享同一个 `tx`：编目以后引用谱系时，同一事务内通过参数传递，不新建事务。

### 7.3 数据访问

| 场景 | 方式 |
|---|---|
| 单表查询 | Drizzle Query Builder |
| 复杂查询（ltree、窗口函数） | `sql` 模板 + 手写 SQL |
| 批量插入 | `db.insert().values([...])`，单条语句 |
| 行锁 | `SELECT ... FOR UPDATE` 写在 query 或事务服务内 |

**禁止 N+1**：列表页的关联数据必须用 `with`（Drizzle relations）或一次 `IN` 查询。Code review 检查项。

### 7.4 接口形态

| 通道 | 用途 | 数量 |
|---|---|---|
| RSC | 内部首屏读 | 全部页面 |
| TanStack Query | 交互工作区的客户端服务端状态缓存；刷新调用只读 Route Handler，变更经 Server Action | 画布、检查器及后续编辑器 |
| Server Action | 内部写 + 工作区读刷新 | 全部写操作 |
| Route Handler | 健康检查 + 工作区只读刷新 | 4 个（[ADR 0008](../decisions/0008-read-only-route-handlers.md)） |
