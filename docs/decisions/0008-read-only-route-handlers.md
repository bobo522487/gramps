# 0008. 保留只读 Route Handler 作为工作区刷新通道

- **状态**：已接受
- **日期**：2026-10-24
- **可逆性**：双向门
- **相关**：[01-架构总览](../architecture/01-架构总览.md) · [03-逻辑视图-模块设计](../architecture/03-逻辑视图-模块设计.md) · [07-运行视图-关键流程](../architecture/07-运行视图-关键流程.md) · [api §1](../api.md) · [ADR 0007](./0007-self-hosted-better-auth.md)

## 背景

当前 3 个工作区读端点 + `/api/health` 都是只读 GET。原目标要求“读收敛为 Server Action”，理由是减少 Route Handler 数量。但 Server Action 本质是 POST：不可缓存、不可预取，Next 会串行化，且按路由聚合 p95 失去意义。ADR 0007 已记录“现有 4 个只读 Route Handler 不变”。

## 决策

保留 4 个只读 Route Handler：`/api/health`、`/api/orgs`、`/api/orgs/[orgId]/projects`、`/api/user`。工作区需要新的客户端刷新读时，可以新增只读 GET Handler。写操作仍只走 Server Action；不新增 `/api/auth/*`。

## 后果

### 正面

- 读请求可缓存、可预取、按路由观测。
- 写入口保持单一（Server Action），不把认证/租户写暴露成 HTTP 端点。

### 负面

- 每个端点要自己处理 401、参数校验、成员校验与 DTO。
- 多一份只读契约要维护；用显式 DTO，不返回整行记录。

### 中性

- “Route Handler 只有 1 个”不再是目标；数量由真实读需求决定。

## 放弃的方案

| 方案 | 为什么不够好 |
|---|---|
| 读也走 Server Action | POST 不可缓存/预取，Next 串行化，路由级 p95 失真 |
| tRPC / GraphQL / 公开 REST | 没有外部消费者；多维护一份契约，收益为零 |

## 重估触发条件

- TanStack Query 被移除，客户端只依赖 RSC；
- Next 提供与 GET 等价的 RSC 刷新/缓存语义；
- 出现第三方消费者，需要正式的公开 API 契约。
