# Tasks: 谱文编辑器 Word 化与常用格式

**Input**: 设计文档 `specs/003-article-editor-wordlike/`（[spec.md](./spec.md)、[plan.md](./plan.md)）

**Prerequisites**: [plan.md](./plan.md)（Summary / Phase A–E / 硬边界）、[spec.md](./spec.md)（19 FR / 3 用户故事 / 8 SC）；002 编辑器与白名单已在 main。

**Tests**: 含测试任务——先扩失败单测（白名单拒颜色/嵌套列表、收 B/I/U/list/align），再改实现；E2E 覆盖 Word 化主路径与查看者无工具栏。

**Organization**: 按 plan Phase A→E；用户故事标签对齐 spec US1–US3。本文件是任务索引；若另落 `docs/superpowers/plans/`，两边不并行维护两套清单。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可与同阶段其他任务并行（不同文件、无未完成依赖）
- **[Story]**：US1 格式能力 / US2 纸张与迷你纸页 / US3 查看者只读
- 每条任务带**确切文件路径**

## Path Conventions

沿用单层布局：`app/`、`components/`、`lib/`、`tests/`。域代码在 `lib/article/**` 与 `components/article/**`；`@tiptap/*` 仅允许 `lib/article/**` 与 `components/article/editor/**`。

**硬边界（违反即缺陷）**：只修订 002 FR-031；不做颜色/行距/表格/引用/图注/嵌套列表/任务清单；不做模板/导出/分享；查看者工具栏**不渲染**；零迁移、无新 Action、无新媒体通道；嵌套列表 **压平保留文字**。

---

## Phase 1: Setup（共享前置）

**Purpose**：确认依赖与记账点，不改业务行为。

- [ ] T001 确认 TipTap 3 对齐能力：若需 `@tiptap/extension-text-align` 则写入 `package.json` / `pnpm-lock.yaml`，并按 ADR 0009 §1 在实现 PR 描述记账；Underline 优先复用 StarterKit（不新开包）
- [ ] T002 [P] 核对 `biome.json` `noRestrictedImports`：`@tiptap/*` 仍仅 `lib/article/**` + `components/article/editor/**`

**Checkpoint**：`pnpm check && pnpm typecheck && pnpm test` 仍绿（未接线新格式）。

---

## Phase 2: Foundational — 白名单与文档模型（阻塞全部用户故事）

**Purpose**：plan Phase A——服务端权威白名单与 sanitize；**完成前不要开始 UI 故事**。

- [ ] T003 扩 `lib/article/schemas.ts`：marks 增加 `bold` / `italic` / `underline`；节点增加 `bulletList` / `orderedList` / `listItem`；块 attrs 允许 `textAlign: left|center|right`
- [ ] T004 扩 `lib/article/doc.ts`：`ALLOWED_NODE_TYPES` / sanitize 与 schemas 同一清单；嵌套 list **压平保留文字**；`derivePlainText` 对 listItem 仍取字；不抬 `schemaVersion`
- [ ] T005 [P] 可选：`lib/article/constants.ts` 增加对齐枚举常量（若实现需要）
- [ ] T006 [P] 失败单测扩 `tests/article-schemas.test.ts`：合法含 B/I/U/list/align 过检；颜色 / blockquote / table / 任务清单被拒；旧无新 mark 文档仍过
- [ ] T007 [P] 失败单测扩 `tests/article-doc.test.ts`：sanitize 压平嵌套 list；plain_text 列表取字；空 marks 不残留

**Checkpoint**：单测先红后绿；无 Action 签名变更；旧文可打开。

---

## Phase 3: User Story 1 - 常用格式（B/I/U、单层列表、对齐）（Priority: P1）🎯 MVP

**Goal**：编辑器启用格式；分组工具栏；粘贴按白名单放行；保存刷新一致。

**Independent Test**：选中文字加粗/列表/右对齐 → 等自动保存 → 刷新仍在；从外部粘贴嵌套列表被压平；粘贴颜色/表格被丢。

### Tests for User Story 1（先失败）

- [ ] T008 [P] [US1] 单测：`components/article/editor/paste-filter.ts` —— `tests/article-paste-filter.test.ts`（新建或扩）：放行 B/I/U、单层 ul/ol、对齐；嵌套压平；丢颜色/表格/外链图
- [ ] T009 [P] [US1] 按需集成：含新 mark 的 `saveArticlePage` 读回一致 —— `tests/integration/articles.test.ts`（不改 Action 契约）

### Implementation for User Story 1

- [ ] T010 [US1] `components/article/editor/tiptap-editor.tsx`：StarterKit 打开 bold/italic/underline/bulletList/orderedList；挂 TextAlign（`paragraph`/`heading`）；禁 sink/lift 嵌套；空选区 B/I/U 走 storedMarks
- [ ] T011 [P] [US1] 可选新增 `components/article/editor/text-align.ts` 封装 TextAlign 配置（控行数 ≤400）
- [ ] T012 [US1] `components/article/editor/toolbar.tsx`：分组（撤销重做｜段落｜字体字号｜B/I/U｜列表｜对齐｜插图）；`isActive`；无「文件/开始」菜单；必要时拆分组子组件控行数
- [ ] T013 [US1] `components/article/editor/paste-filter.ts`：与 schemas/doc 同口径放行与压平
- [ ] T014 [P] [US1] E2E：`tests/e2e/article-authoring.spec.ts`（或新建 `article-wordlike.spec.ts`）——加粗+列表+对齐 → 保存 → 刷新一致

