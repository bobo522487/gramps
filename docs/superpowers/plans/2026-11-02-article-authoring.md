# 谱文录入与多页编辑实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「谱文」从「功能尚未开放」的占位页变成可用的写作线——三区编辑器（左分类树 / 中单页画布 / 右页缩略图 + 顶栏）、多页、正文插图、2 秒自动保存，且按规格**不交付任何版式能力**。

**Architecture:** 零迁移。`article.content` 从单文档改为分页文档包 `{ schemaVersion: 1, pages: [{ id, doc }] }`，页序即数组顺序；正文用 TipTap 3（兑现 ADR 0010），图片字节进 Vercel Blob 私有 store（生产）/ `.data/media`（本地与 CI），**读取统一走 `/api/media/<pathname>` 服务端代理**，每请求重新授权；写入一律 Server Action，保存页在单事务内 `SELECT … FOR UPDATE`。

**Tech Stack:** TypeScript 7 · React 19 · Next.js 16 App Router · TipTap 3（6 包）· `@vercel/blob` ≥2.3 · Drizzle ORM（零迁移）· Vitest（单测 + 真实 PG 集成）· Playwright

**Spec:** [specs/002-article-authoring/spec.md](../../../specs/002-article-authoring/spec.md)（设计记录：[plan.md](../../../specs/002-article-authoring/plan.md) · [research.md](../../../specs/002-article-authoring/research.md) · [data-model.md](../../../specs/002-article-authoring/data-model.md) · [contracts](../../../specs/002-article-authoring/contracts/actions-and-permissions.md) · [quickstart](../../../specs/002-article-authoring/quickstart.md) · [tasks.md](../../../specs/002-article-authoring/tasks.md)）

> **任务索引**：本文件是唯一执行清单，任务编号 T001–T050 与 [tasks.md](../../../specs/002-article-authoring/tasks.md) 一一对应；tasks.md 只做索引，不另起步骤。

## Global Constraints

- 单文件 ≤400 行（`pnpm arch:check`）；只在 `lib/config.ts` 读 `process.env`（F7）。
- 权限一律 `hasPermission(role, '<permission>')`；**本期不改权限枚举、不改角色能力矩阵**（FR-036）——谱文分类写权限仍是 `project.write`，`editor` 看不到分类管理入口。
- 面向用户的文案一律简体中文，错误不抛堆栈；非成员与不存在一律 404（不泄露存在性）。
- **零迁移、零新表**：不改 `lib/db/migrations/`，不改 RLS，不加索引。
- **保存路径不得调 `revalidateWholeConsole()`**：只有新建/改标题/移分类/删除谱文才失效缓存（执行时定为 `revalidateWholeConsole()`，理由见文末「执行期裁决」）。
- 不写裸色值（`tests/design-system.test.ts` 会失败）；不引入编辑器外的状态库（zustand 仍只用于谱系工作区）。
- 新依赖按 ADR 0009 §1 记账（PR 描述写清替换掉的自写代码）。
- 提交前 `pnpm check && pnpm typecheck && pnpm test` 全绿；文档改动后 `pnpm docs:check --strict`。

## Review Focus

以下六项没有任何单测能完整覆盖，实施时逐条人工确认：

1. **自动保存与 RSC 边界**：保存页/加删页/重排页之后，编辑器内容**不得**被服务端快照覆盖（首次挂载才用 RSC 初始化）。
2. **离开保护**：应用内离开先 `await` 保存再导航（失败停留）；关闭标签用 `beforeunload` 原生确认——浏览器无交互时不拦截，这是已知限制。
3. **媒体读取授权**：`/api/media/<pathname>` 对非成员、跨组织、非本谱文前缀一律 404；响应里不出现存储令牌或带能力的 URL。
4. **`ActionState` 通道**：`validatedActionWithUserObject` 能传嵌套 `doc`/`pageIds`/`null`；既有 Action 的返回类型不受 `data` 字段影响。
5. **ADR 0010 状态句**：删「尚未安装」时**必须保留 `决策 ≠ 现在安装` 字面串**，否则 `tests/docs-consistency.test.ts` 的依赖黑名单断言会红。
6. **权限矩阵不变**：`tests/permissions.test.ts` / `tests/access-control.test.ts` 不应有任何改动；若为了本期功能去改它们，说明越界了。

---

### Task 1: 依赖、ADR 与工具约束（T001–T004）

**Files:**
- Modify: `package.json`、`pnpm-lock.yaml`
- Modify: `biome.json`
- Modify: `docs/decisions/0010-rich-text-editor-selection.md`、`docs/decisions/README.md`
- Create: `docs/decisions/0019-media-storage.md`

**Interfaces:**
- Produces: 可用的 `@tiptap/react` / `@tiptap/core` / `@tiptap/pm` / `@tiptap/starter-kit` / `@tiptap/extension-text-style` / `@tiptap/extension-image` / `@vercel/blob`；ADR 0019 编号 0019（§1 索引行 ADR-29）

- [x] **Step 1: 装依赖**

Run: `pnpm add @tiptap/react @tiptap/core @tiptap/pm @tiptap/starter-kit @tiptap/extension-text-style @tiptap/extension-image @vercel/blob`
Expected: 六个 TipTap 包版本一致（3.x），`@vercel/blob` ≥2.3

- [x] **Step 2: 改 ADR 0010 状态句**

把「依赖尚未安装」改为「本期安装」，**逐字保留 `决策 ≠ 现在安装` 这一串**（测试靠它跳过依赖黑名单）；同步 `docs/decisions/README.md` 的 ADR-12 行。

- [x] **Step 3: 写 ADR 0019**

