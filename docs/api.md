# 接口地图（API）

> **回答什么问题**：系统有几条通道、哪个 URL 渲染什么、Route Handler 与 Server Action 落在哪、返回怎么表达。
> **读者**：开发 · 前端 · AI Agent　**长度上限**：5 页
> **不写什么**：单个 Action 的入参与错误码全集（`docs/contracts/`）、权限矩阵（`docs/contracts/`）、表与列（`docs/data-model.md`）、系统分层（`docs/architecture.md`）、目录树（以源码为准，不另立手抄清单）。

本文件是「接口地图」：哪个 URL 渲染什么、读什么数据、由哪个 Action 写入。契约正文只在 `docs/contracts/`。

## 1. 页面路由

所有页面都是 React Server Component（默认动态渲染）。

### 1.1 公开区

| 路由 | 文件 | 数据 / 行为 |
| --- | --- | --- |
| `/` | `app/(marketing)/page.tsx` | 营销首页；已登录可引导进入控制台 |
| `/sign-in` | `app/(login)/sign-in/page.tsx` | 登录表单，调用 `signIn` |
| `/sign-up` | `app/(login)/sign-up/page.tsx` | 注册表单，调用 `signUp`；支持 `?invite=` |
| `/join` | `app/(login)/join/page.tsx` | 未登录接受邀请：展示 `previewInvitation`，登录/注册后继续 |

### 1.2 控制台

| 路由 | 文件 | 守卫 / 数据 |
| --- | --- | --- |
| `/dashboard` | `(account)/page.tsx` | `requireUser`；`getOrgsForUser`；无组织 → `EmptyOrgState`；否则跳第一个组织 |
| `/dashboard/general` | `(account)/general/page.tsx` | `requireUser`；账号资料 |
| `/dashboard/security` | `(account)/security/page.tsx` | `requireUser`；改密码 |
| `/dashboard/join` | `dashboard/join/page.tsx` | 登录态接受邀请 |
| `/dashboard/org/[orgSlug]` | `org/[orgSlug]/page.tsx` | `requireOrgContext`；`getProjects`；按 `project.write` 显示管理入口 |
| `/dashboard/org/[orgSlug]/team` | `team/page.tsx` | 成员列表 + 待处理邀请 |
| `/dashboard/org/[orgSlug]/settings` | `settings/page.tsx` | 组织重命名/归档 |
| `/dashboard/project/[projectRef]` | `project/[projectRef]/page.tsx` | `requireProjectContext`；项目概览 |
| `/dashboard/project/[projectRef]/settings` | `settings/page.tsx` | 项目编辑/删除 |
| `/dashboard/project/[projectRef]/lineages` | `lineages/page.tsx` | 谱系列表（分类树 + 搜索） |
| `/dashboard/project/[projectRef]/lineages/[lineageId]` | `[lineageId]/page.tsx` | `getLineageById` + `getNodes` + 导航；画布 |
| `/dashboard/project/[projectRef]/articles` | `articles/page.tsx` | 谱文列表（分类、未分类） |
| `/dashboard/project/[projectRef]/articles/[articleId]` | `[articleId]/page.tsx` | `getArticle` + `parseArticleContent` + 媒体模式 |
| `/dashboard/project/[projectRef]/books` | `books/page.tsx` | 占位空状态（无写入口） |

### 1.3 布局层次

```text
app/layout.tsx                       session + orgs → QueryProvider / ThemeProvider
└─ (dashboard)/dashboard/
   ├─ (account)/layout.tsx           账号区框架
   ├─ org/[orgSlug]/layout.tsx       requireOrgContext + getProjects → ConsoleFrame(org)
   └─ project/[projectRef]/layout.tsx
        requireProjectContext + getProjects → ConsoleFrame(org+project)
```

- 布局负责**解析 scope** 与**注入导航数据**；
- 页面负责**取当前资源**（谱系/谱文）；
- 资源必须属于当前 project，否则 `notFound()`（不暴露存在性）。

### 1.4 错误与加载态

| 文件 | 作用 |
| --- | --- |
| `app/error.tsx` | 全局路由错误边界 |
| `app/global-error.tsx` | 根布局错误 |
| `app/not-found.tsx` | 404 |
| `org/[orgSlug]/error.tsx` / `loading.tsx` | 组织区错误/骨架 |
| `project/[projectRef]/error.tsx` / `loading.tsx` | 项目区错误/骨架 |

## 2. Route Handlers

| 方法 + 路径 | 文件 | 鉴权 | 响应 |
| --- | --- | --- | --- |
| `GET /api/health` | `app/api/health/route.ts` | 无 | `{status:'ok',database:'up'}`；DB 失败 503 |
| `GET /api/user` | `app/api/user/route.ts` | session | `{id,name,email}`；未登录 401 |
| `GET /api/orgs` | `app/api/orgs/route.ts` | session | 当前用户组织 + 角色；未登录 401 |
| `GET /api/orgs/[orgId]/projects` | `app/api/orgs/[orgId]/projects/route.ts` | session + 组织成员 | 项目 `{id,name,ref}`；非法 UUID 404，非成员 403 |
| `POST /api/media/upload` | `app/api/media/upload/route.ts` | session + `article.write` + 谱文 scope | fs 模式；`{pathname,size,contentType}` |
| `POST /api/blob/upload` | `app/api/blob/upload/route.ts` | session + `article.write` + 谱文 scope | blob 模式 token；拒绝一律 404 |
| `GET /api/media/[...key]` | `app/api/media/[...key]/route.ts` | session + 组织成员 + 谱文存在 | Blob 302 / fs 字节；失败 404 |

