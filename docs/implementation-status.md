# 实现状态

> **文档状态：当前实现说明** · 最后更新：2026-10-22
> 目标定义来自 [PRD](./prd.md)、[架构](./architect.md)、[数据模型](./data-model.md)、[接口](./api.md)。
> 本文件只描述**代码里真实存在什么**，不描述计划。

| 项 | 值 |
|---|---|
| 文档版本 | 2.0 |
| 文档状态 | 当前实现说明 |
| 最后更新 | 2026-10-22 |
| 目标部署（未验证） | Vercel + 自定义域名 + Neon PostgreSQL 18+；生产驱动已接入（`VERCEL` 环境用 `pg` + `attachDatabasePool`），本地/CI 用 `postgres.js`；本地 Docker 只跑 PostgreSQL + `next dev` |

---

## 1. 当前实现基线

| 项 | 值 | 证据 |
|---|---|---|
| 框架 | Next.js 16.4.0、React 19.1.0 | `package.json` |
| 语言 | TypeScript `strict: true` | `tsconfig.json` |
| 数据库 | PostgreSQL 18 + Drizzle 0.43；本地/CI `postgres.js`，Vercel 环境 `pg` + `attachDatabasePool` | `lib/db/drizzle.ts`、`lib/db/schema.ts` |
| 主键 | UUIDv7（`uuidv7()`）；20 位公开 `slug`/`ref` 仅用于 URL | `lib/db/schema.ts`、`lib/ids.ts` |
| 认证 | 邮箱 + 密码，bcrypt，JWT HS256；认证数据在 `auth.users` | `lib/auth/session.ts`、`lib/db/migrations/0001_auth_rls.sql` |
| 会话 | `session` Cookie，1 天有效；剩余 < 6 小时时由 `proxy.ts` 滑动续期 | `lib/auth/session.ts`、`proxy.ts` |
| 会话撤销 | `auth.get_session_user()` 校验 `token_version` 与 `deleted_at`；`getSessionUser()` 按请求缓存 | `lib/auth/context.ts` |
| 角色 | `owner` / `admin` / `editor` / `viewer` + 9 个权限字符串 | `lib/auth/permissions.ts` |
| 数据隔离 | 应用层成员过滤 + `withOrg` 事务内 RLS（`app_rw`）+ 复合外键 | `lib/db/drizzle.ts`、`0001_auth_rls.sql` |
| 界面 | 简体中文，品牌“云谱”；无 i18n 框架 | `app/layout.tsx`、各页面组件 |
| 客户端数据 | TanStack Query 5；RSC 首屏 `dehydrate` / `HydrationBoundary` 注入，客户端 `useQuery` 调用只读 API，写后 `invalidateQueries` | `components/query-provider.tsx`、`lib/query-keys.ts`、`hooks/use-session-user.ts` |
| 谱系画布 | `@xyflow/react` 12 + zustand 5（zustand 仅存谱系工作区 UI 状态，不存实体数据） | `components/lineage/canvas/`、`components/lineage/lineage-store.ts` |
| 数据表 | 11 张组织级业务表 + `auth.users` | 见 §1.1 |
| Route Handler | 4 个 | 见 §1.3 |
| 配置与日志 | Zod 启动校验；结构化日志自动带 `request_id`/`user_id`；API 记录 `duration_ms` | `lib/config.ts`、`instrumentation.ts`、`lib/server/request-context.ts`、`lib/api.ts` |
| 代码检查 | Biome | `biome.json`、`package.json` |
| 测试 | Vitest 单测 13 个文件 73 个用例 + 真实 PostgreSQL 集成测试 11 个文件 126 个用例（另有 1 个 stub）；无 Playwright/E2E | `tests/` |
| CI | `pnpm check` → `typecheck` → `test:unit` → `test:integration`（`postgres:18`）→ 迁移漂移检查 → `build` | `.github/workflows/ci.yml` |

### 1.1 当前数据表

迁移是重置后的两个文件：`0000_baseline.sql`（Drizzle 生成）与 `0001_auth_rls.sql`（custom migration）。

