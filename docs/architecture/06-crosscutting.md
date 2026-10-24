# 横切关注点

> **回答什么问题**：配置怎么管？错误怎么表达？日志怎么写？安全靠什么？怎么观测？
> **读者**：开发 · 运维　**长度上限**：4 页
> **来源**：原 `architect.md` §9（编号保持不变）
> **目标 vs 现状**：本文描述目标架构。差异见 [实现状态](../implementation-status.md)。

---

## 9. 横切关注点

### 9.1 配置

全部来自环境变量，启动时用 Zod 校验，缺一个就拒绝启动。

实现见 `lib/config.ts`；环境变量表见 [部署蓝图 §3](../ops-target.md#3-目标环境变量)。约定：业务代码不直接读 `process.env`，当前靠评审（Biome 规则未配置）。

> **现状**：`lib/config.ts` 用 `getServerConfig()` 惰性校验，由 `instrumentation.ts` 在启动时触发；`POSTGRES_URL_DIRECT` / `POSTGRES_URL_NON_POOLING` 只在迁移脚本中读取，不在运行时 schema 内。本地与 CI 可省略 `APP_POSTGRES_URL` / `AUTH_POSTGRES_URL`（回退到 `POSTGRES_URL`），Vercel 生产环境必须提供两者。认证连接必须使用 direct endpoint：配置校验会拒绝主机名含 `-pooler.` 的 `AUTH_POSTGRES_URL`（或回退的 `POSTGRES_URL`）。`LOG_LEVEL` 为可选。

### 9.2 错误

类型化错误层级 + 双序列化出口：

| 出口 | 格式 | 用于 |
|---|---|---|
| Server Action | `ActionState` | 全部写操作 |
| Route Handler | `{ error, code? }` | 业务路由 401/403/404 |
| Route Handler | `{ status, database }` | `/api/health` 503 |

Server Action 不 throw：throw 会被框架转成 500 错误页，UI 无法区分「同名冲突」和「校验失败」。详见 [api §4](../api.md#4-错误模型)。

> **一个副作用需要显式记录**：所有写错误都以 HTTP 200 + `{ ok: false }` 返回。这个设计对 UI 是正确的，但它意味着**服务端错误率恒为 0%**——APM、网关、Vercel 的 5xx 统计都看不到业务失败。因此 `prd.md` §8 的「保存失败率 < 0.1%」只能靠两种方式测量：① 服务端按 `error.code` 打点 ② 客户端上报。若两者都不做，这个成功指标就是空的。

### 9.3 日志

结构化 JSON，每条带 `request_id`、`organization_id`、`user_id`。

| 级别 | 用途 |
|---|---|
| `error` | 需要人工介入（未预期异常、外部服务失败） |
| `warn` | 可预期但值得关注（校验失败、引用冲突、权限不足） |
| `info` | 关键业务动作（组织创建、成员变更） |
| `debug` | 仅开发环境 |

**禁止 `console.log`**，Biome 规则拦截。M1 不建审计表；结构化日志是唯一的运维追溯来源，关键业务动作写 `info`。

### 9.4 安全

| 项 | 措施 |
|---|---|
| 认证 | 自托管 Better Auth：邮箱 + 密码，scrypt 哈希由 Better Auth 管理；不暴露 `/api/auth/*` |
| 会话 | 数据库会话，Cookie `better-auth.session_token`（HttpOnly + Secure + SameSite=Lax）；7 天过期、`updateAge` 1 天；`getSessionUser()` 调 `auth.api.getSession` 查库；`proxy.ts` 只做 Cookie 存在性门禁 |
| 密码变更 | 验证旧密码 → `auth.api.changePassword({ revokeOtherSessions: true })` → 当前会话保留，其他设备立即失效 |
| 租户隔离 | 业务查询走 `APP_POSTGRES_URL`（`app` → `withOrg` 内 `SET LOCAL ROLE app_rw`，可 pooled）；认证与组织/成员/邀请写走 `AUTH_POSTGRES_URL`（`auth_runtime` → direct 连接固定 `auth_service`） |
| CSRF | Server Action 自带 Origin 校验；Route Handler 全部是只读 GET |
| 输入校验 | 所有 Action 入口 Zod，不信任客户端 |
| 越权 | RLS + `hasPermission` + 复合外键 |
| 登录防护 | 进程内滑窗限流（同一来源 + 账号），统一错误文案防账号枚举；不做持久化账号锁定 |
| 密钥 | `BETTER_AUTH_SECRET`（≥ 32 字节）只在服务端环境变量，永不进客户端 |
| 软删数据 | 界面不可见，但库内保留；运维恢复需工单 |

M2 引入分享页时，必须补「在世人口脱敏在服务端完成」这一条。

> **三处需要补充的安全设计**（详见 [08-evolution](./08-evolution.md) 风险登记簿）：
> 1. **限流的 key 可信性**：`x-forwarded-for` 可伪造。应只信任平台注入的头，并对账号维度独立计数。
> 2. **密钥轮换**：`BETTER_AUTH_SECRET` 是全局对称密钥，轮换会使现有会话 Cookie 失效（等价全量登出）。Better Auth 不提供双密钥过渡，只能轮换后按需批量删除 `auth.session`；见 [R20](./08-evolution.md) 与 [RB-4](../guides/runbooks.md)。
> 3. **慢查询护栏**：迁移 `0006_statement_timeouts` 已为 `app_rw` 设置 `statement_timeout=10s` / `idle_in_transaction_session_timeout=30s` / `lock_timeout=5s`，为 `auth_service` 设置前两项；`verify:deploy` 尚未断言 `rolconfig`（评审 P1-11 的验收项）。

### 9.5 可观测性

| 项 | 方案 |
|---|---|
| 错误聚合 | 无外部服务；未预期异常写 `error` 级结构化日志，带 `request_id`，由 Vercel 日志收集 |
| 性能 | Vercel 日志可检索但不支持聚合；p95 需要导出到外部存储或错误聚合服务。当前只有 `duration_ms` 原始日志，p95 未聚合（见 R19） |
| 业务指标 | 关键动作写结构化日志，不建独立埋点表与审计表 |
| 存活探针 | `GET /api/health`，检查数据库连通性 |

> **99.5% 目前不可测量**：`prd.md` §7 承诺月度可用率 ≥ 99.5%（每月约 3.6 小时停机预算），但 Vercel 日志有保留期、不支持聚合查询、不能告警，且没有外部探针服务。指标存在而测量手段不存在，等于没有承诺。
>
> 达到 99.5% 可测量的最小集合：错误聚合（异常与 `error.code` 上报）+ 一条外部探针（5 分钟）+ 三条 SLO（可用性 / 保存 p95 / 错误率）。成本约 1–2 天，见 [08-evolution](./08-evolution.md) 风险 R19。
