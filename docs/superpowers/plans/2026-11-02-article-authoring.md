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
- **保存路径不得调 `revalidateWholeConsole()`**：只有新建/改标题/移分类/删除谱文才 `revalidatePath` 谱文列表路径。
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

- [ ] **Step 1: 装依赖**

Run: `pnpm add @tiptap/react @tiptap/core @tiptap/pm @tiptap/starter-kit @tiptap/extension-text-style @tiptap/extension-image @vercel/blob`
Expected: 六个 TipTap 包版本一致（3.x），`@vercel/blob` ≥2.3

- [ ] **Step 2: 改 ADR 0010 状态句**

把「依赖尚未安装」改为「本期安装」，**逐字保留 `决策 ≠ 现在安装` 这一串**（测试靠它跳过依赖黑名单）；同步 `docs/decisions/README.md` 的 ADR-12 行。

- [ ] **Step 3: 写 ADR 0019**

内容按 `docs/decisions/README.md` 的模板：背景（仓库无对象存储，规格把图片定为 P0）／决策（私有 Blob + 服务端代理读取 + fs 兜底 + 客户端直传）／后果（正：每请求授权、本地可验；负：带宽经函数、孤儿字节）／放弃的方案（公有桶、签名 URL、base64 内嵌）／重估触发。并在 `docs/decisions/README.md` §1 索引与 §2 表格各加一行。

- [ ] **Step 4: biome 限制编辑器依赖**

在 `biome.json` 的 `noRestrictedImports` 里加一条：`@tiptap/*` 只允许 `lib/article/**` 与 `components/article/editor/**`。

