# 接口契约（Contracts）

> **回答什么问题**：Action 长什么样、有哪些错误码、谁有哪个权限、每条 HTTP 路由返回什么。
> **读者**：开发 · 前端 · AI Agent　**长度上限**：6 页
> **不写什么**：谁调谁与变更流程（`docs/interfaces.md`）、系统分层（`docs/architecture.md`）、表与列（`docs/data-model.md`）、本 feature 的一次性变更记录（`specs/NNN-xxx/`）。

本文件是**跨 feature 共用契约的唯一真相源**：同一份事实只在这里写一次，feature 目录只放本 feature 新增或修改的差异并引用本文件，不复制全文。术语按 `docs/glossary.md`。

> 目前共用契约全部收在这一份文件里；不为「以后可能拆」预建空文件与空索引。某一域膨胀到难读时再拆，拆完更新本文件。

---

## 1. 通用契约

### 1.1 `ActionState`：唯一返回形状

真相源 `lib/auth/types.ts`：

```ts
export type ActionState<T = undefined> = {
  error?: string;
  code?: string;
  success?: string;
  email?: string;
  fieldErrors?: Record<string, string>;
  data?: T;                 // 成功时的结构化载荷
  name?: string;
  orgId?: string;
  orgSlug?: string;
  projectId?: string;
  projectRef?: string;
  folderId?: string;
  lineageId?: string;
  nodeId?: string;
  spouseId?: string;
  inviteUrl?: string;
};
```

- 它是**带泛型 `data` 的扁平对象，不是 success / error 联合类型**；`code` 是 `string`，合法取值见 §2.1。
- **没有 `ok` 字段**；判断成败看 `error` 是否存在，`data` 只在 `error` 缺失时读。
- `error` / `success` 是给用户看的**中文**文案，`code` 是稳定机器码，`fieldErrors` 由包装器填入。
- 成功后的 UUID 与公开 ID 供 UI 导航；**公开 ID 不作为授权依据**。
- 恒为返回值、永不 throw；不回显密码、SQL 文本、堆栈、驱动错误。

`SessionUser`（同文件）是唯一可序列化到浏览器的用户形状：`{ id, name, email }`。任何出口都不传整行 `session.user`。

### 1.2 三个包装器

真相源 `lib/auth/middleware.ts`：

| 包装器 | 入参 | 用途 |
| --- | --- | --- |
| `validatedAction` | `FormData` | 未登录入口（注册 / 登录） |
| `validatedActionWithUser` | `FormData` | 注入 `SessionUser`；未登录直接返回 `UNAUTHORIZED` |
| `validatedActionWithUserObject` | 对象 | 嵌套或非字符串载荷（谱文正文页、页 ID 数组、`null`） |

FormData 通道用 `Object.fromEntries(formData)` 拍平，嵌套结构与 `null` 会在路上丢掉，所以**谱文域全部 Action 走对象通道**。校验失败统一 `{ error, fieldErrors }`；未登录统一 `{ error: '登录已失效，请重新登录。', code: 'UNAUTHORIZED' }`。

### 1.3 数据格式

| 项 | 约定 |
| --- | --- |
| ID | 入参只用内部 UUIDv7 字符串；20 位 `slug` / `ref` 只用于 URL 与成功返回 |
| 时间 | ISO 8601 带时区 |
| 族谱原文日期 | 字符串，不解析（如「乾隆三十年乙酉」） |
| 空值 | `null`，不用 `undefined`、不用空字符串 |
| 枚举 | 小写字符串或 smallint |
| 布尔 | `true` / `false` |
| 入参校验 | Zod。**字段表的真相源是各域 schema 文件**（`lib/auth/schemas.ts`、`lib/genealogy/schemas.ts`、`lib/article/schemas.ts` 等），本文件不复制 |

---

## 2. 错误码

### 2.1 全局 `ActionErrorCode`

真相源 `lib/errors.ts` 的 `actionError()`，全集如下，`code` 只允许取这些值：

| 码 | 含义 | 前端处理 |
| --- | --- | --- |
| `UNAUTHORIZED` | 未登录或会话失效 | 跳登录页 / 表单内提示 |
| `FORBIDDEN` | 无该操作权限 | Toast + 保持只读态 |
| `NOT_FOUND` | 资源不存在或不可见 | 404 页 |
| `CONFLICT` | 唯一约束冲突、最后一个 owner、组织已归档 | 字段级提示或 Dialog |
| `VALIDATION` | 入参校验失败 | 字段内联提示 |
| `RATE_LIMITED` | 操作过于频繁 | 提示稍后重试 |
| `INTERNAL` | 未预期错误 | 通用 Toast |

`RATE_LIMITED` 是进程内滑窗（登录 / 注册），重启清零、多实例不共享，是尽力而为的辅助，**不是安全边界**。Better Auth 与数据库抛出的错误由 `lib/auth/errors.ts` 的 `mapAuthError()` 翻译成上表码 + 中文文案。

### 2.2 域级 reason（小写，只产中文文案）