内容按 `docs/decisions/README.md` 的模板：背景（仓库无对象存储，规格把图片定为 P0）／决策（私有 Blob + 服务端代理读取 + fs 兜底 + 客户端直传）／后果（正：每请求授权、本地可验；负：带宽经函数、孤儿字节）／放弃的方案（公有桶、签名 URL、base64 内嵌）／重估触发。并在 `docs/decisions/README.md` §1 索引与 §2 表格各加一行。

- [x] **Step 4: biome 限制编辑器依赖**

在 `biome.json` 的 `noRestrictedImports` 里加一条：`@tiptap/*` 只允许 `lib/article/**` 与 `components/article/editor/**`。

- [x] **Step 5: 门禁**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm docs:check --strict`
Expected: 全绿（`tests/docs-consistency.test.ts` 的 ADR 0010 用例通过）

- [x] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml biome.json docs/decisions/
git commit -m "chore(deps): 安装 TipTap 3 与 @vercel/blob，补 ADR 0019 媒体存储"
```

---

### Task 2: 配置、覆盖率与 Action 通道（T005–T008）

**Files:**
- Modify: `lib/config.ts`、`.gitignore`、`vitest.coverage.config.ts`
- Modify: `lib/auth/types.ts`、`lib/auth/middleware.ts`

**Interfaces:**
- Produces: `mediaMode: 'blob' | 'fs'`（来自 `getServerConfig()` 或既有导出风格）；`ActionState<T>` 的可选 `data`；`validatedActionWithUserObject<S, R>(schema, action): (payload: unknown) => Promise<R | ActionState>`

- [x] **Step 1: 写失败测试（包装器）**

在 `tests/article-schemas.test.ts` 里加一条：对象入参（含嵌套对象与 `null`）能被 `validatedActionWithUserObject` 接受；`FormData` 通道保持原行为。Run 确认失败。

- [x] **Step 2: 扩展 `ActionState`**

`lib/auth/types.ts`：`{ success: string; data?: T } | { error: string; code?: ActionErrorCode; fieldErrors?: Record<string, string[]> }`；既有调用点零改动。

- [x] **Step 3: 新增对象入参包装器**

`lib/auth/middleware.ts`：与 `validatedActionWithUser` 并列，逻辑相同但直接 `safeParse(payload)`；未登录与校验失败返回中文 `ActionState`。

- [x] **Step 4: 配置与忽略项**

`lib/config.ts` 加可选 `BLOB_READ_WRITE_TOKEN` 与 `mediaMode` 判定（**只看有没有令牌**，不看平台：有令牌 → `blob`，否则 `fs`。执行期改的：原判据带 `isVercel()`，那样本地永远验不到真实 Blob 通道，见文末「执行期裁决」）；`.gitignore` 加 `.data/`；核对 `vitest.coverage.config.ts` 的 include 覆盖 `lib/article/**`。