| 表 | 说明 |
|---|---|
| `auth.users` | 账号、密码哈希、`token_version`、软删；`app_rw` 无表权限 |
| `organization` | 组织；`slug` 为 20 位公开 ID；`status` 为 `active/suspended/closed` |
| `organization_member` | 成员与角色；活动行 `(organization_id, user_id)` 唯一；单组织仅一个 `owner` |
| `invite` | 邀请；只存 token 哈希，7 天过期，一次性，禁止邀请 `owner` |
| `project` | 云谱空间；`ref` 为 20 位公开 ID；字段为 `primary_name`/`primary_surname`/`hall_code`/`countries_regions` |
| `folder` | 分类树（`kind` 0/1/2）；谱系分类已有 UI/Action，谱文/谱书分类待接入 |
| `lineage` / `node` | 谱系与人丁；欧式书本画布、世系表、左侧谱系管理、搜索定位、字辈提示、增删改移、检查器、按代渲染窗口已实现 |
| `article` | 谱文（表已存在，无业务 UI） |
| `book` / `book_catalog` | 谱书与编目（表已存在，无业务 UI） |
| `activity_logs` | 产品活动流；账号级事件 `organization_id` 为空；不是审计表 |

除 `activity_logs`（产品活动流）外，组织级业务表都有 `deleted_at` 软删列；没有回收站 UI。目标设计仍有 10 张业务表的口径，这里的 11 张包含 `activity_logs`。

数据库层还有：

- `app_rw`（NOLOGIN、NOBYPASSRLS、无 `auth.users` 权限、无业务表 `DELETE`）。
- `auth` schema 的 `SECURITY DEFINER` 函数：注册、登录查询、会话校验、改密、删号、邀请接受、建组织。
- 注册触发器 `handle_new_user`：创建 `auth.users` 时自动建立个人组织与 `owner` 成员关系。
- `FORCE ROW LEVEL SECURITY`：`app_rw` 以及表属主都受策略约束；迁移角色通过 `SET LOCAL ROLE app_rw` 降权后查询。
- 扩展 `ltree`、`pg_trgm`、`btree_gist`；GIN/GiST 索引已建立。

### 1.2 公开 ID 与控制台路由

- `organization.slug` 与 `project.ref` 是 20 位 `[0-9a-z]` 公开 ID，由 `lib/ids.ts` 生成，各自有唯一索引；UUIDv7 主键仅内部使用。
- 控制台地址：`/dashboard/org/[orgSlug]`（Projects / Team / Org settings）与 `/dashboard/project/[projectRef]`（Overview / Lineages / Articles / Books / Project settings）。
- `requireOrgContext(orgSlug)` / `requireProjectContext(projectRef)` 在 `lib/auth/context.ts` 中解析 URL：先取 `getSessionUser()`，再用 `getOrgWithRoleBySlug(userId, slug)` / `getProjectScopeByRef(userId, ref)` 同时按当前用户过滤；非成员或不存在的公开 ID 返回 404。两个 helper 与 `getSessionUser` 都用 React `cache()` 做请求级记忆化。
- 邀请链接指向 `/sign-up?invite=<token>`；已登录用户从 `/dashboard/join?token=<token>` 接受邀请。
- 迁移重置策略、数据与 URL 的取舍见 [ADR 0001](./adr/0001-foundation-reset.md)。

### 1.3 当前 Route Handler

- `GET /api/health`（数据库 `SELECT 1`；正常 200、不可用 503）
- `GET /api/orgs`
- `GET /api/orgs/[orgId]/projects`
- `GET /api/user`（DTO 仅为 `{ id, name, email }`）

三个业务路由未登录时都返回 `401 { error: 'Unauthorized' }`；组织级项目列表先校验成员，非成员返回 403，`orgId` 不是合法 UUID 时返回 404；项目 DTO 为 `{ id, name, ref }`。客户端 `lib/fetcher.ts` 对非 2xx 响应抛错，错误对象带 `status`。所有路由通过 `withApiLogging()` 导出：生成或透传 `x-request-id`，记录 `duration_ms`，未捕获异常返回 JSON 500。

### 1.4 测试与 CI

