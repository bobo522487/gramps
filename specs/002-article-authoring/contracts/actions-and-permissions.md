# Phase 1 · 接口契约（Server Action + Route Handler + 媒体存储 + 界面）

> 本仓库的写入一律是 Server Action（返回 `ActionState`），没有对外 REST API 承载这些操作。本期新增 **8 个 Server Action**（全部 `article.write`）、**复用 3 个既有分类 Action**（签名不变、权限口径不变）、新增 **2 个只读预览查询** 与 **3 个 Route Handler**（1 个上传令牌、1 个本地/CI 上传、1 个双模式读取代理）。数据契约见 [data-model.md](../data-model.md)，决策依据见 [research.md](../research.md)。

## 0. 总则

| 项 | 契约 |
|---|---|
| 入参 | 一律 Zod（`lib/article/schemas.ts`），UUID 用 `z.uuid('…无效')`；`folderId` 允许 `null`（未分类） |
| 入参通道 | **结构化载荷（含嵌套 `doc` / `pageIds` / `null`）走对象入参包装器 `validatedActionWithUserObject`**（新增，见 §0.1）；只有纯字符串表单（改标题、移分类、新建）可继续用既有 `validatedActionWithUser`（它读 `Object.fromEntries(formData)`，见 `lib/auth/middleware.ts:52`） |
| 返回 | `ActionState & { data?: T }`（`lib/auth/types.ts` 的 `ActionState` 增加可选 `data` 字段，见 §0.2）；文案全简体中文，不回显堆栈与 SQL |
| 权限 | 每个写 Action 内部用 `withOrgWrite(userId, orgId, 'article.write', fn)`（`lib/db/write.ts:15`，在 `fn` 之前判权限，返回 `T \| { ok: false, reason: 'forbidden' }`，Action 必须把 refusal 映射成 `forbidden` 文案）；读用 `withOrg`；**不信任客户端传来的角色或 projectId** |
| 事务 | 多步写收敛到 `lib/article/services.ts` 的单个 `withOrgWrite` 事务；保存页在事务内 `SELECT … FOR UPDATE` 锁 `article` 行 |
| 失效 | **按操作分级**（research.md §6）：新建/改标题/移分类/删除谱文 → 调 `revalidateWholeConsole()`（全仓库 30 个既有 Action 都只用它，作用域助手 `revalidateProject` 至今零调用者，单独给谱文开第二条路是第二套事实来源）；保存页/加页/删页/重排页 → **一个都不失效**（页级写入不影响列表要展示的字段，整树失效会把服务端快照在敲字间隙推回编辑器，违反 FR-017） |
| 活动日志 | `logActivityInTx` 复用既有 `CREATE_ARTICLE` / `UPDATE_ARTICLE` / `DELETE_ARTICLE` |
| 非成员 | 一律按「不存在」返回 `not_found`，不泄露资源是否存在（FR-034） |

### 0.1 新增包装器 `validatedActionWithUserObject`

```ts
// lib/auth/middleware.ts（与既有 validatedAction / validatedActionWithUser 并列）
export function validatedActionWithUserObject<S extends z.ZodType, R>(
  schema: S,
  action: (data: z.infer<S>, user: SessionUser) => Promise<R>,
): (payload: unknown) => Promise<R | ActionState>;
```

行为与 `validatedActionWithUser` 一致（`getSessionUser()` → `safeParse(payload)` → 校验失败返回 `{ error: '输入有误', fieldErrors }`），区别只在于**直接接收对象**而不是 `FormData`。客户端用 `startTransition(() => action(payload))` 调用，`payload` 由 React 序列化（JSON 可表达的嵌套结构）。

### 0.2 `ActionState` 扩展

```ts
// lib/auth/types.ts
export type ActionState<T = never> =
  | { success: string; data?: T }
  | { error: string; code?: ActionErrorCode; fieldErrors?: Record<string, string[]> };
```