域服务层返回 reason，Action 层映射成 `{ error: 中文 }`，**不带全局 `code`**。

| 域 | 常量 | 取值 | 真相源 |
| --- | --- | --- | --- |
| 谱文 | `ARTICLE_ERRORS` | `forbidden` / `not_found` / `page_not_found` / `last_page` / `max_pages` / `too_many_images` / `invalid_image` / `invalid_doc` / `catalog_referenced` | `lib/article/constants.ts` |
| 谱系 | `LINEAGE_ERRORS` | `forbidden` / `not_found` / `invalid_folder` / `conflict` / `referenced` / `root_exists` / `root_sibling` / `root_forbidden` / `invalid_target` / `invalid_parent` / `cycle` / `invalid_order` / `project_surname_missing` | `lib/lineage/lineage-errors.ts` |

`deleteLineageError()` 对 `forbidden` 单独映射到 `lineage.delete` 的拒绝文案——编辑者有写权限，只是不能删谱系，两种拒绝话不能混用。同一个权限只有一句拒绝话，见 §3 的 `PERMISSION_DENIED_MESSAGES`。

### 2.3 Route Handler 错误

非 2xx 一律**英文 JSON**（`{ "error": "Unauthorized" }`）+ 显式状态码。`withApiLogging()`（`lib/api.ts`）统一注入 `x-request-id` 响应头、记录 `duration_ms`，并把未捕获异常转成 JSON 500 `{ "error": "Internal Server Error" }`，不泄漏 HTML 错误页。

---

## 3. 权限矩阵

> 真相源：`lib/auth/access-control.ts` 的 `ORG_PERMISSIONS` / `roles`，拒绝文案在 `lib/auth/permissions.ts` 的 `PERMISSION_DENIED_MESSAGES`。业务代码用 `hasPermission(role, permission)` 检查权限字符串，**不比较角色名**。

| 权限串 | 所有者 | 管理员 | 编辑者 | 查看者 |
| --- | :--: | :--: | :--: | :--: |
| `content.read` | ✅ | ✅ | ✅ | ✅ |
| `lineage.write` | ✅ | ✅ | ✅ | — |
| `lineage.delete` | ✅ | ✅ | — | — |
| `article.write` | ✅ | ✅ | ✅ | — |
| `book.write` | ✅ | ✅ | ✅ | — |
| `project.write` | ✅ | ✅ | — | — |
| `member.invite` | ✅ | ✅ | — | — |
| `member.manage` | ✅ | ✅ | — | — |
| `org.settings` | ✅ | — | — | — |
| `org.transfer` | ✅ | — | — | — |

**`org.transfer` 权限位存在，但没有任何入口调用它**——不要为它写 Action 契约占位。角色只从数据库成员关系读取，不信任客户端传来的角色；写操作用 `getOrgRoleInTx(tx, ...)` 在事务内锁定读复核。

---

## 4. Server Action 契约

> 入参字段的真相源是各域 Zod schema，本表只记「有哪些 Action / 要什么权限 / 成功给什么」。新增或改权限时**先改本表**，再改代码与测试。

| 域 | 文件 | Action | 权限 | 成功返回 |
| --- | --- | --- | --- | --- |
| 认证 | `lib/auth/actions/` | `signIn` / `signUp` / `signOut` / `updatePassword` / `updateAccount` / `deleteAccount` | 公开（前两个）或登录即可 | 会话 Cookie / `success` |
| 组织与成员 | `lib/org/actions.ts` | `createOrgAction` / `renameOrgAction` / `deleteOrgAction` / `inviteOrgMember` / `acceptInviteAction` / `removeOrgMember` / `updateOrgMemberRole` | `org.settings` / `member.invite` / `member.manage`；`createOrgAction` 与 `acceptInviteAction` 登录即可 | `orgId` + `orgSlug` / `inviteUrl` / `success` |
| 云谱空间与分类 | `lib/project/actions.ts`、`lib/folder/actions.ts` | `createProjectAction` / `updateProjectAction` / `deleteProjectAction` / `createFolderAction` / `renameFolderAction` / `deleteFolderAction` | `project.write` | `projectId` + `projectRef` / `folderId` / `success` |
| 谱系与人丁 | `lib/lineage/actions.ts` | `createLineageAction` / `updateLineageAction` / `createRootNodeAction` / `addChildAction` / `addSiblingAction` / `addPersonAction` / `addSpouseAction` / `updateNodeAction` / `deleteNodeAction` / `moveNodeAction` | `lineage.write` | `lineageId` / `nodeId` / `success` |
| 谱系删除 | 同上 | `deleteLineageAction` | **`lineage.delete`**（同域里唯一不同的权限） | `success` |
| 谱文 | `lib/article/actions.ts` | `createArticleAction` / `updateArticleTitleAction` / `moveArticleAction` / `deleteArticleAction` / `saveArticlePageAction` / `addArticlePageAction` / `deleteArticlePageAction` / `reorderArticlePagesAction` | `article.write`，全部走对象入参 | `data: { articleId }` / `{ savedAt, page }` / `{ pageId, pageOrder }` / `{ pageOrder }` |
| 谱文只读预览 | 同上 | `getArticleDeletePreviewAction` / `getFolderDeletePreviewAction` | 只读（`withOrg`，不写库、不失效缓存） | **直接返回预览对象**，不是 `ActionState` |