- [ ] **Step 5: 门禁**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm docs:check --strict`
Expected: 全绿（`tests/docs-consistency.test.ts` 的 ADR 0010 用例通过）

- [ ] **Step 6: 提交**

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

- [ ] **Step 1: 写失败测试（包装器）**

在 `tests/article-schemas.test.ts` 里加一条：对象入参（含嵌套对象与 `null`）能被 `validatedActionWithUserObject` 接受；`FormData` 通道保持原行为。Run 确认失败。

- [ ] **Step 2: 扩展 `ActionState`**

`lib/auth/types.ts`：`{ success: string; data?: T } | { error: string; code?: ActionErrorCode; fieldErrors?: Record<string, string[]> }`；既有调用点零改动。

- [ ] **Step 3: 新增对象入参包装器**

`lib/auth/middleware.ts`：与 `validatedActionWithUser` 并列，逻辑相同但直接 `safeParse(payload)`；未登录与校验失败返回中文 `ActionState`。

- [ ] **Step 4: 配置与忽略项**

`lib/config.ts` 加可选 `BLOB_READ_WRITE_TOKEN` 与 `mediaMode` 判定（有令牌且 `isVercel()` → `blob`，否则 `fs`）；`.gitignore` 加 `.data/`；核对 `vitest.coverage.config.ts` 的 include 覆盖 `lib/article/**`。

- [ ] **Step 5: 门禁与提交**

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

- [ ] **Step 1: 写失败测试（派生）**

`tests/article-doc.test.ts`：两页文本 → `derivePlainText` 以 `\n\n` 连接；`articleImage` 不贡献文本；`countImages` 跨页计数；`isReferenced` 命中/不命中；旧形状输入返回一页空文档且不抛错。Run 确认失败。

- [ ] **Step 2: 写失败测试（白名单）**

`tests/article-schemas.test.ts`：`schemaVersion !== 1` 拒绝；页数 0 或 101 拒绝；节点白名单外（`bold`、`table`）拒绝；`textStyle` 里非白名单 `fontFamily` 拒绝；单页 7 张图拒绝；`pathname` 前缀不属于本谱文拒绝；`width` 缺省归一化为 `full`。Run 确认失败。

- [ ] **Step 3: 实现三个模块**

`constants.ts`（错误码/文案/上限）、`doc.ts`（四个纯函数，唯一实现处）、`schemas.ts`（Zod + 白名单，9 条不变量见 data-model §2）。

- [ ] **Step 4: 门禁与提交**

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

- [ ] **Step 1: 写失败测试（读取授权）**

`tests/integration/media.test.ts`：成员读自己的图片 200；非成员 404；跨组织 404；非法 `key` 形状 404。Run 确认失败。

- [ ] **Step 2: 实现存储接口与两个驱动**

`store.ts` 定接口与 `getMediaStore()`（模式由 `lib/config.ts` 决定）；`fs-store.ts` 读写 `.data/media`；`blob-store.ts` 用 `get(pathname, { access: 'private' })` 与 `del()`。

- [ ] **Step 3: 实现读取代理**

`app/api/media/[...key]/route.ts`：`withApiLogging` → `getSessionUser()`（无则 404）→ 解析 `key` 为 `articles/<orgId>/<articleId>/<file>` → `getOrgRole` 校验成员 → `getMediaStore().read()` → 返回 `Content-Type` 与 `Cache-Control: private, max-age=300`；任何失败 404。

- [ ] **Step 4: 实现两个上传通道**

`app/api/blob/upload/route.ts`：`handleUpload({ onBeforeGenerateToken, onUploadCompleted })`，回调里反查 `article` 拿 `projectId`、校验成员 + `article.write` + 前缀 + MIME + 10MB，返回 `allowedContentTypes` / `maximumSizeInBytes` / `addRandomSuffix: false` / `tokenPayload`；`mediaMode !== 'blob'` 直接 404。`app/api/media/upload/route.ts`：fs 模式 multipart，校验魔数、体积、前缀，落盘 `.data/media/`。

- [ ] **Step 5: 门禁与提交**

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

- [ ] **Step 1: 写失败测试**

断言：列表按 `coalesce(updated_at, created_at) DESC`；`pageCount` 等于 `jsonb_array_length(content -> 'pages')`；分类篇数 SQL 用 `JOIN folder f ON f.id = a.folder_id AND f.kind = 1`（`article.kind` 恒 `NULL`）；引用检查带 `catalog.deleted_at IS NULL AND book.deleted_at IS NULL`。Run 确认失败。

- [ ] **Step 2: 实现查询**

全部经 `withOrg`、带 `orgId`；不加索引；「未分类」篇数 = 总数 − 分类篇数之和。

- [ ] **Step 3: 门禁与提交**

```bash
pnpm test:integration -- queries && pnpm typecheck
git add lib/db/queries/articles.ts tests/integration/queries.test.ts
git commit -m "feat(db): 谱文查询层（列表页数、分类篇数、删除预览、引用检查）"
```

---

### Task 6: US1 服务层与四个 Action（T017–T021）

**Files:**
- Create: `lib/article/services.ts`、`lib/article/actions.ts`
- Test: `tests/integration/articles.test.ts`、`tests/article-save-state.test.ts`

**Interfaces:**
- Consumes: `withOrgWrite`、`logActivityInTx`、`lib/article/doc.ts`、`lib/article/schemas.ts`
- Produces: `createArticleAction`、`updateArticleTitleAction`、`moveArticleAction`、`deleteArticleAction`、`saveArticlePageAction`（契约见 contracts §1.1–§1.5）

- [ ] **Step 1: 写失败测试（权限与事务）**

`tests/integration/articles.test.ts`：`editor` 可建/改/移/删；`viewer` 全部被拒；跨组织 `articleId` 返回 404；被 `book_catalog` 引用时删除返回 `catalog_referenced` 且**行未变**；默认分类自动创建只发生一次。Run 确认失败。

- [ ] **Step 2: 实现服务层**

`createArticleInTransaction`（默认分类自动创建）、`updateTitleInTransaction`、`moveInTransaction`、`deleteArticleInTransaction`（引用检查 → 软删 → 活动日志，提交后删字节）、`savePageInTransaction`（`FOR UPDATE` → 替换该页 → `derivePlainText` → `updated_at`）。

- [ ] **Step 3: 实现 Action**

`'use server'` + `validatedActionWithUserObject`；refusal 映射 `forbidden`；返回 `{ success, data }`（`articleId` / `savedAt` / `page`）；新建/改标题/移分类/删除后 `revalidatePath` 谱文列表路径，**保存页不 revalidate**。

- [ ] **Step 4: 写失败测试（保存状态机）→ 实现**

`tests/article-save-state.test.ts`：`idle→dirty→saving→saved/error` 转移；任一页未保存时顶栏不得显示「已保存」。

- [ ] **Step 5: 门禁与提交**

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

- [ ] **Step 1: 列表页与新建**

`articles/page.tsx` 换成 RSC 查询 + `article-list.tsx` + `article-folder-tree.tsx` + `new-article-dialog.tsx`（标题 1–60 字、分类下拉含「未分类」、地区只读 `project.countries_regions || '中国'`）；分类管理入口按 `hasPermission(role, 'project.write')` 显隐。

- [ ] **Step 2: 编辑器壳与单页编辑器**

`article-editor-shell.tsx` 三区布局 + 顶栏（返回 / 标题 / 地区 / 保存状态 / 立即保存，**无**分享、发布、导出、版式入口）；`tiptap-editor.tsx` 用 StarterKit 关掉禁用节点，仅留段落、两级标题、`undoRedo`、`articleImage`、`textStyle`；**只在首次挂载用 RSC 数据初始化**。

- [ ] **Step 3: 自动保存与回显**

停止输入 2 秒提交当前页；「立即保存」提交所有改动页；成功用 `data.page` 对齐该页（该页已无未提交改动时）；失败保留内容并给重试。

- [ ] **Step 4: 离开保护**

应用内离开 `await` 保存 → 成功 `router.push`，失败停留提示；`beforeunload` 在有未保存改动时拦截。

- [ ] **Step 5: 删除确认与概览入口**

删除谱文确认框用 `getArticleDeletePreview`（页数 / 图片数 / 编目引用）；删除分类确认框用 `getFolderDeletePreview`（分类数 / 篇数）；概览页加「新建谱文」入口。

- [ ] **Step 6: 手工验证（quickstart US1）**

按 [quickstart.md](../../../specs/002-article-authoring/quickstart.md) 的 US1 九条走一遍，记录实际输出。

- [ ] **Step 7: 门禁与提交**

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm arch:check
git add app/ components/article/ 
git commit -m "feat(article): 谱文列表页与三区编辑器（自动保存、离开保护）"
```

---

### Task 8: US1 E2E（T031）

**Files:**
- Create: `tests/e2e/article-authoring.spec.ts`

- [ ] **Step 1: 写 US1 段**

新建 → 输入两段 → 等「已保存」→ 刷新一致 → 改标题 → 移分类 → 删除（确认框文案含页数）。

- [ ] **Step 2: 运行**

Run: `pnpm test:e2e -- article-authoring`
Expected: PASS（本地模式会清空 `_test` 库，注意别指向开发库）

- [ ] **Step 3: 提交**

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

- [ ] **Step 1: 写失败测试**

加页（服务端生成页 id）、超 100 页拒绝、删最后一页拒绝、重排集合不一致拒绝、重排后页序持久。Run 确认失败。

- [ ] **Step 2: 实现服务层与 Action**

`addArticlePageAction` / `deleteArticlePageAction`（删页后清理该页独有图片字节）/ `reorderArticlePagesAction`；三者都**不 revalidate**。

- [ ] **Step 3: 页缩略图组件**

页序列表 + 添加页 + 拖拽排序 + 切页前先提交当前页（失败则停留）；缩略图用文本摘要，不渲染整页 DOM。

- [ ] **Step 4: E2E US2 段 + 门禁 + 提交**

```bash
pnpm test:integration -- articles && pnpm test:e2e -- article-authoring && pnpm typecheck
git add lib/article/ components/article/page-thumbnails.tsx tests/
git commit -m "feat(article): 多页编辑（加页、切页先保存、拖拽重排、删页）"
```

---

### Task 10: US3 图片（T036–T041）

**Files:**
- Create: `components/article/editor/article-image-node.tsx`、`components/article/editor/paste-filter.ts`
- Modify: `components/article/editor/toolbar.tsx`、`lib/article/schemas.ts`、`lib/article/constants.ts`
- Test: `tests/integration/media.test.ts`、`tests/e2e/article-authoring.spec.ts`

- [ ] **Step 1: 写失败测试**

上传令牌只对成员签发、跨组织读取 404、含图文档保存时前缀不符拒绝、单页 7 图拒绝。Run 确认失败。

- [ ] **Step 2: 图片节点与工具栏**

`Image.extend({ name: 'articleImage' })` 加 `width`（`small` / `medium` / `full`，缺省 `full`）；工具栏「插入图片」在光标处插入块级节点；三档宽度切换。

- [ ] **Step 3: 上传接线与预校验**

blob 模式走 `upload()` 直传、fs 模式走 `POST /api/media/upload`；客户端预校验 MIME/10MB/单页 6 张并给中文提示，服务端权威校验。

- [ ] **Step 4: 粘贴清洗**

`paste-filter.ts`：只留段落/两级标题/文字，丢外链图与所有禁用 mark。

- [ ] **Step 5: E2E US3 段 + 门禁 + 提交**

```bash
pnpm test:integration -- media && pnpm test:e2e -- article-authoring && pnpm typecheck
git add components/article/editor/ lib/article/ tests/
git commit -m "feat(article): 正文插图（三档宽度、上传校验、粘贴清洗）"
```

---

### Task 11: US4 字体与字号（T042–T044，P2）

**Files:**
- Modify: `lib/article/schemas.ts`、`lib/article/constants.ts`、`components/article/editor/toolbar.tsx`
- Test: `tests/article-schemas.test.ts`

- [ ] **Step 1: 写失败测试**

白名单外 `fontFamily`（如「微软雅黑」）与 `fontSize`（如 `28px`）拒绝；白名单内（宋/黑/楷、14/16/19px）接受。Run 确认失败。

- [ ] **Step 2: 实现**

`textStyle` + `fontFamily` + `fontSize` 两个白名单 mark；工具栏下拉；服务端照样校验。

- [ ] **Step 3: 手工验证替代字体**

在无楷体环境打开，确认显示为替代字体而非方块（quickstart US4 第 3 条）。

- [ ] **Step 4: 提交**

```bash
pnpm test -- article-schemas
git add lib/article/ components/article/editor/toolbar.tsx tests/article-schemas.test.ts
git commit -m "feat(article): 字体与字号（系统字体白名单，P2）"
```

---

### Task 12: 文档同步、安全回归与全量门禁（T045–T050）

**Files:**
- Modify: `docs/architecture/04-数据视图-数据架构.md`、`docs/architecture/11-需求与实现状态.md`、`docs/architecture/05-接口与集成设计.md`、`AGENTS.md`
- Test: `tests/security-regressions.test.ts`

- [ ] **Step 1: 文档同步**

04 §10.1 补 `article.content` 结构说明（不改 DDL）；11 §5.5 谱文状态与 FR-ART-1「类型→分类」；05 §6.6 按 contracts §1.11 的映射改成已实现清单；`AGENTS.md` §1「尚未实现」清单移除谱文编辑器与图片。

- [ ] **Step 2: 安全回归测试**

`viewer` 直接调写 Action 被拒；跨组织 `articleId` 404；跨组织 `/api/media` 404；上传令牌不能扩大前缀。**不改** `tests/permissions.test.ts` 与 `tests/access-control.test.ts`（本期零权限变更）。

- [ ] **Step 3: 性能夹具**

`tests/e2e/fixtures/article.ts` 构造 20 页 / 40 图（SC-003）与 200 篇列表（SC-010）的测试数据，在 `tests/e2e/article-authoring.spec.ts` 里记录切页耗时与滚动帧率。

- [ ] **Step 4: 全量门禁**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm arch:check && pnpm docs:check --strict && pnpm test:integration && pnpm test:e2e`
Expected: 全部 0 issue / PASS（若集成或 E2E 环境不可用，记录哪一项没跑、为什么）

- [ ] **Step 5: quickstart 演练**

按 quickstart 逐条走完，特别确认：`editor` 看不到分类入口、地区只读、离开保护、跨组织 404、超限图片零副作用。

- [ ] **Step 6: 提交（拆分）**

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