`data` 只承载 UI 立即需要的结构化结果（`articleId` / `savedAt` / `page` / `pageOrder`），不改变既有调用点的类型兼容性（既有 Action 不传 `data`）。

## 1. Server Action 契约（`lib/article/actions.ts`）

### 1.1 `createArticleAction`

| 项 | 契约 |
|---|---|
| 入参 | `{ orgId: uuid, projectId: uuid, title: string(1–60), folderId?: uuid \| null }` |
| 权限 | `article.write` |
| 事务内步骤 | ① `folderId` 为空 → 找 `folder(kind=1, name='默认分类', parent_id IS NULL)`，无则建（`sort = max+1`）；② 给了 `folderId` → 校验属于同 org/project、`kind=1`、未软删；③ 插入 `article`（`title`、`folder_id`、`content = 空白一页`、`plain_text = ''`、`created_by`、`updated_at = now()`）；④ 记 `CREATE_ARTICLE` |
| 成功 | `{ success: '谱文已创建', data: { articleId } }` |
| 失败 | `validation`（标题空/超长）、`forbidden`、`not_found`（分类不存在） |

### 1.2 `updateArticleTitleAction`

| 项 | 契约 |
|---|---|
| 入参 | `{ orgId, articleId, title: string(1–60) }` |
| 权限 | `article.write` |
| 步骤 | 单事务：锁定读 → 更新 `title` 与 `updated_at` → 记 `UPDATE_ARTICLE` |
| 成功 | `{ success: '标题已保存' }` |
| 失败 | `validation`（留空/超长，就近提示，不回退旧值）、`not_found`、`forbidden` |

### 1.3 `moveArticleAction`

| 项 | 契约 |
|---|---|
| 入参 | `{ orgId, articleId, folderId: uuid \| null }` |
| 权限 | `article.write` |
| 步骤 | 校验目标分类（`null` = 未分类）→ 更新 `folder_id` 与 `updated_at` |
| 成功 | `{ success: '已移动到新分类' }` |
| 失败 | `not_found`、`validation`（分类类型不是谱文分类） |

### 1.4 `deleteArticleAction`

| 项 | 契约 |
|---|---|
| 入参 | `{ orgId, articleId }` |
| 权限 | `article.write` |
| 事务内步骤 | ① 锁定读 `article`；② 引用检查见 §1.10（`book_catalog` 且 `book` 未软删）→ 有引用则 `catalog_referenced`；③ 软删 `article`（`deleted_at = now()`）；④ 记 `DELETE_ARTICLE`；⑤ 事务提交后对文档里的 pathname 调 `MediaStore.delete()`（尽力而为，失败只记日志） |
| 成功 | `{ success: '谱文已删除' }` |
| 失败 | `catalog_referenced`、`not_found`、`forbidden` |

> 确认弹窗要显示的「页数 / 图片数 / 是否被编目引用」由 **RSC 打开确认框前**用只读查询算（§1.10），不进 Action 返回值——避免「点了删除才知道有几页」。

### 1.5 `saveArticlePageAction`（核心）

| 项 | 契约 |
|---|---|
| 入参 | `{ orgId, articleId, pageId: string, doc: JSONContent }`（`doc` 先过 `articlePageDocSchema` 白名单校验） |
| 权限 | `article.write` |
| 事务内步骤 | ① `SELECT … FROM article WHERE id=? AND organization_id=? AND deleted_at IS NULL FOR UPDATE`；② `parseArticleContent` → 找到 `pageId`，找不到则 `page_not_found`（拒绝整次提交，不新增页、不清空内容，FR-021）；③ 替换该页 `doc`；④ `derivePlainText` 写 `plain_text`；⑤ `updated_at = now()`；⑥ 记 `UPDATE_ARTICLE` |
| 成功 | `{ success: '已保存', data: { savedAt: ISO, page: { id, doc } } }` |
| 失败 | `validation`（节点/mark 白名单、单页 >6 图、`pathname` 前缀不属于本谱文）、`page_not_found`、`not_found`、`forbidden` |
| 并发 | 同页后写覆盖先写（ADR 0002）；不同页互不影响（各自只替换自己的项） |
| 回显 | 客户端在「该页已无未提交改动」时用 `data.page` 对齐本地（FR-017）；**不使用 RSC 数据回灌编辑器**（research.md §6） |
| 不做 | 不设正文字数上限（规格要求超长正文完整保存） |

