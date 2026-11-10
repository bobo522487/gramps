# 关键代码索引（Code Index）

> **回答什么问题**：常见任务对应的关键文件、函数、组件在哪。
> **读者**：开发 · AI Agent　**长度上限**：5 页
> **不写什么**：接口契约（`docs/api.md`）、表结构（`docs/data-model.md`）、模块流程（`docs/modules/`）、操作命令（`docs/development.md`）。

本页按「日常最常查」排序。链接指向仓库源码（相对本文件的 `../` 路径），行号对应当前快照。

## 1. 基础设施

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `getServerConfig()` | [lib/config.ts:116](../lib/config.ts#L116) | Zod 校验环境变量，返回 `ServerConfig` |
| `getMediaMode()` | [lib/config.ts:89](../lib/config.ts#L89) | `blob` / `fs` |
| `withOrg<T>()` | [lib/db/drizzle.ts:83](../lib/db/drizzle.ts#L83) | `SET LOCAL role` + `app.user_id` + 事务 |
| `queryRows<T>()` | [lib/db/drizzle.ts](../lib/db/drizzle.ts) | 抹平 postgres.js / pg 返回形状 |
| `withOrgWrite<T>()` | [lib/db/write.ts:15](../lib/db/write.ts#L15) | 写事务 + 事务内权限复核 |
| `requireOrgPermission()` | [lib/db/guards.ts:12](../lib/db/guards.ts#L12) | 角色 → 业务权限判断 |
| `isUniqueViolation()` 等 | [lib/db/errors.ts](../lib/db/errors.ts) | SQLSTATE 与约束名识别 |
| `getAuthDb()` | [lib/db/auth-db.ts:55](../lib/db/auth-db.ts#L55) | 认证专用连接（`auth_service`） |
| `withApiLogging()` | [lib/api.ts:17](../lib/api.ts#L17) | Route Handler 日志/异常包装 |
| `revalidateWholeConsole()` | [lib/console/revalidate.ts:19](../lib/console/revalidate.ts#L19) | 失效 `/dashboard` 布局 |
| `runWithRequestContext()` / `addLogContext()` | [lib/server/request-context.ts](../lib/server/request-context.ts) | AsyncLocalStorage 日志上下文 |
| `generatePublicId()` / `isPublicId()` / `isUuid()` | [lib/ids.ts](../lib/ids.ts) | 公开 ID 与参数校验 |
| `fetcher<T>()` | [lib/fetcher.ts](../lib/fetcher.ts) | 客户端 fetch（非 2xx 抛错） |
| `queryKeys` | [lib/query-keys.ts](../lib/query-keys.ts) | TanStack Query key 工厂 |
| `cn()` | [lib/utils.ts:4](../lib/utils.ts#L4) | className 合并 |

## 2. 认证与权限

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `getSessionUser()` | [lib/auth/context.ts:15](../lib/auth/context.ts#L15) | `cache()` 包装的当前用户 |
| `requireUser()` | [lib/auth/context.ts:31](../lib/auth/context.ts#L31) | 未登录重定向 |
| `requireOrgContext()` | [lib/auth/context.ts:61](../lib/auth/context.ts#L61) | 解析 orgSlug + 成员校验 |
| `requireProjectContext()` | [lib/auth/context.ts:102](../lib/auth/context.ts#L102) | 解析 projectRef + 项目 scope |
| `hasPermission()` | [lib/auth/permissions.ts:19](../lib/auth/permissions.ts#L19) | 角色 → 业务权限 |
| `getOrgRoleInTx()` | [lib/auth/permissions.ts:40](../lib/auth/permissions.ts#L40) | 事务内取角色 |
| `getOrgRole()` | [lib/auth/permissions.ts:58](../lib/auth/permissions.ts#L58) | 非事务取角色 |
| `checkOrgPermission()` | [lib/auth/permissions.ts:66](../lib/auth/permissions.ts#L66) | 返回中文拒绝文案 |
| `validatedActionWithUser()` | [lib/auth/middleware.ts](../lib/auth/middleware.ts) | session + Zod 包装 |
| `getAuth()` | [lib/auth/better-auth.ts:67](../lib/auth/better-auth.ts#L67) | Better Auth 单例 |
| `accessControl` / `roles` | [lib/auth/access-control.ts](../lib/auth/access-control.ts) | 权限语句与矩阵 |
| `signIn` / `signUp` / `signOut` | [lib/auth/actions/session.ts](../lib/auth/actions/session.ts) | 认证 Action |
| `updateAccount` / `updatePassword` / `deleteAccount` | [lib/auth/actions/account.ts](../lib/auth/actions/account.ts) | 账号 Action |

## 3. 组织 / 项目 / 分类

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `createOrgAction` | [lib/org/actions.ts](../lib/org/actions.ts) | 创建组织 |
| `renameOrgAction` / `deleteOrgAction` | [lib/org/actions.ts](../lib/org/actions.ts) | 重命名 / 归档 |
| `inviteOrgMember` | [lib/org/actions.ts](../lib/org/actions.ts) | 签发邀请，返回一次性 URL |
| `previewInvitation` | [lib/org/invitations.ts](../lib/org/invitations.ts) | 邀请预览 |
| `acceptInviteAction` | [lib/org/actions.ts](../lib/org/actions.ts) | 接受邀请 |
| `listOrgMembers` | [lib/org/members.ts](../lib/org/members.ts) | 业务 + 认证库联合读取 |
| `issueInvitation()` | [lib/org/invitations.ts](../lib/org/invitations.ts) | token 生成 / 落库 / 重发 |
| `createProjectInTransaction` | [lib/project/services.ts](../lib/project/services.ts) | 项目创建（ref 重试） |
| `updateProjectInTransaction` | [lib/project/services.ts](../lib/project/services.ts) | 白名单更新 |
| `deleteProjectInTransaction` | [lib/project/services.ts](../lib/project/services.ts) | 13 张子表探测后删除 |
| `createProjectAction` 等 | [lib/project/actions.ts](../lib/project/actions.ts) | 项目 Action |
| `createFolderInTransaction` | [lib/folder/services.ts](../lib/folder/services.ts) | 分类创建（同名冲突） |
| `deleteFolderInTransaction` | [lib/folder/services.ts](../lib/folder/services.ts) | 内容移到未分类 |
| `getOrgsForUser` | [lib/db/queries/organizations.ts](../lib/db/queries/organizations.ts) | 组织切换器数据 |
| `getProjects` | [lib/db/queries/projects.ts](../lib/db/queries/projects.ts) | 项目列表 |
| `getProjectScopeByRef` | [lib/db/queries/projects.ts](../lib/db/queries/projects.ts) | 公开 ref → scope |
| `getFolders` | [lib/db/queries/folders.ts](../lib/db/queries/folders.ts) | 分类列表 |

## 4. 谱系后端

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `createLineageInTransaction` | [lib/lineage/services.ts](../lib/lineage/services.ts) | 谱系创建 |
| `updateLineageInTransaction` | [lib/lineage/services.ts](../lib/lineage/services.ts) | 白名单更新 |
| `deleteLineageInTransaction` | [lib/lineage/services.ts](../lib/lineage/services.ts) | 引用检查 + 先删节点 |
| `withCreateWrite()` | [lib/lineage/lineage-write.ts](../lib/lineage/lineage-write.ts) | `lineage.write` + `FOR UPDATE` |
| `createRootNodeInTransaction` | [lib/lineage/node-services.ts](../lib/lineage/node-services.ts) | 始祖 |
| `addChildInTransaction` | [lib/lineage/node-services.ts](../lib/lineage/node-services.ts) | 子女 |
| `addSiblingInTransaction` | [lib/lineage/node-services.ts](../lib/lineage/node-services.ts) | 兄弟 |
| `addSpouseInTransaction` | [lib/lineage/node-services.ts](../lib/lineage/node-services.ts) | 显式失败（未接线） |
| `updateNodeInTransaction` | [lib/lineage/node-services.ts](../lib/lineage/node-services.ts) | 姓名/性别/显示名 |
| `deleteNodeInTransaction` | [lib/lineage/node-services.ts](../lib/lineage/node-services.ts) | 子树删除 |
| `moveNodeInTransaction` | [lib/lineage/node-services.ts](../lib/lineage/node-services.ts) | 校验后失败 |
| `nextPath()` / `recordNode()` | [lib/lineage/node-services.ts](../lib/lineage/node-services.ts) | 稀疏 ltree 路径 / 三表写入 |
| `buildDeleteConfirmMessage()` | [lib/lineage/subtree.ts](../lib/lineage/subtree.ts) | 删除确认文案 |
| `getNodes()` | [lib/db/queries/nodes.ts](../lib/db/queries/nodes.ts) | 节点 + 事实 join + 投影 |
| `getLineages` / `getLineageById` | [lib/db/queries/lineages.ts](../lib/db/queries/lineages.ts) | 谱系列表 / 详情 |
| `getLineageNav()` | [lib/lineage/nav.ts](../lib/lineage/nav.ts) | 侧边栏导航 |

## 5. 谱系前端

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `buildLineageIndex()` | [components/lineage/derived.ts:76](../components/lineage/derived.ts#L76) | 派生索引 / DF 先序 |
| `generationWord()` / `rankLabel()` / `lifeSpan()` | [components/lineage/derived.ts](../components/lineage/derived.ts) | 字辈 / 伯仲 / 生卒 |
| `layoutBookLtr()` | [components/lineage/canvas/layout/book-ltr.ts:44](../components/lineage/canvas/layout/book-ltr.ts#L44) | 横向世系布局 |
| `nextRenderLimit()` / `shouldExtendLimit()` | [components/lineage/canvas/layout/lazy.ts](../components/lineage/canvas/layout/lazy.ts) | 分代懒渲染 |
| `useLineageStore` | [components/lineage/lineage-store.ts](../components/lineage/lineage-store.ts) | Zustand 视图状态 |
| `GenealogyCanvas` | [components/lineage/canvas/genealogy-canvas.tsx](../components/lineage/canvas/genealogy-canvas.tsx) | React Flow 画布 |
| `BookPersonNode` | [components/lineage/canvas/nodes/book-person-node.tsx](../components/lineage/canvas/nodes/book-person-node.tsx) | 人物节点 |
| `BookGenealogyEdge` | [components/lineage/canvas/edges/book-genealogy-edge.tsx](../components/lineage/canvas/edges/book-genealogy-edge.tsx) | 父子连线 |
| `PersonInspector` | [components/lineage/person-inspector.tsx](../components/lineage/person-inspector.tsx) | 人物详情面板 |
| `NodeCommandMenu` | [components/lineage/node-context-menu.tsx](../components/lineage/node-context-menu.tsx) | 右键命令 |
| `NODE_COMMANDS` / `enabledCommands()` | [components/lineage/node-commands.ts](../components/lineage/node-commands.ts) | 命令定义 |

## 6. 谱文后端

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `serializeArticleContent()` | [lib/article/doc.ts:90](../lib/article/doc.ts#L90) | 文档包 → JSON |
| `parseArticleContent()` | [lib/article/doc.ts:230](../lib/article/doc.ts#L230) | 容错解析 |
| `normalizePageDoc()` / `createEmptyPageDoc()` | [lib/article/doc.ts](../lib/article/doc.ts) | 空文档补形 |
| `validateContent()` | [lib/article/mutations.ts:121](../lib/article/mutations.ts#L121) | 整篇白名单校验 |
| `imagePathsOf()` / `isPageReferenced()` | [lib/article/mutations.ts](../lib/article/mutations.ts) | 图片引用分析 |
| `lockArticle()` | [lib/article/mutations.ts](../lib/article/mutations.ts) | 行锁读取正文 |
| `createArticleInTransaction` | [lib/article/services.ts](../lib/article/services.ts) | 创建谱文 |
| `updateArticleTitleInTransaction` | [lib/article/services.ts](../lib/article/services.ts) | 改标题 |
| `moveArticleInTransaction` | [lib/article/services.ts](../lib/article/services.ts) | 移动分类 |
| `deleteArticleInTransaction` | [lib/article/services.ts](../lib/article/services.ts) | 删除 + 图片清理 |
| `saveArticlePageInTransaction` | [lib/article/page-services.ts](../lib/article/page-services.ts) | 页级保存 |
| `addArticlePageInTransaction` | [lib/article/page-services.ts](../lib/article/page-services.ts) | 加页 |
| `deleteArticlePageInTransaction` | [lib/article/page-services.ts](../lib/article/page-services.ts) | 删页 |
| `reorderArticlePagesInTransaction` | [lib/article/page-services.ts](../lib/article/page-services.ts) | 重排（集合必须完全一致） |
| `saveArticlePageAction` | [lib/article/actions.ts](../lib/article/actions.ts) | 保存 Action（不失效） |
| `createSaveState()` | [lib/article/save-state.ts:37](../lib/article/save-state.ts#L37) | 保存状态机 |
| `pendingPageIds()` / `hasUnsettled()` | [lib/article/save-state.ts:89](../lib/article/save-state.ts#L89) | 待保存 / 未落定 |
| `topBarStatus()` / `topBarText()` | [lib/article/save-state.ts:103](../lib/article/save-state.ts#L103) | 顶栏聚合 |
| `derivePlainText()` | [lib/article/doc-view.ts:67](../lib/article/doc-view.ts#L67) | 纯文本摘要 |
| `useArticleAutosave()` | [hooks/use-article-autosave.ts](../hooks/use-article-autosave.ts) | 2s 防抖 / 3s 超时 / 在途去重 |

## 7. 媒体

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `parseMediaPathname()` | [lib/article/media/path.ts:54](../lib/article/media/path.ts#L54) | 四段路径严格校验 |
| `buildMediaPathname()` | [lib/article/media/path.ts:69](../lib/article/media/path.ts#L69) | 拼接 pathname |
| `mediaFilenameFor()` / `contentTypeForMediaPathname()` | [lib/article/media/path.ts](../lib/article/media/path.ts) | 扩展名 / MIME 映射 |
| `sniffImageContentType()` | [lib/article/media/path.ts](../lib/article/media/path.ts) | 魔数嗅探 |
| `mediaUrl()` | [lib/article/media/path.ts](../lib/article/media/path.ts) | 生成 `/api/media/...` |
| `getMediaStore()` | [lib/article/media/store.ts:30](../lib/article/media/store.ts#L30) | fs / blob 选择 |
| `fsMediaStore` | [lib/article/media/fs-store.ts](../lib/article/media/fs-store.ts) | 本地存储 |
| `blobMediaStore` | [lib/article/media/blob-store.ts](../lib/article/media/blob-store.ts) | Vercel Blob |
| `verifyBlobToken()` | [lib/article/media/token.ts](../lib/article/media/token.ts) | token 校验 |
| `readUrlFor()` | [lib/article/media/read-url.ts](../lib/article/media/read-url.ts) | 读取 URL / 302 |
| `uploadArticleImage()` | [components/article/editor/image-upload.ts](../components/article/editor/image-upload.ts) | 客户端上传分流 |

## 8. 谱文前端

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ArticleWorkspace` | [components/article/article-workspace.tsx](../components/article/article-workspace.tsx) | 列表 + 分类树 |
| `ArticleEditorShell` | [components/article/article-editor-shell.tsx](../components/article/article-editor-shell.tsx) | 编辑器外壳 / 离开保护 |
| `TipTapEditor` | [components/article/editor/tiptap-editor.tsx](../components/article/editor/tiptap-editor.tsx) | 编辑器实例 |
| `Toolbar` | [components/article/editor/toolbar.tsx](../components/article/editor/toolbar.tsx) | 分组工具栏 |
| `ArticleImage` | [components/article/editor/article-image-node.tsx](../components/article/editor/article-image-node.tsx) | 图片节点扩展 |
| `sanitizePasteHtml()` | [components/article/editor/paste-filter.ts](../components/article/editor/paste-filter.ts) | 粘贴过滤 |
| `PageStrip` | [components/article/page-strip.tsx](../components/article/page-strip.tsx) | 页缩略/排序 |
| `SaveStatus` | [components/article/save-status.tsx](../components/article/save-status.tsx) | 保存状态 UI |
| `ArticleFolderTree` | [components/article/article-folder-tree.tsx](../components/article/article-folder-tree.tsx) | 分类树 |

## 9. 页面与 Route Handler

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| 根布局 | [app/layout.tsx](../app/layout.tsx) | session + orgs + providers |
| 组织布局 | [app/(dashboard)/dashboard/org/[orgSlug]/layout.tsx](../app/%28dashboard%29/dashboard/org/%5BorgSlug%5D/layout.tsx) | `requireOrgContext` + 项目列表 |
| 项目布局 | [app/(dashboard)/dashboard/project/[projectRef]/layout.tsx](../app/%28dashboard%29/dashboard/project/%5BprojectRef%5D/layout.tsx) | `requireProjectContext` |
| 谱系详情页 | [app/(dashboard)/dashboard/project/[projectRef]/lineages/[lineageId]/page.tsx](../app/%28dashboard%29/dashboard/project/%5BprojectRef%5D/lineages/%5BlineageId%5D/page.tsx) | 画布数据 |
| 谱文编辑页 | [app/(dashboard)/dashboard/project/[projectRef]/articles/[articleId]/page.tsx](../app/%28dashboard%29/dashboard/project/%5BprojectRef%5D/articles/%5BarticleId%5D/page.tsx) | 文档 + 权限 + 媒体模式 |
| `GET /api/health` | [app/api/health/route.ts](../app/api/health/route.ts) | 健康检查 |
| `GET /api/user` | [app/api/user/route.ts](../app/api/user/route.ts) | 当前用户 |
| `GET /api/orgs` | [app/api/orgs/route.ts](../app/api/orgs/route.ts) | 用户组织 |
| `GET /api/orgs/[orgId]/projects` | [app/api/orgs/[orgId]/projects/route.ts](../app/api/orgs/%5BorgId%5D/projects/route.ts) | 组织项目 |
| `POST /api/media/upload` | [app/api/media/upload/route.ts](../app/api/media/upload/route.ts) | fs 上传 |
| `GET /api/media/[...key]` | [app/api/media/[...key]/route.ts](../app/api/media/%5B...key%5D/route.ts) | 私有图片代理 |
| `POST /api/blob/upload` | [app/api/blob/upload/route.ts](../app/api/blob/upload/route.ts) | Blob token |

## 10. 数据定义与 DB 函数

| 符号 | 位置 |
| --- | --- |
| 表定义总出口 | [lib/db/schema/index.ts](../lib/db/schema/index.ts) |
| 认证表 | [lib/db/schema/auth.ts](../lib/db/schema/auth.ts) |
| 组织/成员/邀请 | [lib/db/schema/org.ts](../lib/db/schema/org.ts) |
| 云谱空间/分类 | [lib/db/schema/project.ts](../lib/db/schema/project.ts) |
| 谱系/节点 | [lib/db/schema/lineage.ts](../lib/db/schema/lineage.ts) |
| 人物/姓名 | [lib/db/schema/person.ts](../lib/db/schema/person.ts) |
| 家庭/亲子 | [lib/db/schema/family.ts](../lib/db/schema/family.ts) |
| 事件 | [lib/db/schema/event.ts](../lib/db/schema/event.ts) |
| 谱文/谱书 | [lib/db/schema/content.ts](../lib/db/schema/content.ts) |
| 谱书导出 | [lib/db/schema/book-export.ts](../lib/db/schema/book-export.ts) |
| TS ↔ SQL 关系 | [lib/db/schema/relations.ts](../lib/db/schema/relations.ts) |
| SQL 基线 | [lib/db/migrations/0000_target_schema.sql](../lib/db/migrations/0000_target_schema.sql) |

## 11. 脚本

| 脚本 | 位置 | 用途 |
| --- | --- | --- |
| F6 文件行数 | [scripts/check-file-size.mjs](../scripts/check-file-size.mjs) | 普通文件 ≤400 行 |
| F7 env 访问 | [scripts/check-env-access.mjs](../scripts/check-env-access.mjs) | 仅 `lib/config.ts` 可读 env |
| 文档检查 | [scripts/check-docs.mjs](../scripts/check-docs.mjs) | 文档链接/结构 |
| 角色开通 | [scripts/provision-roles.mjs](../scripts/provision-roles.mjs) | 迁移前创建角色与授权 |
| 目标态校验 | [scripts/verify-target-schema.mjs](../scripts/verify-target-schema.mjs) | DDL/RLS/parity/EXPLAIN |
| 部署自检 | [scripts/verify-deployment.mjs](../scripts/verify-deployment.mjs) | 头/健康/角色/函数 |
| 清库 | [scripts/reset-target-db.mjs](../scripts/reset-target-db.mjs) | 重建模式 |
| 诊断 | [scripts/diagnose-*.mjs](../scripts/) | 迁移/角色/连接排障 |
