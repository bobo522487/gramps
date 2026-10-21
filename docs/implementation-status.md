# 实现状态

> **文档状态：当前实现说明** · 最后更新：2026-10-21
> 目标定义来自 [PRD](./prd.md)、[架构](./architect.md)、[数据模型](./data-model.md)、[接口](./api.md)。
> 本文件只描述**代码里真实存在什么**，不描述计划。

| 项 | 值 |
|---|---|
| 文档版本 | 1.6 |
| 文档状态 | 当前实现说明 |
| 最后更新 | 2026-10-21 |
| 目标部署（未实现） | Vercel + 自定义域名 + Neon PostgreSQL 18+；生产驱动 `pg` + `attachDatabasePool`，本地 `postgres.js`；本地 Docker 只跑 PostgreSQL + `next dev` |

---

## 1. 当前实现基线

| 项 | 值 | 证据 |
|---|---|---|
| 框架 | Next.js 16.4.0、React 19.1.0 | `package.json` |
| 语言 | TypeScript `strict: true` | `tsconfig.json` |
| 数据库 | PostgreSQL + Drizzle 0.43 + postgres.js | `lib/db/drizzle.ts`、`lib/db/schema.ts` |
| 认证 | 邮箱 + 密码，bcrypt，JWT HS256 | `lib/auth/session.ts` |
| 会话 | `session` Cookie，1 天有效；剩余 < 6 小时时由 `proxy.ts` 滑动续期 | `lib/auth/session.ts`、`proxy.ts` |
| 会话撤销 | 校验 `users.token_version` 与 `deleted_at` | `lib/db/queries.ts` `getUser()` |
| 角色 | `owner` / `member` | `lib/auth/permissions.ts` |
| 数据隔离 | 应用层成员校验；无 RLS | `lib/auth/permissions.ts`、`lib/db/queries.ts` |
| 界面 | 简体中文，品牌“云谱”；无 i18n 框架 | `app/layout.tsx`、各页面组件 |
| 数据表 | 6 张 | 见 §1.1 |
| Route Handler | 3 个 | 见 §1.3 |
| 代码检查 | Biome | `biome.json`、`package.json` |
| 测试 | Vitest 单测 6 个文件 + 真实 PostgreSQL 集成测试 4 个文件（另有 1 个 stub）；无 Playwright/E2E | `tests/` |
| CI | `pnpm check` → `typecheck` → `test:unit` → `test:integration`（`postgres:18`）→ 迁移漂移检查 → `build` | `.github/workflows/ci.yml` |

### 1.1 当前数据表

`users`、`organizations`、`org_members`、`projects`、`activity_logs`、`invitations`。

没有：`api_keys`（已移除）、`lineage`、`node`、`article`、`book`、`book_catalog`、`folder`、`invite`（目标模型的表名）。目标设计不建审计表与登录尝试表。

### 1.2 公开 ID 与控制台路由

- `organizations.slug` 与 `projects.ref` 是 20 位 `[0-9a-z]` 公开 ID，由 `lib/ids.ts` 生成，各自有全局唯一索引；数字 `serial` 主键继续作为内部外键。
- 目标设计文档自 2026-10-21 起采用同一规范：`organization.slug` 与 `project.ref` 都是 20 位随机公开 ID，服务端生成且不可修改；URL 标识符不再存在当前/目标差异。
- 控制台地址：`/dashboard/org/[orgSlug]`（Projects / Team / Org settings）与 `/dashboard/project/[projectRef]`（Overview / Lineages / Articles / Books / Project settings）。
- `getOrgWithRoleBySlug(userId, slug)`、`getProjectScopeByRef(userId, ref)` 在解析 URL 时同时按当前用户过滤；非成员或不存在的公开 ID 返回 404。
- 迁移为两阶段：`0003` 增加可空列并删除 `api_keys`，随后在迁移之外执行 `pnpm db:backfill-ids` 回填，最后 `0004` 设置 `NOT NULL` 与唯一索引。迁移文件本身不含数据修复。
- `0005_remove_billing_and_tier` 删除 `organizations` 的 5 个 Stripe 字段与 `projects.tier`；`0000`–`0004` 作为历史迁移保持原样。

### 1.3 当前 Route Handler

- `GET /api/orgs`
- `GET /api/orgs/[orgId]/projects`
- `GET /api/user`（DTO 仅为 `{ id, name, email }`）

没有 `/api/health`，也没有 Stripe 相关路由。

### 1.4 测试与 CI

