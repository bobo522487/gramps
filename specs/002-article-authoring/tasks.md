# Tasks: 谱文录入与多页编辑

**Input**: 设计文档 `specs/002-article-authoring/`（spec.md、plan.md、research.md、data-model.md、contracts/、quickstart.md）

**Prerequisites**: [plan.md](./plan.md)（技术栈与结构）、[spec.md](./spec.md)（44 FR / 4 故事 / 11 SC）、[research.md](./research.md)（15 条决策）、[data-model.md](./data-model.md)、[contracts/actions-and-permissions.md](./contracts/actions-and-permissions.md)、[quickstart.md](./quickstart.md)

**Tests**: 本期**包含**测试任务——宪法原则 IV（先失败测试后实现，NON-NEGOTIABLE）要求 SQL、约束、隔离、事务相关改动必须有真实 PostgreSQL 集成测试，且每个 Action 先写失败测试。

**Organization**: 任务按用户故事分组，每个故事可独立实现与验证；执行清单与步骤细节见唯一执行计划 `docs/superpowers/plans/2026-11-02-article-authoring.md`（本文件是任务索引，不另起第二套步骤）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可与同阶段其他任务并行（不同文件、无未完成依赖）
- **[Story]**：任务所属用户故事（US1–US4）
- 每条任务都带**确切文件路径**

## Path Conventions

沿用仓库单层布局：`app/`、`components/`、`lib/`、`tests/`（无 `src/`）。域代码集中在 `lib/article/**` 与 `components/article/**`。

---

## Phase 1: Setup（共享基础设施）

**Purpose**：装依赖、改配置与文档前置项，为后续所有阶段解除阻塞。

- [x] T001 安装依赖（TipTap 3 六包 + `@vercel/blob` ≥2.3），确认版本对齐：`package.json`、`pnpm-lock.yaml`
- [x] T002 [P] 在 `biome.json` 增加 `noRestrictedImports`：`@tiptap/*` 只允许 `lib/article/**` 与 `components/article/editor/**`
- [x] T003 [P] 改 `docs/decisions/0010-rich-text-editor-selection.md` 状态句（删「尚未安装」，**保留 `决策 ≠ 现在安装` 字面串**）并同步 `docs/decisions/README.md` 的 ADR-12 行
- [x] T004 [P] 新增媒体存储决策 `docs/decisions/0019-media-storage.md`，并在 `docs/decisions/README.md` §1 索引与 §2 表格各加一行
- [x] T005 [P] `lib/config.ts` 增加可选 `BLOB_READ_WRITE_TOKEN` 与 `mediaMode: 'blob' | 'fs'` 判定（F7：只在此处读 `process.env`）
- [x] T006 [P] `.gitignore` 增加 `.data/`（本地媒体落盘目录）
- [x] T007 [P] 核对 `vitest.coverage.config.ts` 的 include/exclude 是否覆盖 `lib/article/**`，按现有规则补齐

**Checkpoint**：`pnpm check && pnpm typecheck && pnpm test` 仍全绿（依赖已装但未接线）。

---

## Phase 2: Foundational（阻塞所有用户故事）

**Purpose**：Action 通道、文档结构、校验、媒体存储与查询层——每个用户故事都要用到。

**⚠️ CRITICAL**：本阶段完成前不要开始任何用户故事。

- [x] T008 `lib/auth/types.ts` 给 `ActionState` 增加可选 `data`；`lib/auth/middleware.ts` 新增 `validatedActionWithUserObject`（对象入参，契约见 contracts §0.1）
- [x] T009 [P] `lib/article/constants.ts`：`ARTICLE_ERRORS` 中文文案表（9 个 code，全小写）、上限常量（100 页 / 6 图 / 10MB）
- [x] T010 [P] `lib/article/doc.ts`：`parseArticleContent` / `derivePlainText` / `countImages` / `isReferenced`；测试 `tests/article-doc.test.ts`
- [x] T011 [P] `lib/article/schemas.ts`：Zod 入参 + 文档白名单（9 条不变量，data-model §2）；测试 `tests/article-schemas.test.ts`
- [x] T012 [P] `lib/article/media/store.ts`（`MediaStore` 接口 + `getMediaStore()`）、`fs-store.ts`、`blob-store.ts`
- [x] T013 `app/api/media/[...key]/route.ts`：双模式读取代理（`withApiLogging` + 会话 + 成员校验 + 404 语义）；测试 `tests/integration/media.test.ts`
- [x] T014 [P] `app/api/blob/upload/route.ts`：`handleUpload({ onBeforeGenerateToken })`，模式不匹配 404
- [x] T015 [P] `app/api/media/upload/route.ts`：fs 模式上传（MIME 魔数 / 10MB / 前缀 / 成员校验）
- [x] T016 `lib/db/queries/articles.ts`：列表（含页数）、单篇、分类篇数（`JOIN folder f … AND f.kind = 1`）、`getArticleDeletePreview`、`getFolderDeletePreview`、引用检查（含 `catalog.deleted_at` 与 `book.deleted_at`）