- [x] **Step 5: 门禁与提交**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm arch:check`
Expected: 全绿

```bash
git add lib/config.ts lib/auth/ .gitignore vitest.coverage.config.ts tests/article-schemas.test.ts
git commit -m "feat(auth): ActionState 支持 data，新增对象入参 Action 包装器；配置媒体模式"
```

---

### Task 3: 文档结构、派生与校验层（T009–T011）

**Files:**
- Create: `lib/article/constants.ts`、`lib/article/doc.ts`、`lib/article/schemas.ts`
- Test: `tests/article-doc.test.ts`、`tests/article-schemas.test.ts`

**Interfaces:**
- Produces: `parseArticleContent(value: unknown): ArticleContent`、`derivePlainText(content): string`、`countImages(content): number`、`isReferenced(pathname, content): boolean`；`articlePageDocSchema`、`articleContentSchema`；`ARTICLE_ERRORS`（9 个 code，全小写）

- [x] **Step 1: 写失败测试（派生）**

`tests/article-doc.test.ts`：两页文本 → `derivePlainText` 以 `\n\n` 连接；`articleImage` 不贡献文本；`countImages` 跨页计数；`isReferenced` 命中/不命中；旧形状输入返回一页空文档且不抛错。Run 确认失败。

- [x] **Step 2: 写失败测试（白名单）**

`tests/article-schemas.test.ts`：`schemaVersion !== 1` 拒绝；页数 0 或 101 拒绝；节点白名单外（`bold`、`table`）拒绝；`textStyle` 里非白名单 `fontFamily` 拒绝；单页 7 张图拒绝；`pathname` 前缀不属于本谱文拒绝；`width` 缺省归一化为 `full`。Run 确认失败。

- [x] **Step 3: 实现三个模块**

`constants.ts`（错误码/文案/上限）、`doc.ts`（四个纯函数，唯一实现处）、`schemas.ts`（Zod + 白名单，9 条不变量见 data-model §2）。

- [x] **Step 4: 门禁与提交**

Run: `pnpm test -- article-doc article-schemas && pnpm typecheck`
Expected: PASS

```bash
git add lib/article/constants.ts lib/article/doc.ts lib/article/schemas.ts tests/article-doc.test.ts tests/article-schemas.test.ts
git commit -m "feat(article): 分页文档结构、派生规则与白名单校验"
```

---

### Task 4: 媒体存储与三个路由（T012–T015）

**Files:**
- Create: `lib/article/media/store.ts`、`lib/article/media/fs-store.ts`、`lib/article/media/blob-store.ts`
- Create: `app/api/media/[...key]/route.ts`、`app/api/blob/upload/route.ts`、`app/api/media/upload/route.ts`
- Test: `tests/integration/media.test.ts`

**Interfaces:**
- Consumes: `getSessionUser()`、`getOrgRole`、`withApiLogging`、`getServerConfig().mediaMode`
- Produces: `getMediaStore(): MediaStore`（`mode` / `read(pathname)` / `delete(pathname)`）；`GET /api/media/<pathname>` 返回字节流

- [x] **Step 1: 写失败测试（读取授权）**

`tests/integration/media.test.ts`：成员读自己的图片 200；非成员 404；跨组织 404；非法 `key` 形状 404。Run 确认失败。

- [x] **Step 2: 实现存储接口与两个驱动**

`store.ts` 定接口与 `getMediaStore()`（模式由 `lib/config.ts` 决定）；`fs-store.ts` 读写 `.data/media`；`blob-store.ts` 用 `get(pathname, { access: 'private' })` 与 `del()`。

- [x] **Step 3: 实现读取代理**

`app/api/media/[...key]/route.ts`：`withApiLogging` → `getSessionUser()`（无则 404）→ 解析 `key` 为 `articles/<orgId>/<articleId>/<file>` → `getOrgRole` 校验成员 → `getMediaStore().read()` → 返回 `Content-Type` 与 `Cache-Control: private, max-age=300`；任何失败 404。

- [x] **Step 4: 实现两个上传通道**

`app/api/blob/upload/route.ts`：`handleUpload({ onBeforeGenerateToken, onUploadCompleted })`，回调里反查 `article` 拿 `projectId`、校验成员 + `article.write` + 前缀 + MIME + 10MB，返回 `allowedContentTypes` / `maximumSizeInBytes` / `addRandomSuffix: false` / `tokenPayload`；`mediaMode !== 'blob'` 直接 404。`app/api/media/upload/route.ts`：fs 模式 multipart，校验魔数、体积、前缀，落盘 `.data/media/`。

- [x] **Step 5: 门禁与提交**

Run: `pnpm test:integration -- media && pnpm typecheck`
Expected: PASS

```bash
git add lib/article/media/ app/api/ tests/integration/media.test.ts
git commit -m "feat(article): 媒体存储抽象与双模式上传/读取通道"
```

---

### Task 5: 查询层（T016）

**Files:**
- Create: `lib/db/queries/articles.ts`
- Test: `tests/integration/queries.test.ts`（追加）

**Interfaces:**
- Produces: `listArticles(userId, orgId, projectId)`（带 `pageCount`）、`getArticle(userId, orgId, articleId)`、`countArticlesByFolder(...)`、`getArticleDeletePreview(...)`、`getFolderDeletePreview(...)`、`hasCatalogReference(...)`

- [x] **Step 1: 写失败测试**

断言：列表按 `coalesce(updated_at, created_at) DESC`；`pageCount` 等于 `jsonb_array_length(content -> 'pages')`；分类篇数 SQL 用 `JOIN folder f ON f.id = a.folder_id AND f.kind = 1`（`article.kind` 恒 `NULL`）；引用检查带 `catalog.deleted_at IS NULL AND book.deleted_at IS NULL`。Run 确认失败。

- [x] **Step 2: 实现查询**

全部经 `withOrg`、带 `orgId`；不加索引；「未分类」篇数 = 总数 − 分类篇数之和。

- [x] **Step 3: 门禁与提交**

```bash
pnpm test:integration -- queries && pnpm typecheck
git add lib/db/queries/articles.ts tests/integration/queries.test.ts
git commit -m "feat(db): 谱文查询层（列表页数、分类篇数、删除预览、引用检查）"
```

---

### Task 6: US1 服务层与四个 Action（T017–T021）

> **执行时调整**：`lib/article/services.ts` 写成 652 行会撞 F6（单文件 ≤400 行），
> 已拆成 `lib/article/mutations.ts`（事务共用件）+ `services.ts`（整篇 CRUD）+
> `page-services.ts`（按页操作）。函数名与契约不变。

**Files:**
- Create: `lib/article/services.ts`、`lib/article/actions.ts`
- Test: `tests/integration/articles.test.ts`、`tests/article-save-state.test.ts`

**Interfaces:**
- Consumes: `withOrgWrite`、`logActivityInTx`、`lib/article/doc.ts`、`lib/article/schemas.ts`
- Produces: `createArticleAction`、`updateArticleTitleAction`、`moveArticleAction`、`deleteArticleAction`、`saveArticlePageAction`（契约见 contracts §1.1–§1.5）

- [x] **Step 1: 写失败测试（权限与事务）**

`tests/integration/articles.test.ts`：`editor` 可建/改/移/删；`viewer` 全部被拒；跨组织 `articleId` 返回 404；被 `book_catalog` 引用时删除返回 `catalog_referenced` 且**行未变**；默认分类自动创建只发生一次。Run 确认失败。

- [x] **Step 2: 实现服务层**

`createArticleInTransaction`（默认分类自动创建）、`updateTitleInTransaction`、`moveInTransaction`、`deleteArticleInTransaction`（引用检查 → 软删 → 活动日志，提交后删字节）、`savePageInTransaction`（`FOR UPDATE` → 替换该页 → `derivePlainText` → `updated_at`）。

- [x] **Step 3: 实现 Action**

`'use server'` + `validatedActionWithUserObject`；refusal 映射 `forbidden`；返回 `{ success, data }`（`articleId` / `savedAt` / `page`）；新建/改标题/移分类/删除后 `revalidatePath` 谱文列表路径，**保存页不 revalidate**。

- [x] **Step 4: 写失败测试（保存状态机）→ 实现**

`tests/article-save-state.test.ts`：`idle→dirty→saving→saved/error` 转移；任一页未保存时顶栏不得显示「已保存」。

- [x] **Step 5: 门禁与提交**

```bash
pnpm test:integration -- articles && pnpm test -- article-save-state && pnpm typecheck
git add lib/article/services.ts lib/article/actions.ts tests/
git commit -m "feat(article): 谱文 CRUD 与按页保存（单事务 + 行锁）"
```

---

### Task 7: US1 页面与编辑器（T022–T030）

**Files:**
- Create: `app/(dashboard)/dashboard/project/[projectRef]/articles/[articleId]/page.tsx`
- Modify: `app/(dashboard)/dashboard/project/[projectRef]/articles/page.tsx`、`app/(dashboard)/dashboard/project/[projectRef]/page.tsx`
- Create: `components/article/{article-editor-shell,article-title-input,save-status,article-folder-tree,article-list,new-article-dialog}.tsx`
- Create: `components/article/editor/tiptap-editor.tsx`

**Interfaces:**
- Consumes: Task 5 的查询、Task 6 的 Action、`getMediaStore().mode`
- Produces: 列表页（分类树 + 列表 + 新建）、编辑器页（三区 + 顶栏）、离开保护

- [x] **Step 1: 列表页与新建**

`articles/page.tsx` 换成 RSC 查询 + `article-list.tsx` + `article-folder-tree.tsx` + `new-article-dialog.tsx`（标题 1–60 字、分类下拉含「未分类」、地区只读 `project.countries_regions || '中国'`）；分类管理入口按 `hasPermission(role, 'project.write')` 显隐。

- [x] **Step 2: 编辑器壳与单页编辑器**

`article-editor-shell.tsx` 三区布局 + 顶栏（返回 / 标题 / 地区 / 保存状态 / 立即保存，**无**分享、发布、导出、版式入口）；`tiptap-editor.tsx` 用 StarterKit 关掉禁用节点，仅留段落、两级标题、`undoRedo`、`articleImage`、`textStyle`；**只在首次挂载用 RSC 数据初始化**。

- [x] **Step 3: 自动保存与回显**

停止输入 2 秒提交当前页；「立即保存」提交所有改动页；成功用 `data.page` 对齐该页（该页已无未提交改动时）；失败保留内容并给重试。

- [x] **Step 4: 离开保护**

应用内离开 `await` 保存 → 成功 `router.push`，失败停留提示；`beforeunload` 在有未保存改动时拦截。

- [x] **Step 5: 删除确认与概览入口**

删除谱文确认框用 `getArticleDeletePreview`（页数 / 图片数 / 编目引用）；删除分类确认框用 `getFolderDeletePreview`（分类数 / 篇数）；概览页加「新建谱文」入口。

- [x] **Step 6: 手工验证（quickstart US1）**

按 [quickstart.md](../../../specs/002-article-authoring/quickstart.md) 的 US1 九条走一遍，记录实际输出。

- [x] **Step 7: 门禁与提交**

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm arch:check
git add app/ components/article/ 
git commit -m "feat(article): 谱文列表页与三区编辑器（自动保存、离开保护）"
```