- `pnpm test:unit`（`pnpm test`）：6 个 Vitest 文件，不连接数据库。
- `pnpm test:integration`：4 个文件，连接名称以 `_test` 结尾的独立 PostgreSQL；`globalSetup` 从空库执行全部迁移，每个测试文件开始前清空业务表。
- CI 使用 `postgres:18-alpine` service，执行迁移漂移检查（`pnpm db:generate` 后迁移目录必须无变化），最后构建。
- 尚无 Playwright/E2E。`tests/security-regressions.test.ts` 与 `tests/design-system.test.ts` 仍包含源码字符串断言，但会话撤销、公开 ID 成员过滤、跨组织读写与数据库唯一约束已由集成测试覆盖。

---

## 2. 模块状态

状态含义：✅ 已实现；🟡 部分实现或语义不同；⬜ 未实现；➕ 目标外已有。

| 模块 | 目标（PRD） | 当前实现 | 状态 |
|---|---|---|---|
| 认证 | 即时登录（无邮件确认）、JWT 会话 + `token_version`、改密、进程内限流、4 角色 | 注册/登录/登出、改密、删号、内存限流 | 🟡 部分 |
| 组织与成员 | 默认组织（触发器）、邀请链接 7 天、角色管理、组织停用 | 默认组织（应用层）、多组织、公开 ID 与目标一致、邀请记录、移除成员、改名 | 🟡 部分 |
| 云谱空间 | 谱系/谱文/谱书三棵分类树 | 部署型 project（region/status/health）+ 20 位 ref（与目标一致）+ 谱系/谱文/谱书占位页；无分类 | 🟡 语义不同 |
| 谱系与人丁 | `FR-LIN-1` ~ `FR-LIN-13` | 无表、无页面、无 Action | ⬜ 未实现 |
| 谱文 | `FR-ART-1` ~ `FR-ART-5` | 无 | ⬜ 未实现 |
| 谱书与编目 | `FR-BOOK-1` ~ `FR-BOOK-8` | 无 | ⬜ 未实现 |
| 审计 / 活动记录 | 目标设计不建审计表；关键动作写结构化日志 | 可变的 `activity_logs` | ➕ 目标外已有 |
| 界面语言 | 简体中文 | 全站中文，品牌“云谱”；无 i18n 框架 | ✅ |
| 工程工具链 | Biome + Vitest + Playwright E2E | Biome + Vitest（单测 + 真实 PostgreSQL 集成测试），无 E2E | 🟡 部分 |

---

## 3. 关键 FR 差异

只列会被误判为“已实现”的项。未列出的 `FR-LIN-*`、`FR-ART-*`、`FR-BOOK-*` 全部为 ⬜。

### 3.1 认证

| FR | 状态 | 当前行为 / 差异 |
|---|---|---|
| `FR-AUTH-1` 邮箱密码注册 | 🟡 | 注册可用，注册后直接登录（与目标的“无邮件确认”一致）；密码只校验长度 8–100，不要求字母 + 数字 |
| `FR-AUTH-2` 邮箱密码登录 | ✅ | 登录路径与目标一致 |
| `FR-AUTH-3` 会话保持 | ✅ | JWT Cookie 1 天有效，`proxy.ts` 在剩余 < 6 小时时滑动续期；`getUser()` 校验 `token_version` 与 `deleted_at` |
| `FR-AUTH-4` 登出 | ✅ | 删除当前 `session` Cookie；其它设备会话不受影响 |
| `FR-AUTH-5` 登录失败限流 | ✅ | 登录 10 次/15 分钟（IP + 邮箱）的进程内滑窗；重启清零、多实例不共享，与目标的 best-effort 语义一致 |
| `FR-AUTH-6` 修改密码 | 🟡 | 登录态可改密，验证旧密码并递增 `token_version`；但当前设备也不会重签，所有会话失效后需重新登录，与目标“当前设备保持登录”有差异 |

额外已有：修改密码、删除账号、账号安全页、活动日志。

### 3.2 组织与成员

| FR | 状态 | 当前行为 / 差异 |
|---|---|---|
| `FR-ORG-1` 注册即得默认组织 | 🟡 | 注册后由应用层创建默认组织并加入 `owner`；不是数据库触发器，也不是单事务 |
| `FR-ORG-2` 新建额外组织 | 🟡 | 可创建组织；slug 由服务端生成（20 位 `[0-9a-z]`，与目标一致）；建组织与 owner 成员关系不在同一事务 |
| `FR-ORG-3` 多组织切换 | ✅ | 一个账号可属于多个组织，控制台顶部提供组织切换 |
| `FR-ORG-4` 邀请成员 | 🟡 | 有邀请记录与接受逻辑；没有一次性 token、过期时间或可复制的邀请链接 |
| `FR-ORG-5` 修改成员角色 | ⬜ | 没有改角色、转让所有权；角色只有 owner/member |
| `FR-ORG-6` 移除成员 | ✅ | owner 可移除成员；未实现“最后一个 owner 不可移除”的保护 |
| `FR-ORG-7` 组织设置 | 🟡 | 改名仅 owner（服务端校验）；slug 不可修改，与目标一致；设置页对非 owner 未隐藏操作入口 |
| `FR-ORG-8` 组织停用 | ⬜ | `organizations` 表没有 `status` 字段 |