四条容易写错的规则：

- **人丁创建的幂等键**：`createRootNode` / `addChild` / `addSibling` / `addPerson` / `addSpouse` 的入参必填 `requestId`（uuid）+ 部分唯一索引；重放返回已有那一行，不报错。键的作用域是组织，不是谱系。
- **缓存失效分级**：新建 / 改标题 / 移分类 / 删除谱文调 `revalidateWholeConsole()`；**页级四个 Action 一个都不失效**——整树失效会把服务端快照在敲字间隙推回编辑器，覆盖未保存的页。
- **`ref` / `slug` 由服务端生成**，客户端不传入；冲突时重新生成并重试。
- **谱书、编目、分享没有任何 Action**：表已落库但没有写入口，不为它们写契约占位。

---

## 5. Route Handler 契约

| 路径 | 方法 | 响应 DTO | 状态码 | 授权 |
| --- | --- | --- | --- | --- |
| `/api/health` | `GET` | `{ status, database }` | `200` / `503` | 匿名（只返回存活与数据库连通性） |
| `/api/orgs` | `GET` | `[{ id, name, slug, role }]` | `200` / `401` | `getSessionUser()` |
| `/api/orgs/[orgId]/projects` | `GET` | `[{ id, name, ref }]` | `200` / `401` / `403` / `404` | 会话 + `getOrgRole`；路径参数用 `z.uuid()`，非法 UUID 按 404 |
| `/api/user` | `GET` | `{ id, name, email }` | `200` / `401` | `getSessionUser()` |
| `/api/media/[...key]` | `GET` | `302` + `Location`（私有桶签名 URL）或图片字节 | `200` / `302` / `404` | 会话 + 按 pathname 判成员 + 谱文未软删 |
| `/api/blob/upload` | `POST` | `{ clientToken }` | `200` / `401` / `404` | 同上 + `article.write`；仅 blob 模式 |
| `/api/media/upload` | `POST` | `{ pathname, size, contentType }` | `200` / `400` / `401` / `404` / `413` / `415` | 同上 + `article.write`；仅本地兜底模式 |

共同约定：

- 全部由 `withApiLogging('<route>', handler)` 导出；**只返回显式 DTO，不返回整行**。
- 图片 pathname 必须是 `articles/<organization_id>/<article_id>/<文件名>` 四段形状，任何一段不合法按 404；上传落点由服务端拼，客户端传不了自己的前缀。
- 上传校验：JPG / PNG / WebP，单张 ≤10MB；模式不匹配的上传路由在 handler 内直接 404。
- **鉴权失败与资源不存在一律 404**，不泄露存在性；`/api/orgs/[orgId]/projects` 的「合法 UUID 但非成员」是历史例外，返回 403，改它要同步改集成测试。
- 读取代理不含写入能力；写字节只经上传通道。

---

## 6. 谁在验证契约

> 变更规则以 `docs/interfaces.md` 为准，本文件不复制一遍。这里只列验证者——只改文档不改测试的契约等于没落地。

| 契约 | 验证者 |
| --- | --- |
| Action 通道与返回形状 | `tests/action-channel.test.ts` |
| 组织隔离与 `app_rw` 读认证表被拒 | `tests/integration/org-scope.test.ts` |
| Route Handler 的 401 / 403 / 404 / 成功 | `tests/integration/api-auth.test.ts` |
| 图片读取与上传通道 | `tests/integration/media.test.ts` |
| 文档链接与过期路径 | `pnpm docs:check --strict` |

---

## 7. 以代码为准

> 文档与代码冲突时**以代码为准**，然后回来改文档。以下三处是合并旧契约时发现的形状不一致，现按代码定性：

| 结论 | 依据 |
| --- | --- |
| `ActionState` 是带泛型 `data` 的扁平对象，**不是** success / error 联合类型 | `lib/auth/types.ts` |
| 谱文预览 Action 成功时**直接返回预览对象**，不包 `ActionState` | `lib/article/actions.ts` |
| 域级错误文案常量在代码里，且代码注释曾把 feature 目录内的契约文件当作真相源 | `lib/article/constants.ts`、`lib/lineage/lineage-errors.ts` |

**待办（代码改动，不在本次文档重构内）**：代码注释里对 feature 契约文件的引用，在契约迁入本文件后应统一改为指向 `docs/contracts/`；否则注释会指向已退役的位置。

改文档前先跑：

```bash
grep -n "ActionState\|SessionUser" lib/auth/types.ts
grep -n "ActionErrorCode" lib/errors.ts
grep -n "ORG_PERMISSIONS\|newRole" lib/auth/access-control.ts
find app/api -name route.ts | sort
```