统一包装：`withApiLogging(name, handler)`（`lib/api.ts`）会：

- 生成/透传 `x-request-id`；
- 写入请求上下文（`AsyncLocalStorage`）；
- 记录耗时与状态码；
- 捕获未处理异常 → JSON 500，不泄漏堆栈。

## 3. Server Action 全目录

### 3.1 认证与账号（`lib/auth/actions/`）

| Action | 校验包装 | 入参 | 成功 |
| --- | --- | --- | --- |
| `signIn` | `validatedAction` | `signInSchema` | 重定向 `/dashboard` 或邀请 |
| `signUp` | `validatedAction` | `signUpSchema` | 重定向；触发器自动建组织 |
| `signOut` | 直接函数 | — | 重定向 `/sign-in` |
| `updateAccount` | `validatedActionWithUser` | name/email | `{success, name}` |
| `updatePassword` | `validatedActionWithUser` | 当前/新密码 | 成功文案 |
| `deleteAccount` | `validatedActionWithUser` | 确认 | 删除并登出 |

### 3.2 组织（`lib/org/actions.ts`）

| Action | 权限 | 数据库入口 | 返回 |
| --- | --- | --- | --- |
| `createOrgAction` | 登录 | `app.create_organization(name)` | `{orgId, orgSlug}` |
| `renameOrgAction` | `org.settings` | `app.rename_organization` | 成功文案 |
| `deleteOrgAction` | `org.settings` | `app.archive_organization` | 成功文案 |
| `inviteOrgMember` | `member.invite` | `issueInvitation` | `{inviteUrl, expiresAt}` |
| `acceptInviteAction` | 登录 | `app.accept_invite` | 跳转组织 |
| `removeOrgMember` | `member.manage` | `app.remove_org_member` | 成功文案 |
| `updateOrgMemberRole` | `member.manage` | `app.set_org_member_role` | 成功文案 |

规则：admin 不能邀请/管理 admin；不能移除/降级最后一个 owner（数据库 `RAISE EXCEPTION`）。

### 3.3 云谱空间（`lib/project/actions.ts`）

| Action | 权限 | 成功载荷 |
| --- | --- | --- |
| `createProjectAction` | `project.write` | `{projectId, projectRef}` |
| `updateProjectAction` | `project.write` | `revalidatePath` 项目布局 |
| `deleteProjectAction` | `project.write` | 成功文案 |

### 3.4 分类（`lib/folder/actions.ts`）

| Action | 权限 | 说明 |
| --- | --- | --- |
| `createFolderAction` | `project.write` | 同名冲突提示 |
| `renameFolderAction` | `project.write` | 同名冲突提示 |
| `deleteFolderAction` | `project.write` | 内容移入未分类，返回数量 |

### 3.5 谱系（`lib/lineage/actions.ts`）

| Action | 权限 | Service |
| --- | --- | --- |
| `createLineageAction` | `lineage.write` | `createLineageInTransaction` |
| `updateLineageAction` | `lineage.write` | `updateLineageInTransaction` |
| `deleteLineageAction` | `lineage.delete` | `deleteLineageInTransaction` |
| `createRootNodeAction` | `lineage.write` | `createRootNodeInTransaction` |
| `addChildAction` | `lineage.write` | `addChildInTransaction` |
| `addSiblingAction` | `lineage.write` | `addSiblingInTransaction` |
| `addPersonAction` | `lineage.write` | child / root 分流 |
| `updateNodeAction` | `lineage.write` | `updateNodeInTransaction` |
| `deleteNodeAction` | `lineage.delete` | `deleteNodeInTransaction` |
| `moveNodeAction` | `lineage.write` | 空槽一条 `UPDATE` |

### 3.6 谱文（`lib/article/actions.ts`）

| Action | 权限 | 失效策略 |
| --- | --- | --- |
| `createArticleAction` | `article.write` | 整棵控制台 |
| `updateArticleTitleAction` | `article.write` | 整棵控制台 |
| `moveArticleAction` | `article.write` | 整棵控制台 |
| `deleteArticleAction` | `article.write` | 整棵控制台 + 清图片 |
| `saveArticlePageAction` | `article.write` | 不失效 |
| `addArticlePageAction` | `article.write` | 不失效 |
| `deleteArticlePageAction` | `article.write` | 不失效 + 清图片 |
| `reorderArticlePagesAction` | `article.write` | 不失效 |
| `getArticleDeletePreviewAction` | 登录 + 谱文可见（RLS） | 只读 |
| `getFolderDeletePreviewAction` | 登录 + 项目可见（RLS） | 只读 |