### 1.6 `addArticlePageAction`

| 项 | 契约 |
|---|---|
| 入参 | `{ orgId, articleId }`（只在末尾追加；规格未要求「在某页之后插入」，不新增 `afterPageId`） |
| 权限 | `article.write` |
| 步骤 | 锁定读 → `pages.length >= 100` 则 `max_pages` → 追加空白页（页 `id` 由**服务端**生成）→ `updated_at` |
| 成功 | `{ success: '已添加一页', data: { pageId, pageOrder: string[] } }` |
| 失败 | `max_pages`、`not_found`、`forbidden` |

### 1.7 `deleteArticlePageAction`

| 项 | 契约 |
|---|---|
| 入参 | `{ orgId, articleId, pageId }` |
| 权限 | `article.write` |
| 步骤 | 锁定读 → `pages.length === 1` 则 `last_page` → 移除该页 → 重算 `plain_text` 与 `updated_at` → 提交后删除该页独有图片的字节（`isReferenced(pathname, content)` 判定） |
| 成功 | `{ success: '已删除该页', data: { pageOrder: string[] } }` |
| 失败 | `last_page`、`page_not_found`、`forbidden` |

### 1.8 `reorderArticlePagesAction`

| 项 | 契约 |
|---|---|
| 入参 | `{ orgId, articleId, pageIds: string[] }`（长度必须等于当前页数，元素集合必须一致） |
| 权限 | `article.write` |
| 步骤 | 锁定读 → 校验集合相等 → 按 `pageIds` 重排 → `updated_at` |
| 成功 | `{ success: '页序已保存', data: { pageOrder: string[] } }` |
| 失败 | `validation`（集合不一致）、`not_found`、`forbidden` |

### 1.9 分类：复用既有 Action，**签名与权限都不变**

| Action | 变化 |
|---|---|
| `createFolderAction` / `renameFolderAction` / `deleteFolderAction` | **无变化**。权限继续是 `project.write`（FR-036 禁止本期改变能力矩阵；`editor` 因此看不到分类管理入口，见 §4） |
| `deleteFolderAction` | 返回仍是 `{ success: '分类已删除，N 项内容已移入未分类' }`（不返回计数）。确认框需要的「分类数 / 受影响谱文数 / 图片数」由 §1.10 的只读查询提供 |
| 级联语义 | 复用 `lib/folder/services.ts:204` 的 `deleteFolderInTransaction`：单事务内 BFS 子树、把 `lineages/articles/books` 的 `folder_id` 置空、软删分类、写 `DELETE_FOLDER` 日志 |

### 1.10 新增只读查询（`lib/db/queries/articles.ts`，供 RSC 用）

| 查询 | 入参 | 返回 | 用途 |
|---|---|---|---|
| `getArticleDeletePreview(userId, orgId, articleId)` | — | `{ pageCount, imageCount, catalogReferences: { bookName, catalogName }[] }` | 删除确认框（FR-004、SC-005） |
| `getFolderDeletePreview(userId, orgId, folderId)` | — | `{ folderCount, articleCount, imageCount }` | 分类删除确认框（FR-005、SC-005） |

两者都走 `withOrg`，用 SQL 聚合（`jsonb_array_length(content -> 'pages')` 与 `content::text` 里的节点计数用 `jsonb_path_query_array` 或应用层 `countImages`），**不改 `deleteFolderAction` 的返回契约**。

### 1.11 与 `docs/architecture/05-接口与集成设计.md` §6.6 目标清单的映射