**Checkpoint**：`pnpm test:integration` 的媒体与查询用例通过；`/api/media/<key>` 跨组织返回 404。

---

## Phase 3: User Story 1 - 建一篇谱文并写下第一段文字（Priority: P1）🎯 MVP

**Goal**：从列表页新建谱文 → 进入三区编辑器 → 打字 → 2 秒自动保存 → 刷新一致；含改标题、移分类、删除与离开保护。

**Independent Test**：新建一篇谱文、输入两段文字、等 2 秒、刷新页面——文字与标题都在；列表与分类篇数正确；删除时确认框给出页数/图片数。

### Tests for User Story 1（先失败）

- [ ] T017 [P] [US1] 集成测试：`createArticleAction` / `updateArticleTitleAction` / `moveArticleAction` / `deleteArticleAction` 的权限、跨组织 404、编目引用阻止 —— `tests/integration/articles.test.ts`
- [ ] T018 [P] [US1] 单测：保存状态机 `idle→dirty→saving→saved/error` 与「任一页未保存不得显示已保存」—— `tests/article-save-state.test.ts`

### Implementation for User Story 1

- [ ] T019 [US1] `lib/article/services.ts`：`createArticleInTransaction`（含默认分类自动创建）、`updateTitleInTransaction`、`moveInTransaction`、`deleteArticleInTransaction`（单事务 + 引用检查 + 活动日志）
- [ ] T020 [US1] `lib/article/actions.ts`：`createArticleAction` / `updateArticleTitleAction` / `moveArticleAction` / `deleteArticleAction`（契约 §1.1–§1.4）
- [ ] T021 [US1] `lib/article/services.ts` + `actions.ts`：`saveArticlePageAction`（`FOR UPDATE`、按页替换、`derivePlainText`、`savedAt` 回显）
- [ ] T022 [P] [US1] `components/article/article-list.tsx`（倒序、页数、标题搜索）与 `components/article/new-article-dialog.tsx`（标题 + 分类 + 只读地区）
- [ ] T023 [P] [US1] `components/article/article-folder-tree.tsx`（篇数、未分类、分类管理入口按 `project.write` 显隐）
- [ ] T024 [US1] `app/(dashboard)/dashboard/project/[projectRef]/articles/page.tsx`：占位 → 分类树 + 列表 + 新建
- [ ] T025 [P] [US1] `app/(dashboard)/dashboard/project/[projectRef]/page.tsx`：加「新建谱文」入口（FR-008）
- [ ] T026 [US1] `app/(dashboard)/dashboard/project/[projectRef]/articles/[articleId]/page.tsx` + `components/article/article-editor-shell.tsx`（三区布局、RSC 只首次初始化）
- [ ] T027 [P] [US1] `components/article/editor/tiptap-editor.tsx`（单页、禁用的节点集在 StarterKit 配置里）+ `components/article/article-title-input.tsx`（1–60 字、失焦提交、空值阻断）
- [ ] T028 [US1] `components/article/save-status.tsx` + 自动保存接线（停止输入 2 秒、按页提交、「立即保存」提交全部改动页）
- [ ] T029 [US1] 离开保护：`components/article/article-editor-shell.tsx` 内应用内 `await` 保存后导航（失败停留）；`beforeunload` 原生确认
- [ ] T030 [US1] 删除确认框接 `lib/db/queries/articles.ts` 的 `getArticleDeletePreview` / `getFolderDeletePreview`（页数、图片数、分类数），UI 在 `components/article/article-list.tsx` 与 `components/article/article-folder-tree.tsx`
- [ ] T031 [P] [US1] E2E：`tests/e2e/article-authoring.spec.ts` 的 US1 段（新建 → 打字 → 刷新一致 → 改标题 → 移分类 → 删除）

