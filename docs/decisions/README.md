# 决策索引

> **回答什么问题**：有哪些已定决策？哪条需要写正式 ADR？为什么不是别的方案？
> **读者**：所有人　**长度上限**：2 页（索引本身）
> **来源**：原 `architect.md` §13，另加「可逆性」标注与正式 ADR 清单
> **目标 vs 现状**：本索引记录的是**目标设计**的决策。实现层面的偏差见 [实现状态](../implementation-status.md)。

---

## 1. 索引与可逆性

**为什么标注可逆性**：单向门（改起来代价极高）值得花时间、值得写正式 ADR；双向门（错了能改）应该快速决定，不必留档。不区分这两类，会让「UUIDv7 vs serial」和「是否做编辑锁」看起来同等重要——实际差两个数量级。

| # | 决策 | 结论 | 可逆性 | 正式 ADR |
|---|---|---|:--:|---|
| ADR-01 | 架构风格 | 模块化单体 + `lib/<domain>` 垂直切片；不采用 `src/modules` 三层 | 单向门 | — |
| ADR-02 | 前后端边界 | RSC 直读 + Server Action，不做 REST | 双向门 | — |
| ADR-03 | 对外接口 | `/api/health` + 3 个只读刷新端点（共 4 个，保留） | 双向门 | [0008](./0008-read-only-route-handlers.md) |
| ADR-04 | 组织模型 | org + project 两级，URL 驱动解析；URL 标识符为 20 位随机公开 ID | 单向门 | — |
| ADR-05 | 默认组织 | 数据库触发器在 `auth.users` 插入时创建 | 双向门 | — |
| ADR-06 | 隔离机制 | RLS + 应用层 WHERE + 复合外键 | 单向门 | [0006](./0006-rls-isolation.md) |
| ADR-07 | 组织来源 | 查 `organization_member`，不入 JWT | 单向门 | [0006](./0006-rls-isolation.md) |
| ADR-08 | 树存储 | 邻接表 + `ltree` 物化路径 | 单向门 | [0003](./0003-tree-storage-ltree.md) |
| ADR-09 | 删除 | 软删，但 M1 无回收站界面 | 单向门 | [0004](./0004-soft-delete-forever.md) |
| ADR-10 | 并发 | **M1 不做锁**，last-write-wins | 双向门 | [0002](./0002-no-edit-lock.md) |
| ADR-11 | 邮件与邀请 | **M1 无邮件通道**，邀请走手动复制的一次性链接 | 双向门 | — |
| ADR-12 | 富文本 | 边界是 ProseMirror JSON，不存 HTML；编辑器选 TipTap，依赖**尚未安装**（决策 ≠ 现在安装） | 单向门 | [0010](./0010-rich-text-editor-selection.md) |
| ADR-13 | 检索 | 人丁搜索在客户端（全量载入 + 内存匹配）；`pg_trgm` 只保留给谱文 | 双向门 | [0011](./0011-search-boundary-node-client-article-trgm.md) |
| ADR-14 | 主键 | UUIDv7，PostgreSQL 18 原生 `uuidv7()` | 单向门 | — |
| ADR-15 | 后台任务 | M1 零个；边界见 ADR-23 | 双向门 | [0005](./0005-zero-background-jobs.md) · [0009](./0009-dependency-and-runtime-stance.md) |
| ADR-16 | 渲染管线 | M1 不做，M3 独立进程 | 双向门 | — |
| ADR-17 | 认证 | 自托管 Better Auth（数据库会话 + organization 插件）；原「自建 bcrypt + jose HS256 + `token_version`」被 [0007](./0007-self-hosted-better-auth.md) 取代 | 双向门 | [0007](./0007-self-hosted-better-auth.md) |
| ADR-18 | 部署 | Vercel + Neon；本地 Docker 只跑 PostgreSQL | 双向门 | — |
| ADR-19 | 数据库驱动 | 本地 `postgres.js`；生产 `pg` + `attachDatabasePool` | 双向门 | — |
| ADR-20 | 公开 ID | `slug` / `ref` 为 20 位随机 ID，服务端生成、不可修改 | 单向门 | — |
| ADR-21 | 前端数据与状态 | TanStack Query 管服务端缓存，Zustand 仅管 UI 状态 | 双向门 | — |
| ADR-22 | 依赖与 ORM | 依赖只减不增；ORM 升级只走专门 PR，1.0 单独立项 | 双向门 | [0009](./0009-dependency-and-runtime-stance.md) |
| ADR-23 | 运行时边界 | 零**常驻进程**；队列只在"用户等得起、产线等不起"的需求下破例（含 M3 排版） | 双向门 | [0009](./0009-dependency-and-runtime-stance.md) |
| ADR-24 | 约束执行 | 架构规则必须有执行者（lint / 迁移 / 部署自检 / 测试 / CI），否则视为未决策 | 双向门 | [0009](./0009-dependency-and-runtime-stance.md) |
| ADR-25 | TypeScript 编译器开关 | 只开 4 条实测 0 报错的检查；贵开关全部拒绝并留下报错数 | 双向门 | [0012](./0012-typescript7-compiler-flags.md) |
| ADR-26 | 首屏数据来源 | RSC `dehydrate` 是唯一首屏来源；hook 不得用 `refetchOnMount` 作废它。P1-8/P1-9 判为「前提不存在」 | 双向门 | [0013](./0013-next-react-runtime-layer.md) |