---

### Task 8: US1 E2E（T031）

**Files:**
- Create: `tests/e2e/article-authoring.spec.ts`

- [x] **Step 1: 写 US1 段**

新建 → 输入两段 → 等「已保存」→ 刷新一致 → 改标题 → 搜索命中与不命中 → 删除（确认框文案含页数与图片数）。

**E2E 抓到一个真 bug**：删除确认框的影响范围原先只在 Radix `onOpenChange(true)` 里取，而父组件是直接翻转 `open`，该回调不触发 → 弹窗只显示描述、没有「页数：N 页」。已改为 `useEffect` 在 `open` 时取数（`components/article/article-card-dialogs.tsx`），分类删除框本来就是 effect 写法。

- [x] **Step 2: 运行**

Run: `CI=1 pnpm test:e2e tests/e2e/article-authoring.spec.ts`（先 `pnpm build`）
Expected: PASS
**执行时调整**：本地 dev-server 模式下首次导航反复 hydration 重挂，点「注册」永远等不到稳定元素（基线 `critical-path.spec.ts` 同样失败，非本期代码问题）；改用 CI 的生产服务器模式跑通。本机 Chromium 缺 `libasound.so.2`，用 `LD_LIBRARY_PATH` 指到解包目录跑，不改仓库配置。

- [x] **Step 3: 提交**

```bash
git add tests/e2e/article-authoring.spec.ts
git commit -m "test(e2e): 谱文建篇到保存的主链路"
```

---

### Task 9: US2 多页（T032–T035）

**Files:**
- Modify: `lib/article/services.ts`、`lib/article/actions.ts`
- Create: `components/article/page-thumbnails.tsx`
- Test: `tests/integration/articles.test.ts`、`tests/e2e/article-authoring.spec.ts`

- [x] **Step 1: 写失败测试**

加页（服务端生成页 id）、超 100 页拒绝、删最后一页拒绝、重排集合不一致拒绝、重排后页序持久。Run 确认失败。

- [x] **Step 2: 实现服务层与 Action**

`addArticlePageAction` / `deleteArticlePageAction`（删页后清理该页独有图片字节）/ `reorderArticlePagesAction`；三者都**不 revalidate**。

- [x] **Step 3: 页缩略图组件**

页序列表 + 添加页 + 拖拽排序 + 切页前先提交当前页（失败则停留）；缩略图用文本摘要，不渲染整页 DOM。

- [x] **Step 4: E2E US2 段 + 门禁 + 提交**

```bash
pnpm test:integration -- articles && pnpm test:e2e -- article-authoring && pnpm typecheck
git add lib/article/ components/article/page-thumbnails.tsx tests/
git commit -m "feat(article): 多页编辑（加页、切页先保存、拖拽重排、删页）"
```

---


> 执行时调整：页缩略图组件实际落在 `components/article/page-strip.tsx`（Task 7 已建，本任务加摘要与拖拽接线），不新建 `page-thumbnails.tsx`；页摘要由 `lib/article/doc.ts` 新增的 `pagePlainText()` 在客户端算，不打服务端。另把「标题正在保存」并入离开保护（FR-016），否则正文不脏时刷新会丢标题。
### Task 10: US3 图片（T036–T041）

