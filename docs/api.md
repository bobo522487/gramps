# 接口契约

| 项 | 值 |
|---|---|
| 文档版本 | 1.7 |
| 最后更新 | 2026-10-23 |
| 接口风格 | Server Action（内部写）+ RSC（内部首屏读）+ TanStack Query（客户端缓存）+ 4 个只读 Route Handler |
| 序列化 | JSON；Route Handler 非 2xx 返回 `{ error, code? }` |
| 相关文档 | [架构](./architecture/00-overview.md) · [数据模型](./data-model.md) · [PRD](./prd.md) · [实现状态](./implementation-status.md) |

---

## 1. 总则

### 1.1 为什么没有 REST API

内部 UI 的读写不走 HTTP 接口：

| 操作 | 通道 | 理由 |
|---|---|---|
| 内部读（首屏） | RSC 服务端直读 | 零客户端请求、无 loading 闪烁、类型天然贯通 |
| 内部读（客户端刷新） | TanStack Query → 4 个只读 GET Route Handler | 统一缓存、失效与乐观更新；读请求可缓存、可预取、按路由观测（ADR 0008） |
| 内部写 | Server Action | 免手写路由与 fetch、内置 CSRF、渐进增强 |
| 探活 | Route Handler | 需要标准 HTTP 语义 |

M1 的 Route Handler 全部是只读 GET：`/api/health`、`/api/user`、`/api/orgs`、`/api/orgs/[orgId]/projects`。**没有 `/api/auth/*`**：认证与租户写只从 Server Action 调 `auth.api.*`。

TanStack Query 只做客户端缓存层：`mutationFn` 调用 Server Action；`queryFn` 调用 4 个只读 Route Handler（[ADR 0008](./decisions/0008-read-only-route-handlers.md)），组件内不手写 `fetch`。

M1 没有公开接口——没有分享页，没有第三方消费者。引入 REST 层意味着多维护一份契约（DTO、校验、鉴权、文档），而收益是零。

### 1.2 命名

| 对象 | 规则 | 示例 |
|---|---|---|
| Server Action | 动词 + 名词 + `Action` 后缀，驼峰 | `createLineageAction`、`addChildAction` |
| Action 文件 | `actions.ts`，按域 | `lib/lineage/actions.ts` |
| 入参类型 | `<Action>Input` | `CreateLineageInput` |
| 出参类型 | `ActionState`（权威定义 `lib/auth/types.ts`） | `ActionState` |

### 1.3 数据格式

| 项 | 约定 |
|---|---|
| 时间 | ISO 8601 带时区，`2026-10-21T12:00:00+08:00` |
| 日期（族谱原文） | 字符串，不做解析。`"乾隆三十年乙酉"` |
| ID | UUIDv7 字符串 |
| 空值 | `null`，不用 `undefined`、不用空字符串 |
| 布尔 | `true` / `false` |
| 枚举 | 小写字符串或 smallint，见数据字典 |

---

## 2. 认证与上下文

### 2.1 会话

| 项 | 约定 |
|---|---|
| 载体 | Better Auth 数据库会话，Cookie `better-auth.session_token`（HttpOnly、Secure、SameSite=Lax） |
| 令牌 | 会话 ID 由 Better Auth 生成；库内只存 token 哈希；`BETTER_AUTH_SECRET` 用于签发与校验 |
| 校验 | 服务端一律 `getSessionUser()`：调用 `auth.api.getSession` 按请求缓存查库，未命中返回 `null`；不信任 Cookie 是否存在 |
| 刷新 | Better Auth 滑动续期：会话 7 天过期、`updateAge` 1 天；`proxy.ts` 只检查 Cookie 是否存在，做粗粒度门禁 |
| 有效期 | 7 天（滑动）；**不做刷新令牌轮换** |
| 登出 | `auth.api.signOut` 删除当前数据库会话并清 Cookie；其他设备不受影响 |
| 登录方式 | **仅邮箱 + 密码**（M1）。手机验证码与 OAuth 在 M4 |
| 密码 | Better Auth 以 scrypt 哈希存入 `auth.account`；应用不接触哈希，不保存明文 |
| 邮箱验证 / 找回密码 / 改邮箱 | 均关闭；邮箱创建后只读 |