**单向门的含义**：不是「不能改」，而是「改的时候要付数据迁移或全量重排的代价」。这类决策一旦有真实客户数据，讨论成本会上升一个数量级，所以**在有数据之前**就要想清楚。

---

## 2. 正式 ADR

只有「有争议、有代价、可能被推翻」的决策才写正式 ADR。其余 15 条留在上表即可。

| ADR | 主题 | 为什么值得单独写 |
|---|---|---|
| [0001](./0001-foundation-reset.md) | 基础层重置（UUIDv7 / `auth.users` / RLS / 4 角色） | 已有，记录了一次不可逆的重置 |
| [0002](./0002-no-edit-lock.md) | 不做编辑锁，接受 last-write-wins | 直接导致用户数据丢失，是最可能被推翻的决策 |
| [0003](./0003-tree-storage-ltree.md) | 树存储用邻接表 + `ltree`，且严格父系 | 决定了过继 / 兼祧 / 入赘不可表达；M3 排版会固化它 |
| [0004](./0004-soft-delete-forever.md) | 软删永存，无回收站 | 与数据删除权存在张力，需要写清边界 |
| [0005](./0005-zero-background-jobs.md) | 零后台任务 | 会被第一个清理需求打破，需要写清破例条件 |
| [0006](./0006-rls-isolation.md) | RLS 三层隔离，组织不入 JWT | 全系统最重要的安全假设；租户写权限由 `auth_service` 承担，运行期不依赖迁移角色 `BYPASSRLS` |
| [0007](./0007-self-hosted-better-auth.md) | 自托管 Better Auth + Neon PostgreSQL | 替换自建认证与邀请；引入 `auth_service` 角色边界与数据库会话 |
| [0008](./0008-read-only-route-handlers.md) | 保留只读 Route Handler | 读缓存、预取与路由级可观测；写仍只走 Server Action |
| [0009](./0009-dependency-and-runtime-stance.md) | 依赖与运行时立场（依赖只减不增 / 钉死 ORM 版本 / 约束必须有执行者 / 零常驻进程） | 决策地图此前缺这一类；`drizzle-orm` 1.0 与 M3 排版都依赖它 |
| [0010](./0010-rich-text-editor-selection.md) | 富文本编辑器选 TipTap，正文存 ProseMirror JSON；编辑器**尚未安装** | 闭合 D-9；ADR-12 定了格式却没定引擎，而 TipTap 的传递依赖现在没有消费者 |
| [0011](./0011-search-boundary-node-client-article-trgm.md) | 检索边界：人丁搜索在客户端，trigram 只给谱文 | 取代 ADR-13 的一行结论；删掉零消费者的 `idx_node_search`，边界由集成测试守住 |
| [0012](./0012-typescript7-compiler-flags.md) | TypeScript 7 编译器开关：只开实测 0 报错的 4 条，其余全部拒绝 | 推翻了一个从未实测的假设（检查冷跑仅 1.36s，无性能问题）；并记录 `strict` 删不得的框架陷阱——Next 会在键缺失时写回 `strict: false` |
| [0013](./0013-next-react-runtime-layer.md) | 首屏只查一遍：RSC `dehydrate` 为唯一来源，`refetchOnMount:'always'` 移除 | 实测出控制台每次硬加载重复打 `/api/user` + `/api/orgs`；同时把 P1-8（整树失效）与 P1-9（营销页静态化）判为「前提不存在」——21 条路由全动态、零预渲染 |

### ADR 模板

新增 ADR 时复制以下结构。编号连续，**不修改已接受的 ADR 正文**——决策变了就新写一篇，把旧的标为「被 NNNN 取代」。

```markdown
# NNNN. 标题

- **状态**：提议 / 已接受 / 被 NNNN 取代
- **日期**：YYYY-MM-DD
- **可逆性**：单向门 / 双向门

## 背景
当时的约束是什么？是什么问题逼出了这个决策？

## 决策
做了什么。用陈述句，不用「可能」「建议」。

## 后果
### 正面
### 负面（必须诚实写，这是 ADR 的价值所在）
### 中性

## 放弃的方案
每个方案一句「为什么不够好」。

## 重估触发条件
出现什么信号时应该重新讨论这个决策。
```

---

## 待决策

以下问题在文档内部存在两种说法或明确空白，尚未形成决策。决策后转为 ADR，并从本表移除；`08-evolution` 只链接本表。

已解决：

- D-1 / D-3 → ADR-01（`lib/<domain>` 垂直切片）
- D-2 → [ADR 0008](./0008-read-only-route-handlers.md)
- D-5 → `01-drivers` G3 改为“≤5 个源文件 + 1 个迁移 + 1 处状态更新”
- D-7 → `api.md` 采用 `ActionState`（定义在 `lib/auth/types.ts`）
- D-8（依赖与运行时立场）→ [ADR 0009](./0009-dependency-and-runtime-stance.md)
- D-9（富文本选型）→ [ADR 0010](./0010-rich-text-editor-selection.md)

| # | 问题 | 两种说法 |
|---|---|---|
| D-4 | 关系模型 | 单 `parent_id` 无法表达过继 / 兼祧 / 入赘 |
| D-6 | 数据生命周期 | 软删永存 vs 删除权与保留期 |
| D-10 | 表单栈 | `04-runtime §6.2` 写 React Hook Form，`package.json` 没有；扁平表单模型挡住自定义字段与编目树（评审 S1-2） |
| D-11 | 登录限流 | 进程内 Map（best-effort）vs 共享存储（多实例生效）；key 部分来自可伪造的 `x-forwarded-for`（评审 S1-3） |