**Checkpoint**：US1 独立可用；`pnpm test:integration` 与 E2E US1 通过。

---

## Phase 4: User Story 2 - 写长了就加页（Priority: P1）

**Goal**：右栏加页、切页（先保存）、拖拽重排、删页（至少保留一页）。

**Independent Test**：加第 2 页并写字 → 切回第 1 页内容正确 → 拖拽换序 → 刷新后页序保持 → 删到只剩一页被拒。

- [ ] T032 [P] [US2] 集成测试：加页 / 删页 / 重排 / 页序一致性与 100 页上限 —— `tests/integration/articles.test.ts`
- [ ] T033 [US2] `lib/article/services.ts` + `actions.ts`：`addArticlePageAction` / `deleteArticlePageAction` / `reorderArticlePagesAction`（服务端生成页 id）
- [ ] T034 [US2] `components/article/page-thumbnails.tsx`：页序列表、添加页、拖拽排序、切页前先提交
- [ ] T035 [P] [US2] E2E：`tests/e2e/article-authoring.spec.ts` 的 US2 段（含「有未保存改动时切页先提交」）

**Checkpoint**：US1 + US2 各自独立可用；多页保存与页序刷新一致。

---

## Phase 5: User Story 3 - 配一张老照片（Priority: P1）

**Goal**：光标处插入块级图片、三档宽度、超限中文拒绝且不影响已有内容、删页清理字节。

**Independent Test**：插入 JPG → 默认整宽 → 改「中」→ 刷新仍为中 → 选 20MB 文件被拒且内容零变化 → 第 7 张被拒 → 删页后独有文件消失。

- [ ] T036 [P] [US3] 集成测试：上传令牌签发校验、跨组织读取 404、含图文档保存与 pathname 前缀校验 —— `tests/integration/media.test.ts`
- [ ] T037 [P] [US3] `components/article/editor/article-image-node.tsx`：`Image.extend({ name: 'articleImage' })` + `width` 三档
- [ ] T038 [US3] `components/article/editor/toolbar.tsx`：插入图片（客户端预校验 MIME/10MB/单页 6 张）+ 上传接线（blob 直传 / fs 上传）
- [ ] T039 [P] [US3] `components/article/editor/paste-filter.ts`：粘贴清洗（丢格式、丢外链图）
- [ ] T040 [US3] 服务端权威校验与文案：`lib/article/schemas.ts`（单页 ≤6 图、pathname 前缀）+ `lib/article/constants.ts` 文案
- [ ] T041 [P] [US3] E2E：`tests/e2e/article-authoring.spec.ts` 的 US3 段（插入 → 改宽度 → 超限 → 删页清理）

**Checkpoint**：US1–US3 独立可用；媒体路径在本地 fs 模式全流程可验。

---

## Phase 6: User Story 4 - 最后调一下字体（Priority: P2）

**Goal**：字体（宋/黑/楷）与字号（小/常规/大）两个白名单 mark，缺字体时替代显示。

**Independent Test**：选中一段设楷体+大 → 保存刷新仍生效 → 复制到另一段随文字带过去。

- [ ] T042 [P] [US4] `lib/article/schemas.ts` + `lib/article/constants.ts`：`fontFamily` / `fontSize` 白名单校验与文案
- [ ] T043 [US4] `components/article/editor/toolbar.tsx`：字体与字号下拉（`@tiptap/extension-text-style`）
- [ ] T044 [P] [US4] 单测：白名单外的字体/字号被拒 —— `tests/article-schemas.test.ts`