- `pnpm test:unit`（`pnpm test`）：13 个 Vitest 文件 73 个用例，不连接数据库。
- `pnpm test:integration`：11 个文件 126 个用例，连接名称以 `_test` 结尾的独立 PostgreSQL；`globalSetup` 先丢弃旧 schema/扩展，再从空库执行全部迁移；每个测试用例开始前清空业务表。
- 集成测试覆盖：迁移结构/RLS/授权、约束、公开 ID 成员过滤、RLS 无 claims 与跨组织拒绝、注册/邀请/建组织/成员变更/删号事务、Server Action 行为、API 契约、项目 `ref` 冲突重试、健康检查、分类/谱系/人丁树语义（四种录入模式、同录配偶与详情、移动子树、软删、始祖删除保护、`node_count`、搜索）。
- 单元测试覆盖配置、请求上下文、权限矩阵、会话、ID、限流、fetcher、设计系统、书本布局/折叠/懒渲染窗口、谱系索引与搜索匹配、侧栏树、zustand 工作区 store、人丁创建 schema。
- CI 使用 `postgres:18-alpine` service，执行迁移漂移检查（`pnpm db:generate` 后迁移目录必须无变化），最后构建。
- 尚无 Playwright/E2E。`tests/security-regressions.test.ts` 与 `tests/design-system.test.ts` 仍保留源码字符串断言，但关键安全与数据完整性行为已由集成测试覆盖。

---

## 2. 模块状态

状态含义：✅ 已实现；🟡 部分实现或语义不同；⬜ 未实现；➕ 目标外已有。

| 模块 | 目标（PRD） | 当前实现 | 状态 |
|---|---|---|---|
| 认证 | 即时登录（无邮件确认）、JWT 会话 + `token_version`、改密、进程内限流、4 角色 | 注册（`auth.sign_up` 单事务）/登录/登出、改密（当前设备重签）、删号、内存限流 | ✅ |
| 组织与成员 | 默认组织（触发器）、邀请链接 7 天、角色管理、组织停用 | 默认组织（注册触发器）、建组织、多组织、邀请 token、4 角色与权限矩阵、移除成员、最后一个 owner 保护、归档组织 | ✅ |
| 云谱空间 | 谱系/谱文/谱书三棵分类树 | 目标字段的 `project`、20 位 `ref`、项目创建冲突重试；谱系分类树已可用，谱文/谱书仍是占位页 | 🟡 部分 |
| 谱系与人丁 | `FR-LIN-1` ~ `FR-LIN-13` | 左侧谱系管理、欧式书本画布、世系表、搜索定位、字辈提示、始祖/子女/兄弟/配偶、拖拽录入、检查器、编辑/移动/删除、打印视图、按代渲染窗口；人丁自定义字段 UI 未实现 | 🟡 部分 |
| 谱文 | `FR-ART-1` ~ `FR-ART-5` | 表存在；无页面、无 Action | ⬜ 未实现 |
| 谱书与编目 | `FR-BOOK-1` ~ `FR-BOOK-8` | 表存在；无页面、无 Action | ⬜ 未实现 |
| 分类树 | `folder` | 谱系分类已实现（三级、删除子树并解绑内容）；谱文/谱书分类未接入 | 🟡 部分 |
| 审计 / 活动记录 | 目标设计不建审计表；关键动作写结构化日志 | 可变的 `activity_logs`；账号级事件 `org_id` 为空 | ➕ 目标外已有 |
| 界面语言 | 简体中文 | 全站中文，品牌“云谱”；无 i18n 框架 | ✅ |
| 工程工具链 | Biome + Vitest + Playwright E2E | Biome + Vitest（单测 + 真实 PostgreSQL 集成测试），无 E2E | 🟡 部分 |

---

## 3. 关键 FR 差异

只列会被误判为“已实现”的项。未列出的 `FR-LIN-*`、`FR-ART-*`、`FR-BOOK-*` 全部为 ⬜。

### 3.1 认证

| FR | 状态 | 当前行为 / 差异 |
|---|---|---|
| `FR-AUTH-1` 邮箱密码注册 | 🟡 | 注册可用，注册后直接登录；密码只校验长度 8–100，不要求字母 + 数字 |
| `FR-AUTH-2` 邮箱密码登录 | ✅ | 登录路径与目标一致 |
| `FR-AUTH-3` 会话保持 | ✅ | JWT Cookie 1 天有效，`proxy.ts` 在剩余 < 6 小时时滑动续期；`getSessionUser()` 校验 `token_version` 与 `deleted_at` |
| `FR-AUTH-4` 登出 | ✅ | 删除当前 `session` Cookie；其它设备会话不受影响 |
| `FR-AUTH-5` 登录失败限流 | ✅ | 登录 10 次/15 分钟（IP + 邮箱）的进程内滑窗；重启清零、多实例不共享，与目标的 best-effort 语义一致 |
| `FR-AUTH-6` 修改密码 | ✅ | 登录态可改密，验证旧密码并递增 `token_version`；成功后用新版本重签当前设备，其他设备旧会话失效 |

额外已有：修改密码、删除账号、账号安全页、活动日志。