### 2.2 组织上下文

页面/布局用 `requireOrgContext(orgSlug)` / `requireProjectContext(projectRef)` 把公开 ID 解析成内部 scope（`organizationId`、`projectId`、`role`）。Action 入参使用内部 UUID（`orgId`、`projectId`、`lineageId` 等），不使用公开 ID 作为授权依据。即使 UUID 被篡改，事务内仍需 `getOrgRoleInTx` + `hasPermission` 复核；非成员返回 404，权限不足返回 403。

公开 ID 只用于 URL 定位；不要新增按公开 ID 写入的入口。

| 情况 | 返回 |
|---|---|
| 未登录 | `AUTH_REQUIRED` (401) |
| 不是该组织成员 | `NOT_FOUND` (404) — 不返回 403，避免泄露组织存在性 |
| 组织已停用 + 写操作 | `ORG_SUSPENDED` (403) |

**M1 的 scope 没有 `planId`**。目标设计不包含付费档位或用量上限，所有组织功能无差别。

### 2.3 注册与默认组织

注册由 `signUp` Server Action 调 `auth.api.signUpEmail` 完成，默认组织由数据库触发器创建（见 [data-model §4.4](./data-model.md#44-注册触发器默认组织)）。

```
用户提交邮箱密码
  → Zod 校验
  → auth.api.signUpEmail({ email, password, name })
      → Better Auth 以 scrypt 哈希写入 auth.account
      → 插入 auth.users
      → 触发器 trg_auth_user_created / handle_new_user() 建 organization + organization_member(owner)
  → Better Auth 写入数据库会话并 set-cookie（better-auth.session_token）
  → 直接登录并进入 /dashboard
```

应用层**不需要**调用任何「创建默认组织」的 Action。这条链路是数据库保证的，不是应用保证的。Better Auth 与触发器都以 `auth_service` 身份写租户表；业务运行时角色 `app_rw` 没有这些表的写权限。

M1 **不发送验证邮件**：`auth.users` 插入后即可登录，不存在「等待验证」的中间状态；`emailVerification` 关闭。

### 2.4 CSRF

Server Action 由 Next.js 内置 Origin 校验。4 个 Route Handler 全部是只读 GET，无副作用，不需要 CSRF 防护。

---

## 3. 通用约定

### 3.1 分页

**游标分页**，不用 offset（offset 在数据变动时会重复/漏行）。

```typescript
interface PageQuery {
  cursor?: string;      // 上一页最后一条的 id
  limit?: number;       // 默认 20，最大 100
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;   // null = 没有下一页
}
```

### 3.2 排序

| 资源 | 默认排序 | 可覆盖 |
|---|---|---|
| 谱系列表 | `updated_at DESC` | `name`、`created_at` |
| 人丁（表格视图） | `generation ASC, sort ASC` | 不支持 |
| 编目 | `sort ASC` | 拖拽即写 `sort` |

### 3.3 并发控制

M1 **只有一层**：业务唯一索引挡重复提交。

| 场景 | 机制 | 冲突返回 |
|---|---|---|
| 创建（防重复提交） | 业务唯一索引 | `CONFLICT_DUPLICATE` (409) |
| 同时编辑同一资源 | **无保护，last-write-wins** | 无 |

**M1 没有编辑锁，也没有乐观锁。** 两人同时编辑同一谱系或谱文，后保存的覆盖先保存的。这是 PRD §6.3 缺口 3，M2 加锁解决。

这是刻意的取舍：锁需要 `resource_lock` 表、心跳、fencing token、UI 只读态，是一整套机制。M1 的用户是「一个家族里 2–3 个熟人」，冲突概率低且可沟通；先不做，把成本留给有真实并发诉求之后。

### 3.4 批量操作

| 限制 | 值 |
|---|---|
| 单次批量写入上限 | 500 行 |
| 超限 | `VALIDATION_FAILED`，提示分批 |
| 批量操作原子性 | 全部成功或全部回滚（同一事务） |

---

## 4. 错误模型

### 4.1 内部：类型化错误层级

```typescript
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
  readonly isOperational = true;      // 可预期错误，可安全返回给客户端
  constructor(message: string, readonly meta?: Record<string, unknown>) { super(message); }
}

export class UnauthenticatedError extends AppError { code = 'AUTH_REQUIRED'; status = 401; }
export class RateLimitedError      extends AppError { code = 'AUTH_RATE_LIMITED'; status = 429; }
export class ForbiddenError       extends AppError { code: string; status = 403; }
export class ValidationError      extends AppError { code = 'VALIDATION_FAILED'; status = 422; }
export class NotFoundError        extends AppError { code = 'NOT_FOUND'; status = 404; }
export class ConflictError        extends AppError { code: string; status = 409; }
```

M1 有 6 个错误类。`RateLimitedError` 用于登录与注册的进程内滑窗限流；M2 的编辑锁另加 `LockError`。

### 4.2 出口一：Server Action → ActionState

Server Action 无法设置 HTTP 状态码，也**不应该 throw**——throw 会被框架转成 500 错误页，UI 无法区分「同名冲突」和「校验失败」。

Action 返回 `ActionState`，权威定义在 `lib/auth/types.ts`。语义：

- `error` / `success`：面向用户的中文文案；
- `code`：稳定机器码（如 `FORBIDDEN`、`CONFLICT_DUPLICATE`）；
- `fieldErrors`：字段级错误；
- `orgId` / `projectId` / `lineageId` 等：成功后的内部 UUID，供 UI 导航或刷新。

不要回显密码；不要把异常堆栈放进返回值。

UI 消费方式：

```tsx
const result = await addChildAction({ ... });
if (result.error) {
  if (result.code === 'CONFLICT_DUPLICATE') return showNameConflict();
  if (result.fieldErrors) return setFieldErrors(result.fieldErrors);
  return showToast(result.error);
}
```

### 4.3 出口二：Route Handler → JSON

Route Handler 非 2xx 统一返回 `{ "error": "Unauthorized" }` 这类 JSON；需要机器码时加 `code`。`/api/health` 503 返回 `{ "status": "error", "database": "down" }`。此前文档写的 RFC 9457 没有落地，删除该承诺。

未预期异常不返回堆栈；`request_id` 在响应头与日志里。4 个 Route Handler 中只有 `/api/health` 会产生 503，其余业务路由返回 401/403/404。

### 4.4 错误码

| 码 | HTTP | 含义 | 前端处理 |
|---|---:|---|---|
| `AUTH_REQUIRED` | 401 | 未登录 | 跳登录页 |
| `AUTH_INVALID_CREDENTIALS` | 401 | 账号或密码错误 | 表单内提示 |
| `AUTH_EMAIL_TAKEN` | 409 | 注册邮箱已存在 | 字段级提示 |
| `AUTH_RATE_LIMITED` | 429 | 登录或注册尝试过于频繁 | 提示稍后重试 |
| `ORG_SUSPENDED` | 403 | 组织已停用 | 只读横幅 |
| `FORBIDDEN` | 403 | 无该操作权限 | Toast |
| `INVITE_INVALID` | 410 | 邀请链接无效、过期、已使用或已撤销 | 提示重新邀请 |
| `NOT_FOUND` | 404 | 资源不存在或无权限 | 404 页 |
| `CONFLICT_DUPLICATE` | 409 | 唯一约束冲突 | 字段级提示 |
| `REF_LINEAGE_IN_USE` | 409 | 谱系被编目引用 | 提示先移除编目 |
| `REF_ARTICLE_IN_USE` | 409 | 谱文被编目引用 | 同上 |
| `VALIDATION_FAILED` | 422 | 入参校验失败 | 字段级提示 |
| `INTERNAL` | 500 | 未预期错误 | 通用错误页 |

`AUTH_RATE_LIMITED` 用 429：限流状态只保存在应用进程内，重启与多实例之间不共享，是降低暴力尝试的尽力而为措施，不是账号级持久锁定。

---

## 5. Server Action

### 5.1 规范

每个 Action 必须遵循同一骨架：

```typescript
'use server';

export const updateNodeAction = validatedActionWithUser(
  updateNodeSchema,
  async (data, _formData, user) => {
    const result = await updateNodeInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      nodeId: data.nodeId,
      updates: {
        name: data.name,
        surname: data.surname,
        sex: data.sex,
        courtesy: data.courtesy,
        namePrefix: data.namePrefix,
        isAlive: data.isAlive,
        birthText: data.birthText,
        deathText: data.deathText,
        birthYear: data.birthYear,
        deathYear: data.deathYear,
        burialPlace: data.burialPlace,
        biography: data.biography,
      },
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateWholeConsole();
    return { success: '人丁信息已保存', nodeId: result.node.id };
  }
);
```

`updateNodeInTransaction` 在内部用 `withOrg` + `requireLineageWrite` 复核；Action 只传内部 UUID。失效目前走 `revalidateWholeConsole()`（整棵 `/dashboard` 树）：`lib/lineage/revalidate.ts` 里的 `revalidateProject(orgSlug, projectRef)` 是**已实现但零调用者**的收窄版本，因为 Action 的 Zod 入参只有 UUID，拿不到路径需要的公开 `orgSlug` / `projectRef`。收窄是评审 P1-8 的代码任务，不能写成现状。

| 规则 | 说明 |
|---|---|
| 入参 | 单个对象，Zod 解析后才可信 |
| 出参 | 恒为 `ActionState`，永不 throw |
| 副作用顺序 | 业务写入 → `revalidatePath`；写失败不失效缓存 |
| 缓存 | 写后 `revalidatePath`，粒度到受影响的页面 |
| 幂等 | 不保证。重复提交由唯一索引挡住 |

**M1 的骨架里没有编辑锁**。M2 引入编辑锁后，顺序变为「锁 → 业务 → 缓存失效」。

M1 **不写审计表**：关键动作写结构化日志（[data-model §9](./data-model.md#9-审计与追溯)），日志失败不阻塞业务。

### 5.2 Action 清单

下表用语义名；实际导出统一为 `<verb><Noun>Action`（如 `createLineageAction`、`addChildAction`）。

#### auth

| Action | 入参 | 返回 | 权限 |
|---|---|---|---|
| `signUp` | `{ email, password, name?, invite? }` | `{ user, organization }` | 公开（未登录） |
| `signIn` | `{ email, password, redirect? }` | `{ user }` | 公开（未登录） |
| `signOut` | `{}` | `void` | 登录即可 |
| `changePassword` | `{ currentPassword, newPassword, confirmPassword }` | `void` | 登录即可 |
| `updateAccount` | `{ name }` | `void` | 登录即可 |
| `deleteAccount` | `{ password }` | `void` | 登录即可（非唯一 owner） |

`signUp` 调 `auth.api.signUpEmail`，成功后 Better Auth 立即写数据库会话与 Cookie，无需等待验证邮件。`changePassword` 走 `auth.api.changePassword({ revokeOtherSessions: true })`：当前会话保留，其他设备立即失效，不再有 `token_version`。注册与登录使用进程内滑窗限流，超限返回 `AUTH_RATE_LIMITED`（429）；不持久化失败计数，也不做账号级锁定。

#### identity

| Action | 入参 | 返回 | 权限 |
|---|---|---|---|
| `acceptInvite` | `{ invitationId }` | `Organization` | 登录即可 |
| `inviteMember` | `{ orgId, role, email }` | `{ inviteUrl }` | `member.invite` |
| `updateMemberRole` | `{ orgId, memberId, role }` | `OrganizationMember` | `member.manage` |
| `removeMember` | `{ orgId, memberId }` | `void` | `member.manage` |
| `transferOwnership` | `{ orgId, memberId }` | `void` | `owner` |

`inviteMember` 调 `auth.api.createInvitation`，链接为 `${BETTER_AUTH_URL}/sign-up?invite=<invitation.id>`，只在创建时返回一次；不发邮件。邀请 7 天过期、一次性；同一组织重新邀请会取消旧的 pending 邀请；禁止邀请 `owner`。接受走 `/dashboard/join?invite=<id>`，失败时保留账号、可重试。邀请无效、过期、已使用或已撤销时返回 `INVITE_INVALID`。

**没有 `bootstrapOrganization` 之类的 Action**：默认组织由数据库触发器创建（§2.3）。

#### organization

| Action | 入参 | 返回 | 权限 |
|---|---|---|---|
| `createOrganization` | `{ name }` | `Organization` | 登录即可 |
| `updateOrganization` | `{ orgId, name? }` | `Organization` | `org.settings` |

`slug` 由服务端生成（20 位 `[0-9a-z]` 随机公开 ID），不可修改；客户端只在需要 URL 时读取返回值。

#### project

| Action | 入参 | 返回 | 权限 |
|---|---|---|---|
| `createProject` | `{ orgId, name, surname, themeName, countriesRegions, status?, importance?, notes? }` | `Project` | `project.write` |
| `updateProject` | `{ orgId, projectId, name?, countriesRegions?, hallCode?, status?, importance?, notes? }`（`surname` / `themeName` 不可修改） | `Project` | `project.write` |
| `deleteProject` | `{ orgId, projectId }` | `void` | `project.write` |
| `createFolder` | `{ orgId, projectId, kind, parentId?, name }` | `Folder` | `project.write` |
| `renameFolder` | `{ orgId, folderId, name }` | `Folder` | `project.write` |
| `deleteFolder` | `{ orgId, folderId }` | `void` | `project.write` |

`ref` **不由客户端传入**：服务端生成 20 位随机公开 ID，作为 URL 第二段（PRD FR-PROJ-1）。`projectId` 是内部 UUIDv7，只用于 Action；客户端需要 URL 时读取返回的 `ref`。

#### lineage

| Action | 入参 | 返回 | 权限 |
|---|---|---|---|
| `createLineage` | `{ orgId, projectId, name, surname, hallCode?, generationWords? }` | `Lineage` | `lineage.write` |
| `updateLineage` | `{ orgId, lineageId, ...可选 }` | `Lineage` | `lineage.write` |
| `deleteLineage` | `{ orgId, lineageId }` | `void` | `lineage.write` |
| `createRootNode` | `{ orgId, lineageId, name, surname, sex }` | `Node` | `lineage.write` |
| `addSpouse` | `{ orgId, lineageId, spouseOfId, name, sex }` | `Node` | `lineage.write` |
| `addSibling` | `{ orgId, lineageId, siblingOfId, name, sex }` | `Node` | `lineage.write` |
| `addChild` | `{ orgId, lineageId, parentId, name, sex }` | `Node` | `lineage.write` |
| `updateNode` | `{ orgId, lineageId, nodeId, ...字段 }` | `Node` | `lineage.write` |
| `deleteNode` | `{ orgId, lineageId, nodeId }` | `void` | `lineage.write` |
| `moveNode` | `{ orgId, lineageId, nodeId, newParentId }` | `Node` | `lineage.write` |
| `reorderSiblings` | `{ orgId, lineageId, parentId, orderedIds }` | `void` | `lineage.write` |

**四种新增方式的语义**：

| Action | 世次 | 父节点 | 路径 |
|---|---|---|---|
| `createRootNode` | 1 | 无 | 新建根路径 |
| `addChild` | 父 + 1 | 当前节点 | 父路径 + 新 label |
| `addSibling` | 同父节点世次 | 与参照节点相同 | 同父路径 + 新 label |
| `addSpouse` | 不占世次 | 无 | `NULL`，`spouse_of_id` 指向配偶 |

#### content

| Action | 入参 | 返回 | 权限 |
|---|---|---|---|
| `createArticle` | `{ orgId, projectId, title, kind?, content }` | `Article` | `article.write` |
| `updateArticle` | `{ orgId, articleId, title?, content? }` | `Article` | `article.write` |
| `deleteArticle` | `{ orgId, articleId }` | `void` | `article.write` |

#### publishing

| Action | 入参 | 返回 | 权限 |
|---|---|---|---|
| `createBook` | `{ orgId, projectId, name, title, surname, coverSpec }` | `Book` | `book.write` |
| `updateBook` | `{ orgId, bookId, ...可选 }` | `Book` | `book.write` |
| `deleteBook` | `{ orgId, bookId }` | `void` | `book.write` |
| `addCatalogItem` | `{ orgId, bookId, parentId?, name, section, articleId?, lineageId? }` | `BookCatalog` | `book.write` |
| `updateCatalogItem` | `{ orgId, bookId, catalogId, name?, section?, hide? }` | `BookCatalog` | `book.write` |
| `moveCatalogItem` | `{ orgId, bookId, catalogId, parentId?, sort }` | `BookCatalog` | `book.write` |
| `removeCatalogItem` | `{ orgId, bookId, catalogId }` | `void` | `book.write` |

M1 没有 `createShareLink` / `revokeShareLink`（分享在 M2）。

---

## 6. Route Handler

### 6.1 `GET /api/health`

```json
{ "status": "ok", "database": "up" }
```

数据库不可达时返回 503，`{ "status": "error", "database": "down" }`。这是 4 个只读 Route Handler 之一。

---

## 7. 客户端消费

### 7.1 读

页面是 RSC，首屏数据在服务端取好后通过 `initialData` 或 `dehydrate` / `HydrationBoundary` 注入 TanStack Query，**客户端首屏不发起数据请求**。交互工作区需要刷新时，`queryFn` 调用 4 个只读 Route Handler（[ADR 0008](./decisions/0008-read-only-route-handlers.md)）。

```tsx
// app/(dashboard)/dashboard/project/[projectRef]/lineages/[lineageId]/page.tsx
export default async function Page({ params }: Props) {
  const ctx = await requireProjectContext(params.projectRef);
  const graph = await getLineageGraph(ctx, params.lineageId);
  return <LineageCanvas initialGraph={graph} />;
}
```

### 7.2 写

写操作仍走 Server Action；TanStack Query mutation 负责 pending、乐观更新与缓存失效，不再用 `router.refresh()` 作为默认刷新手段。

```tsx
'use client';

const queryClient = useQueryClient();
const addChildMutation = useMutation({
  mutationFn: addChildAction,
  onSuccess: (result) => {
    if (!result.ok) return handleError(result.error);
    queryClient.invalidateQueries({ queryKey: lineageKeys.graph(lineageId) });
  },
});

function handleAddChild() {
  addChildMutation.mutate({ orgId, lineageId, parentId, name, sex });
}
```

### 7.3 错误映射

每个错误码映射到一种 UI 表现；当前没有集中的映射文件，映射由各表单/Toast 就地处理：

| 类别 | UI |
|---|---|
| 字段级（`VALIDATION_FAILED`） | 表单内联提示 |
| 认证（`AUTH_*`） | 跳登录页 / 表单内提示 |
| 权限（`FORBIDDEN`、`ORG_SUSPENDED`） | Toast + 只读态 |
| 邀请（`INVITE_INVALID`） | 独立页面，提示链接失效并给出重新邀请入口 |
| 冲突（`CONFLICT_*`、`REF_*`） | Dialog，带解决动作 |
| 其他 | 通用 Toast |

**禁止把 `error.message` 直接展示给用户**——它是给开发者看的。用户看到的是映射表里的文案。

---

## 8. 契约变更规则

| 变更 | 处理 |
|---|---|
| 新增可选入参 | 直接改，兼容 |
| 新增必填入参 | 禁止。改为可选 + 服务端默认值 |
| 删除 / 重命名字段 | 禁止直接删。先标记废弃，两个版本后移除 |
| 新增 Action | 自由 |
| 修改 Action 语义 | 必须新增 Action，不改旧的 |
| 错误码新增 | 自由，但前端映射表必须有兜底分支 |
| 错误码语义变更 | 禁止 |

内部接口没有版本号。契约由 TypeScript 类型保证，破坏性变更在编译期就会被发现。

M2 引入编辑锁后，`lineage` 与 `publishing` 的写 Action 新增带锁的 Action 变体，而不是改现有签名。