**Checkpoint**：P2 未交付时 SC-001…SC-008 仍成立（SC-009）。

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T045 [P] 文档同步：`docs/architecture/04-数据视图-数据架构.md` §10.1 补 `content` 结构说明；`docs/architecture/11-需求与实现状态.md` §5.5 谱文状态与 FR-ART-1「类型→分类」；`docs/architecture/05-接口与集成设计.md` §6.6 映射（contracts §1.11）；`AGENTS.md` §1「尚未实现」清单
- [ ] T046 [P] 安全回归：viewer 直接调 Action 被拒、跨组织 `articleId` 404、跨组织 `/api/media` 404、上传令牌不可扩大前缀 —— `tests/security-regressions.test.ts`
- [ ] T047 [P] 性能夹具：`tests/e2e/article-authoring.spec.ts` 的 20 页 / 40 图（SC-003）与 200 篇列表（SC-010）数据构造，辅助函数放 `tests/e2e/fixtures/article.ts`
- [ ] T048 全量门禁（无文件改动，输出记录进 PR 描述）：`pnpm check && pnpm typecheck && pnpm test && pnpm arch:check && pnpm docs:check --strict && pnpm test:integration && pnpm test:e2e`
- [ ] T049 按 [quickstart.md](./quickstart.md) 逐条演练，实际输出记录到 `docs/superpowers/plans/2026-11-02-article-authoring.md` 末尾（含 `editor` 看不到分类入口、地区只读、离开保护）
- [ ] T050 提交拆分：`package.json`、`biome.json`、`docs/decisions/**` 走 `chore(deps)`；`lib/article/**`、`components/article/**`、`app/**`、`tests/**` 走 `feat(article)`／`test(article)`；`docs/architecture/**`、`AGENTS.md` 走 `docs(spec)`，各自独立提交

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**：无依赖，立即开始
- **Phase 2 Foundational**：依赖 Phase 1，**阻塞全部用户故事**
- **Phase 3–6 用户故事**：依赖 Phase 2；US1 先做（MVP），US2/US3 可在 US1 落地后并行（两者都改 `page-thumbnails`/`toolbar` 之外的文件），US4 依赖 US1 的编辑器
- **Phase 7 Polish**：依赖所有要交付的故事

### User Story Dependencies

- **US1（P1）**：Phase 2 后即可开工，无跨故事依赖
- **US2（P1）**：依赖 US1 的编辑器壳与保存通道（复用 `saveArticlePageAction`）
- **US3（P1）**：依赖 US1 的编辑器与 Phase 2 的媒体通道；与 US2 文件不重叠，可并行
- **US4（P2）**：依赖 US1 的编辑器；与 US3 共用 `toolbar.tsx`，需顺序或同人合并

### Within Each User Story

- 先写失败测试（T017/T018/T032/T036/T042）→ 再写服务层 → 再写 Action → 再写 UI → 最后 E2E
- 服务层必须在单个 `withOrgWrite` 事务内，事务内 `FOR UPDATE` 复核

### Parallel Opportunities

- Phase 1 的 T002–T007 全可并行
- Phase 2 的 T009–T012、T014–T015 可并行；T013 与 T016 各自独立
- US2 与 US3 在 US1 完成后可由两人并行（文件集不重叠）
- Phase 7 的 T045–T047 可并行

## Parallel Example: User Story 1

```bash
# 先并行写两个失败测试
Task: "集成测试 create/updateTitle/move/delete 的权限与跨组织 404 —— tests/integration/articles.test.ts"
Task: "保存状态机单测 —— tests/article-save-state.test.ts"

# 再并行写互不依赖的 UI 组件
Task: "article-list.tsx 与 new-article-dialog.tsx"
Task: "article-folder-tree.tsx"
```

## Implementation Strategy

### MVP First（只做 US1）

1. Phase 1 + Phase 2（阻塞项）
2. Phase 3（US1）
3. **停下验证**：按 quickstart US1 走一遍，确认刷新一致与离开保护
4. 可演示后再进 US2 / US3

### Incremental Delivery

1. Setup + Foundational → 通道就绪
2. US1 → 独立验证（MVP：能建、能写、能存）
3. US2 → 多页
4. US3 → 图片
5. US4（P2）→ 字体字号
6. Polish → 文档、安全回归、性能夹具、全量门禁

## Notes

- `[P]` 任务必须改不同文件且无未完成依赖
- 每个故事完成后都应能独立演示；不要为「顺手」把别的故事拉进来
- 装 TipTap 与改 ADR 0010 状态句必须在**同一个 commit**，否则 `tests/docs-consistency.test.ts` 会红
- 保存路径**不得**调 `revalidateWholeConsole()`（会把服务端快照推回编辑器）
- 权限口径本期一个串都不改；分类管理入口对 `editor` 隐藏