## 4. 统一返回与调用约定

### 4.1 客户端调用

```tsx
const [state, action, pending] = useActionState(createProjectAction, {});
<form action={action}> ... </form>
```

- 成功看 `state.success`，失败看 `state.error` + `state.fieldErrors`；
- 需要结构化结果（如 `nodeId`）时读取 `state.data` 或顶层便捷字段。

### 4.2 服务端 Action 约定

1. 文件首行 `'use server'`（通过 `validatedAction*` 间接声明）；
2. 入参只接受 `FormData` 或普通对象；
3. 不返回 `Response`、不抛业务异常；
4. 所有字符串文案面向业务用户，不回显 SQL；
5. 结构性变更后 `revalidateWholeConsole()`。

### 4.3 新增接口的落点

| 需求 | 放哪里 |
| --- | --- |
| 表单提交/按钮写操作 | `lib/<domain>/actions.ts`，用 `validatedActionWithUser` |
| 页面首屏读取 | `lib/db/queries/<domain>.ts`，页面直接调用 |
| 客户端轮询/第三方回调/二进制 | `app/api/**/route.ts`，用 `withApiLogging` |
| 跨页面复用读取 | 查询层 + `cache()`（如 `lib/article/nav.ts`） |

## 5. 四条通道与边界

| 通道 | 谁发起 | 用途 | 授权入口 |
| --- | --- | --- | --- |
| RSC 页面 | 浏览器首次导航 | 首屏读，服务端直接查库 | `requireOrgContext` / `requireProjectContext` |
| Server Action | 表单 / 客户端组件 | **唯一写通道**，成功后触发刷新 | `validatedAction*` + `withOrgWrite(..., '<permission>')` |
| Route Handler | 客户端刷新、探活、图片字节 | 只读 JSON + 健康检查 + 图片通道 | `withApiLogging` → `getSessionUser()`；组织级再加成员校验 |
| TanStack Query | 客户端组件 | 缓存服务端状态，只调只读 Route Handler | 同一 Cookie，服务端仍按会话与成员关系判定 |

**没有 REST 层与公开 API**：没有第三方消费者、分享页、`/api/auth/*`。写只走 Server Action，例外只有两个，且必须带理由：

- 谱文图片字节走 `POST /api/blob/upload`、`/api/media/upload`、`GET /api/media/[...key]`：10MB 图片超过 Action 与 Vercel 函数请求体上限；
- 谱文 Action 收 JSON 对象而非 FormData：正文是嵌套 ProseMirror 文档。

**库内写入口**：建组织、接受邀请、改名、归档、移除成员、改角色不直写表，而是在 `withOrg` 事务内调 `SECURITY DEFINER` 函数——`app.create_organization` / `app.accept_invite` / `app.rename_organization` / `app.archive_organization` / `app.remove_org_member` / `app.set_org_member_role`。**这不是绕过 Server Action**，而是它唯一的库内落点：RLS 只做可见性，写授权与 last-owner 守卫在函数体内判定，失败抛 `42501` / `22023`。契约见 `docs/contracts/` 与 `docs/data-model.md`。

两条硬规则：

- Action 入参只用内部 UUID；公开 `slug` / `ref` 只用于 URL，永不作为授权依据；
- 只返回显式 DTO，不返回整行；SQL、堆栈、密码哈希不出服务端。

## 6. 错误表达

| 出口 | 形状 | 约定 |
| --- | --- | --- |
| Server Action | `ActionState` | 恒为返回值、永不 throw；`error` / `success` 是中文文案，`code` 是稳定机器码，`fieldErrors` 是字段级错误 |
| Route Handler | 英文 JSON + 显式状态码 | 非 2xx 形如 `{ "error": "Unauthorized" }`；`x-request-id` 进响应头与日志；未捕获异常由 `withApiLogging` 转 JSON 500 |

三条校验失败路径（FormData 无用户 / FormData 带用户 / JSON 对象入参）都返回 `code: 'VALIDATION'`，由 `lib/auth/middleware.ts` 统一给出；`code` 的取值范围见 `lib/errors.ts` 的 `ActionErrorCode`。

三层原则：Action 不 throw；用户看中文、日志与客户端看机器码；不泄露内部细节。

> 目标态与现状冲突时，裁决顺序见 `CONTRIBUTING.md` §2「权威口径」。

## 7. 导航数据（侧边栏）

| 函数 | 位置 | 说明 |
| --- | --- | --- |
| `getLineageNav(orgId, projectId)` | `lib/lineage/nav.ts` | 分类 + 谱系 + 人丁数；`cache()` |
| `getNavArticleFolders` / `getNavArticleCounts` | `lib/article/nav.ts` | 谱文分类与计数（按分类、未分类） |
| `getProjects(userId, orgId)` | `lib/db/queries/projects.ts` | 控制台项目切换器 |
| `getOrgsForUser(userId)` | `lib/db/queries/organizations.ts` | 顶栏组织切换器 |

这些读取都走 `withOrg()`，返回可序列化的纯数据，供 RSC 注入 `QueryProvider`。