**Checkpoint**：US1 独立可演示；002 自动保存/插图/撤销重做仍可用。

---

## Phase 4: User Story 2 - 纸张感与迷你纸页（Priority: P1）

**Goal**：桌面+白纸观感；页条迷你纸页；窄屏工具栏可换行且能力不缺。

**Independent Test**：编辑区可辨「纸在桌上」；≥3 页时页条为迷你纸样式；当前页摘要跟本地草稿。

- [ ] T015 [US2] `components/article/editor/tiptap-editor.tsx`（及既有 canvas 样式）：纸张感布局（既有设计 token；禁止外来主题包）
- [ ] T016 [US2] `components/article/page-strip.tsx`：迷你纸页视觉；片段规则对齐 FR-005（当前页本地草稿，其他页最新已知）；不做 DOM/位图缩略
- [ ] T017 [P] [US2] 窄屏：工具栏换行/收纳，能力不缺（SC-007）——同 `toolbar.tsx` / 壳层样式
- [ ] T018 [P] [US2] E2E 或手工清单：≥3 页迷你纸切页可见（可与 T014 同文件分段）

**Checkpoint**：纸面与页条可辨；无外来主题；性能无整页缩略。

---

## Phase 5: User Story 3 - 查看者只读（Priority: P1）

**Goal**：`editable===false` 时不挂载格式工具栏及其他写入口；只读仍见排版与纸张/页条。

**Independent Test**：viewer 打开一篇谱文 —— DOM 无工具栏区域（不只 disabled）；无「立即保存」、无插图上传；纸面与页条可见。

- [ ] T019 [US3] `components/article/editor/tiptap-editor.tsx`：`editable===false` 时**不渲染** `EditorToolbar`
- [ ] T020 [US3] 回归 `components/article/article-editor-shell.tsx`：`canWrite` 守护顶栏写控件；确认插图等写入口对 viewer 消失
- [ ] T021 [P] [US3] 巡检：界面无模板/导出/分享/发布/外来主题灰色入口（SC-005）
- [ ] T022 [P] [US3] E2E：查看者角色打开编辑页 —— 无工具栏节点；排版可见

**Checkpoint**：SC-006 工程侧可自动化证明；与 US1/US2 观感不冲突。

---

## Phase 6: Polish & Cross-Cutting

- [ ] T023 [P] 002 回归抽测：多页切页保存、插图三档宽度、撤销重做覆盖新格式 —— 既有 E2E/手工
- [ ] T024 [P] 文档：`docs/architecture/11-需求与实现状态.md` 互链注明 **FR-031 由 003 修订**（**不改** 002 `spec.md` 全文）
- [ ] T025 [P] 可选：`docs/decisions/0010-rich-text-editor-selection.md` 短注 003 启用 B/I/U 与单层列表；若 `AGENTS.md` / 实现状态仍写「无加粗」则改掉
- [ ] T026 全量门禁（输出记入 PR）：`pnpm check && pnpm typecheck && pnpm test && pnpm arch:check && pnpm docs:check --strict`；按范围补 `test:integration` / `test:e2e`
- [ ] T027 SC-001/003/004 用户抽测交给质量 **converge** 定场次（本 tasks 不阻塞；挂账注明）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**：立即
- **Phase 2 Foundational**：依赖 Phase 1；**阻塞** US1–US3
- **Phase 3 US1**：依赖 Phase 2（MVP）
- **Phase 4 US2**：依赖 Phase 2；可与 US1 后半并行（不同文件：样式/page-strip vs toolbar 需协调）
- **Phase 5 US3**：依赖 US1 工具栏挂载点（T010/T012）
- **Phase 6 Polish**：依赖要交付的故事

### User Story Dependencies

- **US1**：Phase 2 后即可；格式 MVP
- **US2**：主要改样式与 page-strip；与 US1 的 toolbar 文件可能交叉，同人顺序或拆 PR
- **US3**：依赖 US1 的「工具栏可被条件不挂载」

### Parallel Opportunities

- T006/T007 可并行；T008/T009 可并行
- T011 与 T013 可在 T010 配置点明确后并行
- T015/T016 在 US1 编辑器稳定后可并行
- T024/T025 可并行

## Implementation Strategy

### MVP First（US1）

1. Phase 1 + Phase 2
2. Phase 3（格式）
3. **停下验证**：加粗/列表/对齐保存刷新 + 粘贴压平
4. 再进 US2 观感 → US3 查看者 → Polish

### Notes

- `[P]` 必须改不同文件且无未完成依赖
- 白名单与 TipTap schema **同一清单**；PR 自查对照表
- 保存路径不得 `revalidateWholeConsole()`
- 范围漂移（颜色/表格「顺手做」）按硬边界打回
- 合入前经大总管问主人【决策】