| 目标 Action（05 §6.6，未导出） | 本期落点 |
|---|---|
| `createArticle` | `createArticleAction`（1.1） |
| `updateArticle`（title/content） | 拆成 `updateArticleTitleAction`（1.2）与 `saveArticlePageAction`（1.5）——正文按页保存，不支持整篇覆盖 |
| `deleteArticle` | `deleteArticleAction`（1.4） |
| `createBook` / `updateBook` / `deleteBook` / `addCatalogItem` / `updateCatalogItem` / `moveCatalogItem` / `removeCatalogItem` | **不在本期**（谱书与编目属于另一条线，FR-043） |

本期实际新增 8 个谱文 Action + 2 个只读查询；`docs/architecture/05-接口与集成设计.md` 的同步在实现 PR 里做（见 [plan.md](../plan.md) 的 Documentation 树）。

## 2. Route Handler 契约

| 路由 | 生效条件 | 方法 | 职责 | 鉴权 |
|---|---|---|---|---|
| `/api/blob/upload` | `mediaMode === 'blob'` | `POST` | `handleUpload({ onBeforeGenerateToken, onUploadCompleted })`：回调里 `getSessionUser()` → 从 `tokenPayload { orgId, articleId }` 反查 `article` 拿 `projectId` → 校验成员 + `article.write` → 校验 pathname 前缀 `articles/<orgId>/<articleId>/` → 返回 `{ allowedContentTypes: ['image/jpeg','image/png','image/webp'], maximumSizeInBytes: 10 * 1024 * 1024, addRandomSuffix: false, tokenPayload }` | `getSessionUser()` + `getOrgRole` |
| `/api/media/upload` | `mediaMode === 'fs'`（本地/CI） | `POST` | multipart 落盘 `.data/media/<pathname>`；**同样校验** MIME（JPG/PNG/WebP 魔数）、体积 ≤10MB、pathname 前缀与成员关系 | 同上 |
| `/api/media/[...key]` | **两种模式都注册** | `GET` | 读取授权：校验 `key` 形如 `articles/<orgId>/<articleId>/<file>` → 校验会话 + 该 `orgId` 成员 + 谱文未软删 → Blob 模式回 `302` + `Location: <私有桶签名 URL>`（`MediaStore.readRedirect`），兜底驱动回字节（`Content-Type` 按扩展名 + `nosniff`）；一律 `Cache-Control: no-store` | `getSessionUser()` + `getOrgRole` + `getArticleScope` |

**共同约束**：
- 全部走 `withApiLogging('<route>', handler)`；返回显式 DTO；错误体英文 JSON + 明确状态码（401 / 404 / 413 / 415）。
- **鉴权失败与资源不存在一律 404**（与 FR-034 一致，不泄露存在性）。
- `mediaMode` 不匹配的**上传**路由在 handler 内直接返回 404（App Router 不能在运行时「不注册」路由）。
- 读取代理不含任何写入能力；写字节只经上传通道。

## 3. 媒体存储接口（`lib/article/media/store.ts`）

```ts
export type MediaMode = 'blob' | 'fs';

export interface MediaStore {
  readonly mode: MediaMode;
  /** 读取字节（blob：私有 store 服务端读取；fs：读 `.data/media/`）。 */
  read(pathname: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /** 删除字节；失败抛错由调用方记日志，不回滚业务事务。 */
  delete(pathname: string): Promise<void>;
  /**
   * 能直连存储的驱动（blob）回一个短命私有签名 URL，读取路由据此 302，
   * 字节不再经过函数；fs 回 `null`，继续由路由自己发字节（ADR 0019）。
   */
  readRedirect(pathname: string): Promise<string | null>;
}

/** 由 lib/config.ts 的配置判定，只此一处决定模式（F7）。 */
export function getMediaStore(): MediaStore;
```