额外已有：删除组织（硬删除，级联项目）。

### 3.3 云谱空间

| FR | 状态 | 当前行为 / 差异 |
|---|---|---|
| `FR-PROJ-1` 创建云谱空间 | 🟡 | 字段是 `name`、`region`，不是姓氏、郡望、地区；20 位 `ref` 由服务端生成且用于 URL，与目标一致；可读 slug 是当前实现额外字段 |
| `FR-PROJ-2` 多个云谱空间 | ✅ | 一个组织可建多个 project |
| `FR-PROJ-3` 分类管理 | ⬜ | 没有 `folder` 表，也没有三棵树；谱系/谱文/谱书只有占位页 |

额外已有：项目状态（ACTIVE/PAUSED/ARCHIVED）、健康状态。

---

## 4. 目标外已有能力

这些功能在代码中存在，但 PRD 明确不在 M1 范围，或没有在目标设计中定义：

- 账号安全页（改密、删号）与活动日志页。
- 营销页 `/`（`/pricing` 已随支付能力一并删除）。
- 控制台 UI 设计令牌、组织/项目两套侧边栏、顶部组织/项目选择器、成员面板。

---

## 5. 已知实现风险（记录，不在文档 P0 修复）

1. **注册默认组织非原子**：`createUser → createOrg → addOrgMember` 分多步执行；中途失败会留下无组织用户，与目标设计的“触发器保证原子性”不同。
2. **邀请缺少 token / 过期 / 可复制链接**：`invitations` 表只有 `status`，没有 `token_hash`、`expires_at`。目标设计不要求邮件，但要求一次性链接，当前尚未实现。
3. **限流是进程内内存实现**：重启清零，多实例不共享；目标设计接受这一 best-effort 限制，不把它当作安全边界。
4. **没有最后一个 owner 保护**：移除成员或删除组织时，可能产生无 owner 组织。
5. **组织删除是硬删除**：会级联删除项目；没有目标设计中的软删/回收站。
6. **没有 RLS**：隔离依赖应用层 `orgId` 校验；所有新增查询都必须带组织条件。
7. **无自助密码找回**：目标设计与当前实现都没有邮件通道；忘记密码只能由运维人工重置。
8. **改密会登出当前设备**：`updatePassword` 递增 `token_version` 后不重签当前 Cookie，与目标“当前设备保持登录”不一致。
9. **目标设计不建审计表**：关键动作只写结构化日志；日志保留期外的逐条追溯依赖软删与 PITR/备份，无法回答细粒度“谁改了什么”。

> `getUser()` 仍返回完整 `users` 行；`GET /api/user` 与根布局 SWR fallback 已收窄为 `SessionUser`（`{ id, name, email }`）。新增对外出口必须显式挑字段，不能直接序列化整行。

---

## 6. 路线决策（2026-10-21）

| # | 决策 |
|---|---|
| D1/D2 | 目标为家谱 M1；按当前仓库状态（无生产部署证据）采用基础层重置，Phase 3 前确认；若已有生产数据则改走扩展-收缩 |
| D3 | UUIDv7 在创建家谱表之前一次性替换 `serial` |
| D4 | 新家谱表从第一天启用 RLS；先补齐 `organization_member` 策略缺口 |
| D5 | 先落权限字符串矩阵，再扩到 4 个角色 |
| D6 | 修改邮箱要求当前密码 |
| D7 | 保留 `activity_logs` 作为产品活动流并修复多组织归属；不把它当审计表 |
| D8 | M1 过渡期保留 3 个内部只读 API，补 401 与契约文档；选择器改用 RSC fallback 后再收敛 |
| D9 | 邀请使用一次性 token + 7 天过期，禁止邀请 owner |

## 7. 更新规则

- 合并涉及家谱目标功能的 PR 时，更新本文件对应模块与 FR 行。
- 新增/删除表、Action、Route Handler 时，同步更新 [README](./README.md) 的“当前仓库速览”和本文件 §1。
- 只有代码、迁移、测试都落地后，状态才能从 🟡/⬜ 改为 ✅。
- 本文件不记录“计划做什么”；计划写在 PRD、架构文档或 issue 里。
