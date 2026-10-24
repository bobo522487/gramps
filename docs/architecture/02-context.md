# 系统上下文与部署

> **回答什么问题**：系统边界在哪？谁跟它交互？部署成什么样？本地和生产有什么差别？
> **读者**：开发 · 运维　**长度上限**：3 页
> **来源**：原 `architect.md` §2 · §3 · §10（编号保持不变）
> **目标 vs 现状**：本文描述目标架构。差异见 [实现状态](../implementation-status.md)。

---

## 2. 系统上下文

```
                    ┌──────────────────────────┐
                    │   谱系编纂 SaaS（本系统）  │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
        ┌─────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
        │  编纂者    │     │   Vercel    │    │  运维        │
        │ (浏览器)   │     │ Next.js +   │    │ (日志/探针)  │
        └───────────┘     │ 自定义域名   │    └─────────────┘
                          └──────┬──────┘
                                 │ pg.Pool + attachDatabasePool（Neon pooled）
                          ┌──────▼──────┐
                          │    Neon     │
                          │ PostgreSQL  │
                          │    18+      │
                          └─────────────┘
```

| 外部角色 | 交互方式 | 说明 |
|---|---|---|
| 编纂者 | 浏览器，登录后使用 | 修谱工作室成员或家族内部人员 |
| Vercel | HTTPS + 托管 Next.js | 应用运行、TLS、自定义域名、CDN |
| Neon | `pg` 连接池 + `attachDatabasePool` | 托管 PostgreSQL 18+；11 张组织级业务表 + 4 张 `auth.*` 表 |
| 运维 | Vercel / Neon 日志、`GET /api/health` | 无外部监控服务；故障排查靠结构化日志与探针 |

公开页面只有营销首页、登录/注册；没有匿名业务数据页、分享页或公开 API。M2 引入分享后才出现“族内读者”角色。

---

## 3. 部署视图

```
┌───────────────────────────────────────────────────────────────┐
│ 浏览器                                                         │
│  React 19 客户端组件（画布、编辑器、表单）                        │
└───────────────────────────┬───────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼───────────────────────────────────┐
│ Vercel（Next.js 运行时，多实例无状态）                            │
│                                                               │
│  Next.js 16 App Router                                        │
│   ├─ RSC            读操作，服务端直出                          │
│   ├─ Server Action  写操作                                      │
│   └─ Route Handler  4 个：/api/health + 3 个只读刷新                │
│                                                               │
│  业务域（见 03-components）                                      │
│  认证：自托管 Better Auth（数据库会话 + scrypt，进程内）          │
│  查询层（Drizzle；业务 app_rw / 认证 auth_service）              │
└───────────────────────────┬───────────────────────────────────┘
                            │ pg.Pool + attachDatabasePool（业务 pooled / 认证 direct）
┌───────────────────────────▼───────────────────────────────────┐
│ Neon PostgreSQL 18+                                           │
│  ├─ public schema：11 张组织级业务表（全部强制 RLS）               │
│  └─ auth schema：users/session/account/verification（auth_service）│
└───────────────────────────────────────────────────────────────┘
```

本地开发时，数据库由 Docker 提供，Next.js 用 `next dev` 在宿主机运行；Vercel 与 Neon 只用于生产。

### 3.1 运行时清单

| 运行时 | 技术 | 职责 | 伸缩 |
|---|---|---|---|
| Web 应用 | Vercel（Next.js 16 / Node 22） | 全部业务逻辑、页面渲染、认证与会话 | 自动水平扩 |
| 数据库 | Neon PostgreSQL 18+ | 数据存储、RLS 隔离、`auth` schema | 托管 |

### 3.2 关键形态决策

| 决策 | 结论 | 依据 |
|---|---|---|
| 进程数 | **Vercel Functions 多实例，无状态** | 所有工作在单次请求内完成 |
| 后台任务 | **0 个** | 邀请过期由查询时判断；软删无清理任务；无异步需求 |
| 消息队列 | **无** | 没有消费者 |
| 缓存层 | **无**（M1） | Next.js 自带 RSC 缓存足够；触发条件见 [08-evolution §12.1](./08-evolution.md) |
| 数据库连接 | **业务走 Neon pooled endpoint；认证走 direct endpoint；生产 `pg.Pool` 每实例 max = 1–5** | serverless 多实例下避免连接数爆炸；认证连接用启动参数固定 `auth_service`，pooler 不支持该参数 |
| 数据库驱动 | 本地 `postgres.js`；生产 `pg` + `@vercel/functions` 的 `attachDatabasePool` | 本地轻量、API 简洁；生产按 Vercel 官方方式管理连接生命周期 |
| 迁移/备份 | 使用 Neon direct 连接 `POSTGRES_URL_DIRECT` | 长事务与 `pg_dump` 不占应用连接池 |
| 认证 | **应用运行时内（自托管 Better Auth）** | 数据库会话 + scrypt；认证连接固定 `auth_service`，不依赖外部 IdP |
| 对外接口 | **4 个只读 Route Handler** | 1 个健康检查 + 3 个工作区刷新；写只走 Server Action（[ADR 0008](../decisions/0008-read-only-route-handlers.md)） |

---

## 10. 部署拓扑

```
            ┌──────────────────────────┐
  用户 ────▶│  Vercel                  │  自定义域名、TLS、CDN
            │  Next.js + /api/health   │  多实例无状态
            └────────────┬─────────────┘
                         │ pg.Pool + attachDatabasePool（业务 pooled / 认证 direct）
                         ▼
            ┌──────────────────────────┐
            │  Neon PostgreSQL 18+     │  托管，与函数同区域
            └──────────────────────────┘
```

| 项 | 配置 |
|---|---|
| 应用实例 | Vercel Functions，按请求伸缩 |
| 部署方式 | Git push → Vercel 构建部署；支持即时回滚到上一版本 |
| 域名 | Vercel 自定义域名 + 自动 TLS；`BASE_URL` 使用正式域名 |
| 静态资源 | Vercel CDN，`/_next/static` 长缓存 |
| 数据库 | Neon PostgreSQL 18+（PITR / 分支） |
| 备份 | Neon PITR；另可 `pg_dump --schema=public --schema=auth --schema=drizzle` 导出 |
| 本地开发 | Docker 只跑 PostgreSQL，应用用 `next dev` |

> **环境缺口（已知）**：目标只有「本地 + 生产」两套环境，没有 staging 或 PR preview 环境。这导致生产形态的三个假设（`pg.Pool` + `attachDatabasePool` 的连接生命周期、非属主 `app` 角色下 `FORCE RLS` 的兜底、pooled/direct 双 URL 分离）从未在真实环境验证。建议补一套 Vercel Preview + Neon 分支，见 [08-evolution](./08-evolution.md) 风险 R16。