- `blob-store.ts`：`read` 用 `get(pathname, { access: 'private' })`；`delete` 用 `del()`；`readRedirect` 走 `read-url.ts`（delegation 按进程缓存 + `presignUrl` 本地 HMAC，单张 URL 5 分钟）。上传令牌由 `/api/blob/upload` 的 `handleUpload` 签发（**不提供 `getSignedToken`**，那是 `handleUploadPresigned` 的用法；`clientSigningToken` 只在服务端签 URL，不出响应）。
- `token.ts`：`blobReadWriteToken()` 单独成模块（只从 `lib/config.ts` 取值，F7），供 store、签名 helper 与上传路由共用，避免 store ↔ read-url 循环 import。
- `fs-store.ts`：`fs.readFile('.data/media/' + pathname)`；`delete` 用 `fs.rm`；写入由 `/api/media/upload` 负责。
- 客户端通过 RSC props 拿到 `mediaMode`，只决定**上传**走 `upload()`（blob）还是 `POST /api/media/upload`（fs）；**`<img>` 的 src 永远是 `/api/media/<pathname>`**，是 302 还是字节由服务端驱动决定，客户端不感知签名 URL。

## 4. 界面契约（`components/article/**`）

| 区域 | 契约 | 依据 |
|---|---|---|
| 顶栏 | 返回 / 标题（可改，失焦或回车提交）/ **只读地区**（`project.countries_regions \|\| '中国'`）/ 保存状态（保存中 · 已保存 时间 · 保存失败 + 重试）/「立即保存」；**无**分享、发布、导出、版式入口 | FR-001、FR-010、FR-012、FR-014、FR-041、FR-042、SC-011 |
| 左：分类树 | 复用 `folder` 能力（`kind=1`），显示篇数；当前谱文所在分类高亮；「未分类」固定项；**「新建/重命名/删除分类」入口按 `hasPermission(role,'project.write')` 显隐**（编辑者看不到） | FR-005、FR-040、FR-036 |
| 中：编辑区 | TipTap 编辑器，单页渲染；`undoRedo` 生效（FR-019）；`viewer` 时 `editable: false` 且不渲染任何写入按钮 | FR-013、FR-019、FR-033、FR-034 |
| 右：页缩略图 | 页序列表 +「+添加页」+ 拖拽排序；缩略图用首屏文本摘要（不渲染整页 DOM） | FR-012、FR-021、FR-023 |
| 图片 | 光标处插入块级图；三档宽度（小/中/整宽，默认整宽）；客户端预校验 MIME/10MB/单页 6 张，**服务端权威校验** | FR-025–FR-028 |
| 离开保护 | 应用内离开 `await` 保存后导航（失败停留）；关闭/刷新用 `beforeunload` 原生确认 | FR-003、FR-016 |
| 空态 | 新建或内容为空时显示一页空白页 + 「输入文字」引导 | FR-018 |
| 窄屏 | 两侧栏折叠为抽屉，功能不缺 | FR-012 |

## 5. 错误码与中文文案（`lib/article/constants.ts`，码统一小写）

| code / reason | 文案 | 触发 |
|---|---|---|
| `forbidden` | 你没有撰写谱文的权限（与 `PERMISSION_DENIED_MESSAGES['article.write']` 同串） | 无 `article.write` |
| `not_found` | 谱文不存在或已删除 | 不存在 / 非本组织 / 已软删 |
| `page_not_found` | 这一页已被删除，你的文字仍保留在本地，请刷新后重新添加一页 | 保存的 `pageId` 不在文档里（FR-021：拒绝提交、保留内容、不凭空生成页） |
| `last_page` | 至少要保留一页 | 删最后一页 |
| `max_pages` | 一篇谱文最多 100 页 | 加页超限 |
| `too_many_images` | 每页最多 6 张图片 | 插入第 7 张（服务端权威） |
| `invalid_image` | 只支持 JPG / PNG / WebP，单张不超过 10MB | MIME / 体积 |
| `invalid_doc` | 内容格式不正确，请刷新页面后重试 | 白名单校验失败 / `schemaVersion` 不匹配 |
| `catalog_referenced` | 这篇谱文被谱书编目引用，请先在谱书里移除编目 | 删除前引用检查 |