### 3.2 组织与成员

| FR | 状态 | 当前行为 / 差异 |
|---|---|---|
| `FR-ORG-1` 注册即得默认组织 | ✅ | `auth.sign_up` 在单事务内创建用户、默认组织与 `owner` 成员关系；无效邀请不写入任何行。机制是注册触发器 + `SECURITY DEFINER` 函数 |
| `FR-ORG-2` 新建额外组织 | ✅ | 单事务写入组织、owner 成员与活动日志；slug 由服务端生成（20 位 `[0-9a-z]`） |
| `FR-ORG-3` 多组织切换 | ✅ | 一个账号可属于多个组织，控制台顶部提供组织切换 |
| `FR-ORG-4` 邀请成员 | ✅ | 一次性 token（数据库只存 SHA-256）、7 天过期、禁止邀请 `owner`；支持已注册用户与未注册用户两种入口 |
| `FR-ORG-5` 修改成员角色 | 🟡 | 支持 owner/admin 修改成员角色；没有转让所有权（`org.transfer` 权限已定义，无 Action/UI） |
| `FR-ORG-6` 移除成员 | ✅ | owner/admin 可移除成员；事务内锁定成员并拒绝移除最后一个 owner，也不能移除自己 |
| `FR-ORG-7` 组织设置 | ✅ | 改名仅 owner（服务端校验）；slug 不可修改；归档有二次确认 |
| `FR-ORG-8` 组织停用 | ✅ | 归档写 `status='closed'` + `deleted_at`，同时作废待处理邀请 |

### 3.3 云谱空间

| FR | 状态 | 当前行为 / 差异 |
|---|---|---|
| `FR-PROJ-1` 创建云谱空间 | ✅ | 字段为 `name`、`primary_name`、`primary_surname`、`hall_code`、`countries_regions`；20 位 `ref` 由服务端生成且用于 URL |
| `FR-PROJ-2` 多个云谱空间 | ✅ | 一个组织可建多个 project |
| `FR-PROJ-3` 分类管理 | 🟡 | 谱系分类已有三级树、重命名、删除并解绑内容；谱文/谱书分类页仍为占位 |

### 3.4 谱系与人丁

| FR | 状态 | 当前行为 / 差异 |
|---|---|---|
| `FR-LIN-1` 创建谱系 | ✅ | 名称、姓氏、郡望、字辈、分类；创建后进入画布 |
| `FR-LIN-2` 录入始祖 | ✅ | 空谱系可录入第一个血亲节点，世次 1、深度 0；可同录详情与一位配偶 |
| `FR-LIN-3` 添加配偶 | ✅ | 配偶 `path` 为空，`spouse_of_id` 指向血亲；创建人丁时可同录配偶，移动子树时同步世次/深度 |
| `FR-LIN-4` 添加兄弟 | ✅ | 继承父节点，世次与兄弟一致；始祖不能添加兄弟 |
| `FR-LIN-5` 添加子女 | ✅ | 世次 +1，可连续添加；只有血亲节点能作为父辈；录入表单按父辈预填世次/排行/字辈 |
| `FR-LIN-6` 编辑人丁信息 | 🟡 | 姓名、前缀、字号、性别、生卒、葬地、行传、在世状态；自定义 `attributes` 尚未提供 UI |
| `FR-LIN-7` 删除人丁 | ✅ | 子树与配偶一次软删，`node_count` 同步；始祖不可删除；无回收站 |
| `FR-LIN-8` 移动人丁 | ✅ | 事务内重算子树 `path`/`depth`/`generation`，拒绝移动始祖与成环；画布可拖拽连线改父 |
| `FR-LIN-9` 谱系图交互 | ✅ | 单一 `book_ltr` 欧式书本布局：世代列/表头、折叠展开、平移缩放、点选/双击编辑、搜索定位、居中、小地图、拖拽录入、连线改父 |
| `FR-LIN-10` 按代加载 | ✅ | 页面仍一次读取全部节点；超过 500 人时画布首屏渲染 5 世，向右平移或按钮每次追加 5 世，并开启 `onlyRenderVisibleElements` |
| `FR-LIN-11` 人丁搜索 | ✅ | 画布搜索匹配姓名/字号/前缀/生卒/葬地/行传/配偶并定位节点（配偶命中定位其血亲）；世系表保留过滤 |
| `FR-LIN-12` 字辈提示 | ✅ | 世次分组、画布表头与节点徽标展示字辈；录入表单按世次预填字辈 |
| `FR-LIN-13` 世系表视图 | ✅ | 按世次分组、与画布共用检查器、打印视图；无 CSV/PDF 导出 |