**Files:**
- Create: `components/article/editor/article-image-node.tsx`、`components/article/editor/paste-filter.ts`
- Modify: `components/article/editor/toolbar.tsx`、`lib/article/schemas.ts`、`lib/article/constants.ts`
- Test: `tests/integration/media.test.ts`、`tests/e2e/article-authoring.spec.ts`

- [x] **Step 1: 写失败测试**

上传令牌只对成员签发、跨组织读取 404、含图文档保存时前缀不符拒绝、单页 7 图拒绝。Run 确认失败。

- [x] **Step 2: 图片节点与工具栏**

`Image.extend({ name: 'articleImage' })` 加 `width`（`small` / `medium` / `full`，缺省 `full`）；工具栏「插入图片」在光标处插入块级节点；三档宽度切换。

- [x] **Step 3: 上传接线与预校验**

blob 模式走 `upload()` 直传、fs 模式走 `POST /api/media/upload`；客户端预校验 MIME/10MB/单页 6 张并给中文提示，服务端权威校验。

- [x] **Step 4: 粘贴清洗**

`paste-filter.ts`：只留段落/两级标题/文字，丢外链图与所有禁用 mark。

- [x] **Step 5: E2E US3 段 + 门禁 + 提交**

```bash
pnpm test:integration -- media && pnpm test:e2e -- article-authoring && pnpm typecheck
git add components/article/editor/ lib/article/ tests/
git commit -m "feat(article): 正文插图（三档宽度、上传校验、粘贴清洗）"
```

---

> 执行时补的两处（都已进代码与测试）：
> ① `normalizePageDoc` 必须把 `attrs` 与 `marks` 复制成**普通对象**——ProseMirror 的
> `attrsToJSON` 用 `Object.create(null)`，而 React 的 Server Action 参数序列化只认带
> 原型的普通对象，直接透传会让服务端收到 `{"type":"articleImage"}`（无 attrs），
> 报 `doc.content.1` union 失败却看不出现场。E2E 的 US3 段是唯一抓到这条的门禁。
> ② `imagePathsOf` 认的是「分页文档包」，删页时传单页 doc 会得到空列表，独占图片
> 字节永远清不掉（FR-029）；已在 `deleteArticlePageInTransaction` 包一层并补集成测试。

### Task 11: US4 字体与字号（T042–T044，P2）

**Files:**
- Modify: `lib/article/schemas.ts`、`lib/article/constants.ts`、`components/article/editor/toolbar.tsx`
- Test: `tests/article-schemas.test.ts`

- [x] **Step 1: 写失败测试**

白名单外 `fontFamily`（如「微软雅黑」）与 `fontSize`（如 `28px`）拒绝；白名单内（宋/黑/楷、14/16/19px）接受。Run 确认失败。

- [x] **Step 2: 实现**

`textStyle` + `fontFamily` + `fontSize` 两个白名单 mark；工具栏下拉；服务端照样校验。

- [x] **Step 3: 手工验证替代字体**

在无楷体环境打开，确认显示为替代字体而非方块（quickstart US4 第 3 条）。

- [x] **Step 4: 提交**

```bash
pnpm test -- article-schemas
git add lib/article/ components/article/editor/toolbar.tsx tests/article-schemas.test.ts
git commit -m "feat(article): 字体与字号（系统字体白名单，P2）"
```

---
>
> 执行时补的一处（E2E 才抓得到）：`components/article/editor/tiptap-editor.tsx` 原来只挂了裸 `TextStyle`，
> 它不认识 `fontFamily` / `fontSize`，`setMark('textStyle', { fontFamily })` 的 attrs 会被 ProseMirror 丢掉 ——
> 字体设置既存不住也不渲染，而工具栏看起来「worked」。改用包里的 `FontFamily` / `FontSize` 扩展
> （它们通过 `addGlobalAttributes` 把属性挂到 `textStyle` 上，并输出 inline style），工具栏顺带换成
> `setFontFamily` / `unsetFontFamily` / `setFontSize` / `unsetFontSize`，避免设字号把已设的字体抹掉。
> 白名单仍然只有服务端一份（`lib/article/constants.ts`），客户端不维护第二份清单。
### Task 12: 文档同步、安全回归与全量门禁（T045–T050）

**Files:**
- Modify: `docs/architecture/04-数据视图-数据架构.md`、`docs/architecture/11-需求与实现状态.md`、`docs/architecture/05-接口与集成设计.md`、`AGENTS.md`
- Test: `tests/security-regressions.test.ts`

- [x] **Step 1: 文档同步**

04 §10.1 补 `article.content` 结构说明（不改 DDL）；11 §5.5 谱文状态与 FR-ART-1「类型→分类」；05 §6.6 按 contracts §1.11 的映射改成已实现清单；`AGENTS.md` §1「尚未实现」清单移除谱文编辑器与图片。

- [x] **Step 2: 安全回归测试**

`viewer` 直接调写 Action 被拒；跨组织 `articleId` 404；跨组织 `/api/media` 404；上传令牌不能扩大前缀。**不改** `tests/permissions.test.ts` 与 `tests/access-control.test.ts`（本期零权限变更）。

- [x] **Step 3: 性能夹具**

`tests/e2e/fixtures/article.ts` 构造 20 页 / 40 图（SC-003）与 200 篇列表（SC-010）的测试数据，在 `tests/e2e/article-authoring.spec.ts` 里记录切页耗时与滚动帧率。