---

## 4. 目标外已有能力

这些功能在代码中存在，但 PRD 明确不在 M1 范围，或没有在目标设计中定义：

- 账号安全页（改密、删号）与活动日志页。
- 营销页 `/`。
- 控制台 UI 设计令牌、组织/项目两套侧边栏、顶部组织/项目选择器、成员面板、邀请链接复制。

---

## 5. 已知实现风险

1. **最后一个 owner 保护只在应用层**：数据库有“单组织仅一个 owner”的部分唯一索引，但没有“至少一个 owner”的约束；绕过服务层直接软删成员仍可能产生无 owner 组织。
2. **RLS 依赖运行期角色分离**：生产 `POSTGRES_URL` 必须使用非表属主的 `app` 角色（`GRANT app_rw`），否则 `FORCE RLS` 的兜底语义会被削弱。本地/CI 用超级用户迁移后 `SET LOCAL ROLE app_rw`，这一点已在集成测试中覆盖，但真实 Neon/Vercel 部署尚未验证。
3. **限流是进程内内存实现**：重启清零，多实例不共享；目标设计接受这一 best-effort 限制，不把它当作安全边界。
4. **邀请不发送邮件**：链接需要人工复制转发；这是目标设计允许的 M1 形态。
5. **无自助密码找回**：目标设计与当前实现都没有邮件通道；忘记密码只能由运维人工重置。
6. **`activity_logs` 不是审计表**：记录可被修改（无软删列）；日志保留期外的逐条追溯依赖备份与 PITR，无法回答细粒度“谁改了什么”。
7. **软删没有回收站 UI**：数据仍在库内，但用户无法恢复；生产清库前必须确认备份。
8. **注册触发器会为每个用户创建个人组织**：被邀请注册的用户同时拥有个人组织与邀请方组织；组织切换器需要覆盖这一情形。
9. **没有 Playwright/E2E**：RSC 守卫与真实浏览器交互仍由集成测试和人工验证覆盖。
10. **谱系画布一次加载全部节点**：详情页仍读取整棵谱系，画布只按世代窗口渲染；超过 500 人时首屏 5 世、每次追加 5 世，但没有服务端分页或虚拟滚动。极大人丁量下传输与索引仍有成本，后续需补按代查询。

> `getSessionUser()` 返回完整用户行（含密码哈希）；`GET /api/user` 与根布局 TanStack Query hydration 已收窄为 `SessionUser`（`{ id, name, email }`）。新增对外出口必须显式挑字段，不能直接序列化整行。

---

## 6. 路线决策（2026-10-21 / 2026-10-22）

| # | 决策 | 状态 |
|---|---|---|
| D1/D2 | 目标为家谱 M1；无生产数据，采用基础层重置 | ✅ Phase 3 已执行；见 [ADR 0001](./adr/0001-foundation-reset.md) |
| D3 | UUIDv7 在创建家谱表之前一次性替换 `serial` | ✅ 已实现（`uuidv7()`） |
| D4 | 新家谱表从第一天启用 RLS；先补齐 `organization_member` 策略缺口 | ✅ 已实现：`auth.has_org_role()` + 按角色策略；集成测试覆盖 |
| D5 | 先落权限字符串矩阵，再扩到 4 个角色 | ✅ 已实现 |
| D6 | 修改邮箱要求当前密码 | ✅ 已实现 |
| D7 | 保留 `activity_logs` 作为产品活动流并修复多组织归属；不把它当审计表 | ✅ 已实现：账号级事件 `org_id` 为空 |
| D8 | M1 过渡期保留 3 个内部只读 API，补 401 与契约文档 | ✅ 已实现；API 收敛未开始 |
| D9 | 邀请使用一次性 token + 7 天过期，禁止邀请 owner | ✅ 已实现 |

## 7. 更新规则

- 合并涉及家谱目标功能的 PR 时，更新本文件对应模块与 FR 行。
- 新增/删除表、Action、Route Handler 时，同步更新 [README](./README.md) 的“当前仓库速览”和本文件 §1。
- 只有代码、迁移、测试都落地后，状态才能从 🟡/⬜ 改为 ✅。
- 本文件不记录“计划做什么”；计划写在 PRD、架构文档或 issue 里。