- [x] **Step 4: 全量门禁**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm arch:check && pnpm docs:check --strict && pnpm test:integration && pnpm test:e2e`
Expected: 全部 0 issue / PASS（若集成或 E2E 环境不可用，记录哪一项没跑、为什么）

- [x] **Step 5: quickstart 演练**

按 quickstart 逐条走完，特别确认：`editor` 看不到分类入口、地区只读、离开保护、跨组织 404、超限图片零副作用。

- [x] **Step 6: 提交（拆分）**

```bash
git add docs/ AGENTS.md
git commit -m "docs(spec): 同步谱文实现状态、content 结构与接口清单"
git add tests/
git commit -m "test(article): 安全回归与性能夹具"
```

---

## Dependencies & Execution Order

- **Task 1 → Task 2 → Task 3 → Task 4 → Task 5**：Setup 与 Foundational，串行（Task 4 与 Task 5 可并行）
- **Task 6 → Task 7 → Task 8**：US1（MVP），必须按序
- **Task 9（US2）与 Task 10（US3）**：US1 完成后可并行（文件集不重叠）
- **Task 11（US4）**：依赖 Task 7；与 Task 10 共用 `toolbar.tsx`，需顺序
- **Task 12**：依赖所有交付故事

## Implementation Strategy

1. 先做 Task 1–5（通道与基础），此时 `pnpm test` 全绿但用户看不到变化
2. Task 6–8 交付 US1：**能建、能写、能存**（MVP）
3. Task 9 多页、Task 10 图片（可并行）
4. Task 11 字体（P2，可延后）
5. Task 12 文档与门禁收口

## Notes

- 装 TipTap 与改 ADR 0010 状态句必须同一 commit（否则 docs-consistency 测试红）
- 保存页/加删页/重排页不 revalidate；新建/改标题/移分类/删除才 revalidate
- 图片字节删除在事务提交后执行，失败只记日志（孤儿字节是已知限制）
- 每完成一个 Task 就 `git commit`，不要攒到最后

## 验证记录（2026-11-02 执行完毕，T048 / T049）

### 门禁实际输出

| 命令 | 结果 |
|---|---|
| `pnpm check` | `Checked 407 files in 126ms. No fixes applied.` |
| `pnpm typecheck` | `tsc --noEmit` 退出 0，无输出 |
| `pnpm test` | `Test Files 46 passed (46)` / `Tests 345 passed (345)` |
| `pnpm arch:check` | `[F6] 214 files scanned, 7 exemptions, 0 violations` / `[F7] 216 files scanned, 0 process.env violations` |
| `pnpm docs:check --strict` | `0 issue(s)`（该脚本只扫 `docs/`，`specs/` 与 `AGENTS.md` 不在范围内） |
| `pnpm test:integration` | `Test Files 1 failed | 24 passed (25)` / `Tests 3 failed | 318 passed (321)` |
| `pnpm build` | 退出 0 |
| `CI=1 pnpm test:e2e tests/e2e/article-authoring.spec.ts` | `5 passed (2.7m)`（本机需 `LD_LIBRARY_PATH` 补 `libasound.so.2`，见 Task 8 偏差说明；带 `--retries=0`） |
| `pnpm exec vitest run --config vitest.coverage.config.ts --coverage` | `71 files / 666 tests passed`，`All files 81.14% lines`，各 glob 门槛（含 `lib/db/queries/**` 98%）无 ERROR；本机需 `--testTimeout=90000`，原因见下 |

**唯一未过的一条不是本期回归**：`tests/integration/fact-cli.test.ts` 3 个用例在默认 15s 超时下报 `Error: Test timed out in 15000ms`；同一文件加 `--testTimeout=90000` 后 `8 passed (8)`。它们 spawn 子进程去连不可达地址，本机比 CI 慢一个量级，`main` 上就存在，与谱文无关。

### 规格口径的实测数值

- SC-003（20 页 / 40 图）：服务端 `解析 20 页/40 图 0.6ms；加页 19 次 275.7ms；逐页保存 20 次 339.6ms`（`tests/integration/article-perf.test.ts`）；浏览器切页 `ms=79/46/48/49/51`（最差 79ms，规格 <300ms 达标）、滚动 `60.0 fps`（规格 ≥45fps 达标）。
- SC-010（200 篇）：`造 200 篇 495ms；列表查询 8.7ms`，规格 p95 <1s 达标且不需翻页。
- E2E 的 perf 用例阈值有意放宽到 1s / 30fps：本机是生产构建 + 软渲染，绝对值受机器影响；它守的是「没有平方级退化、没有整篇重渲染」。规格的 300ms / 45fps 要钉死需在目标环境重跑。

### quickstart 逐条对应（§3）

| 手工项 | 自动化落点 |
|---|---|
| US1 建篇 → 写字 → 已保存 → 刷新一致 → 改标题 → 搜索 → 删除弹窗给页数图片数 → 地区只读 → 无分享/发布/导出/版式入口 | `article-authoring.spec.ts` 第 1 个 test（7.3s）；`tests/integration/articles.test.ts` 的 createArticle / 预览 / 引用阻止各段 |
| US1 标题清空阻断（AC11） | `tests/integration/articles.test.ts`「标题为空时就近返回中文校验信息」+ `article-title-input` 的中文提示 |
| US2 加页 / 切页先提交 / 拖拽重排持久 / 最后一页拒删 | 第 2 个 test（5.3s）+ `articles.test.ts`「页操作」7 条 |
| US3 插图默认整宽 → 改中档 → 刷新仍在；>10MB 与非白名单类型被拒且内容零变化；单页第 7 张被拒 | 第 3 个 test（6.4s）+ `article-image-upload.test.ts` 8 条 + `media.test.ts` 19 条 |
| US4 字体字号保存后仍生效、缺字体显示替代字体 | 第 4 个 test（4.6s，本机未装楷体仍生效即「不是方块」）+ `article-text-style.test.ts` 6 条 |
| 权限与越权：viewer 无写入按钮、跨组织 404、跨组织媒体 404、viewer 直接调 Action 被拒 | `article-security.test.ts` 8 条 + `security-regressions.test.ts` 新增 5 条不变量（含媒体读取「一律 404 不给 403」的源码不变量） |
| 粘贴清洗只留段落/两级标题/文字 | `article-paste-filter.test.ts` 9 条（`sanitizePasteHtml` 为纯字符串实现，vitest 环境是 `node`） |

### 本轮**没有**做到的两条（如实记账）

1. **编辑者（editor）在真实浏览器里看不到「新建/重命名/删除分类」入口**：入口显隐由 `canManageFolders = hasPermission(role, 'project.write')` 决定，且 `security-regressions.test.ts` 已钉住 `hasPermission('editor','project.write') === false`；但没有第二个成员账号的 E2E（要注册第二个用户再插一条 membership），本期未做。
2. **浏览器原生「确定离开？」弹窗**（US2 最后一条，`beforeunload`）：拦截逻辑在 `article-editor-shell.tsx`（`busy = ws.hasPending || titlePending` 时才挂 `beforeunload`），集成/E2E 都只验到「应用内切页/切分类先保存、失败停留」，弹窗本身未自动化（Playwright 对 `beforeunload` 的处理需要专门的 dialog 夹具，性价比低）。

**Task 12 执行偏差**：T046 的安全回归主要落在 `tests/integration/article-security.test.ts`（真实库里才测得到越权与拒绝副作用），brief 里点名的 `tests/security-regressions.test.ts` 只补了 5 条**静态不变量**（写事务必须复核 `article.write`、组织级查询必须带 `orgId`、媒体越权一律 404 不给 403、错误文案不回显内部信息）。两条未自动化项见「验证记录」末节。

### 自查修掉的两处（评审前）

1. **FR-032 的「命中结果显示所属分类」原先没做**：列表行只有标题、页数与日期。补了 `folderLabel()`（`components/article/types.ts`，`null`/哨兵/查不到一律回落「未分类」，子分类去掉全角缩进）与行内 `Badge`，并把它钉成三层证据：`tests/article-folder-label.test.ts` 3 条、E2E US1 段的搜索命中断言、`11-需求与实现状态` §5.5/§7 的措辞同步。
2. **`searchArticlesByTitle` 是死代码**：列表全量下发后前端已在同一份数据上过滤，服务端那条 ILIKE 查询没有任何调用方（也是覆盖率门槛掉到 93.81% 的直接原因——`lib/db/queries/**` 要求 98%）。按「能不加就不加」删掉，正文检索留到 FR-044 立项时再连着 `pg_trgm` 一起做。顺带把 `countArticlesByFolder` 里走不到的 `!row.folderId` 分支（改取 `folders.id`）与 `getFolderDeletePreview` 里 `queue.shift()` 的空调守卫（改成递归 `collect`）清掉。

### 全量 E2E 才暴露的两个问题（单文件跑看不见）

1. **注册限流把基线用例打红**：`signup:<ip>` 是 5 次/小时（`lib/auth/actions/session.ts:101`），而本地/CI 请求没有 `x-forwarded-for`，全部落进同一个 `unknown` 桶。本文件 5 个 test 各注册一个账号，`critical-path.spec.ts` 的第 6 次注册就被「尝试次数过多，请稍后再试。」挡下（实跑：`✘ critical-path … Received string: "http://127.0.0.1:3100/sign-up"`）。改法是每个 test 用自己的 `x-forwarded-for`（TEST-NET-3 的 `203.0.113.N`），限流按不同客户端计，不动生产阈值。
2. **刷新后立刻点页缩略图的竞态**：`page.reload()` 之后 Playwright 判定位可见可点就下手，可能落在 hydration 之前，点了没反应（serial 模式下整条链路红一次，单跑同一条又绿）。加了两道：先 `toHaveAttribute('contenteditable','true')` 等 ProseMirror 接管，再把「点第 N 页 + 断言画布内容」包进 `expect(...).toPass()`。

复跑证据：`CI=1 pnpm test:e2e --retries=0`（两个 spec 文件全量）**7 passed**（两次连跑都全绿，第二次 37.6s）。

## 执行期裁决（补记，2026-11-02 深夜）

- **`getMediaMode()` 的判据去掉平台条件**：原写「有令牌且 `isVercel()` 才 blob」，后果是本地无论怎么配令牌都只能跑 fs 驱动，ADR 0019 的真实 Blob 路径（私有桶写入 + `get({ access: 'private' })` 读回 + 读取代理）在开发机上无法验证。现改为只看 `BLOB_READ_WRITE_TOKEN`：留空（本地与 CI 的默认）走 `.data/media/`，配了就走 Blob——本地配了生产令牌即可真机验一遍，生产由 Vercel 存储绑定注入，行为不变。守它的测试：`tests/config.test.ts` 的 `describe('media mode')` 与 `tests/integration/media-blob.test.ts`（无令牌整体 skip）。


结论「需小修」，9 条阻塞全部修完；提交 `566c6a8`（服务端与编辑器内核）与 `1502c6c`（页面与交互）。

| 阻塞 | 症状 | 修法 | 守住它的测试 |
|---|---|---|---|
| BLK-1 | 只设字体（字号留空）时整页存不上 | `lib/article/schemas.ts` 的 `fontFamily`/`fontSize` 改 `.nullish()`；`lib/article/doc.ts` 的 `sanitizeNode` 用 `dropNullAttrs` 剥 null | `tests/article-schemas.test.ts` +4、`tests/integration/articles.test.ts`「字体与字号的真实序列化」 |
| BLK-2 | Ctrl+U 造出服务端存不住的 underline mark | `tiptap-editor.tsx` 的 StarterKit 关 `underline`（3.32.2 默认注册） | E2E「regressions」段：Ctrl+U 后仍能保存并 reload 复现 |
| BLK-3 | 在途保存拦不住离开、回显吃掉新敲的字、没有 3 秒收敛 | `lib/article/save-state.ts` 加 `hasUnsettled`/`inFlightPageIds`；`hooks/use-article-autosave.ts` 加 `SAVE_DEADLINE_MS=3000`、`withDeadline`、`stateRef`、`inFlight` 去重，成功但本页已再被编辑就不回显只标 dirty | `tests/article-save-state.test.ts` 新增 4 条、E2E 用闸门卡住在途请求 |
| BLK-4 | 删页没有二次确认（FR-022 P0） | `page-strip.tsx` 加确认 Dialog（写明「第 N 页」+ 该页摘要）；只剩一页时按钮仍在、点击给「至少要保留一页，这一页删不掉。」 | E2E multi-page 段：取消→还在→再删→消失 |
| BLK-5 | 空白页没有「输入文字」引导；`prose`/`article-canvas` 是死类名，标题与正文视觉一样 | `app/globals.css` 的 `@layer components` 里给 `.article-canvas` 写 h1/h2/p/img 规则（只用 token）；编辑器里空页渲染覆盖层（不引 Placeholder 扩展：打断中文输入法） | E2E regressions 段断言引导出现、打字后消失 |
| BLK-6 | blob 上传把「不存在/无权限」回 403 + 原因串，泄露存在性 | `app/api/blob/upload/route.ts` 一律 404 + `logger.info` 记原因；文档 `05 §7`、`11 §8.4` 同步 | `tests/integration/media.test.ts` |
| BLK-7 | 选中分类时搜索只覆盖该分类（FR-032） | `article-workspace.tsx` 传全量 rows；`article-list.tsx` 关键词非空时忽略分类过滤 | E2E regressions 段跨分类搜索命中 |
| BLK-8 | 窄屏下编辑器的分类树整块消失（FR-012） | `article-editor-shell.tsx` 补 `Sheet`，与桌面 `aside` 挂同一棵树；开抽屉前先保存在途 | 静态检查 + 手工（视口断点无 E2E） |
| BLK-9 | 契约写「不用 `revalidateWholeConsole()`」但实现与全仓库都在用它 | 以现状为准改契约 §0 与本计划口径：整篇级四类写入失效整棵控制台，页级四类一律不失效 | 见上一节裁决 |

顺带修的两处（E2E 与评审建议）：`ArticleMoveDialog` 打开时预选这篇当前分类、失败不再吞掉（S3）；读取代理补 `getArticleScope`（谱文软删后新请求 404，FR-029 第二条腿）与 `X-Content-Type-Options: nosniff`（S1）；`media` 集成测试加软删用例（`tests/helpers/factories.ts` 新增 `softDeleteArticle`）；`article-perf` 末条改为真调 `articleContentSchema` 而不是断言常量（S4）；未登录面扫满 10 个 Action（S5）；拖拽排序失败回滚页序（S7）；清孤儿 JSDoc 与两处 `as`（S9/S14）。

**E2E 又抓到一个真 bug**：分类树行内输入 `Enter` 提交后 `editing` 要等 Action 回来才清空，紧随其后的 `blur` 会再提交一次，凭空造出两个同名分类（表现为移动对话框里出现两个「谱序类」选项）。`components/article/article-folder-tree.tsx` 加 `submittingRef` 挡第二次，与 `components/lineage/lineage-sidebar.tsx:183` 的 `savingRef` 同一做法。

复跑证据（本机 2026-11-02 22:5x）：`pnpm check` 408 files（1 条警告已修）、`pnpm typecheck` 0、`pnpm test` **46 files / 352 tests**、`pnpm arch:check` `[F6] 214 files 0 violations` / `[F7] 216 files 0 violations`、`pnpm docs:check --strict` `0 issue(s)`、`pnpm build` 0、`pnpm test:integration`（全量）`320 passed | 3 failed`，3 条仍是 `tests/integration/fact-cli.test.ts` 的 15s 超时（`pnpm exec vitest run --config vitest.integration.config.ts tests/integration/fact-cli.test.ts --testTimeout=90000` → 8 passed；注意 `pnpm test:integration -- --testTimeout=…` 的额外参数不会传到 vitest）、`CI=1 pnpm test:e2e --retries=0`（整个目录）**8 passed (47.8s)**，含基线 `critical-path.spec.ts` 2 条。

已接受的缺口（不在本期补）：图片加载失败没有占位（要做 NodeView）；blob 模式不做魔数嗅探（`allowedContentTypes` 交给 Blob 侧把关，fs 模式才嗅探）；`beforeunload` 原生弹窗与「editor 看不到分类管理入口」只有静态/RSC 层证据，没有浏览器级断言；孤儿图片字节没有回收（零后台任务，ADR 0005/0019）。

- **缓存失效用 `revalidateWholeConsole()` 而不是计划里写的 `revalidatePath(列表路径)`**：全仓库 30 个既有 Action 只调这一个函数，`lib/lineage/revalidate.ts` 里的作用域助手 `revalidateProject` / `revalidateOrg` 至今零调用者；单为谱文接通第二条失效路径等于引入第二套事实来源（宪法 V）。失效只发生在**新建 / 改标题 / 移分类 / 删除**四种整篇级写入上；**保存页 / 加页 / 删页 / 重排页四个页级 Action 一律不失效**——这条是规格要求（FR-017：回显只到本次提交成功的那一页），实测靠 `tests/e2e/article-authoring.spec.ts` 的「打字→刷新→内容仍在」与 `tests/integration/articles.test.ts` 的按页保存用例守住。
