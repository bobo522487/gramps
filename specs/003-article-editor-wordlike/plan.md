# Implementation Plan: 谱文编辑器 Word 化与常用格式

**Branch**: `003-article-editor-wordlike`（仅规格目录名，不创建 git 分支） | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)

**Input**: 规格 [spec.md](./spec.md) —— 19 条 FR（FR-001…019）、3 个用户故事、8 条成功标准；相对 002 的**行为增强**，以新格式要求**修订并取代** 002 FR-031 中「禁止加粗/斜体/下划线/项目符号」的禁令。Status 仍为 Draft，不挡本 plan（checklist 16/16 全绿 + clarify 两轮已落）。

**Note**: 本文件是 Spec Kit `/speckit-plan` 设计输入。任务拆分由后续 `/speckit-tasks` 生成；执行计划若另落 `docs/superpowers/plans/`，两边不并行维护两份任务清单（constitution 规格层纪律）。设计决策依据见同目录后续 `research.md`（Phase 0，本回合可内嵌「Research 摘要」）；数据结构增量见下文「数据与白名单」；接口契约本期**不新增** Server Action / Route Handler。

---

## Gate：checklist / clarify 过门

| 项 | 结论 | 说明 |
|---|---|---|
| `checklists/requirements.md` | **PASS** | 16/16 全勾；Validation notes 写明 clarify 后仍全绿、ready for `/speckit-plan` |
| Clarifications（specify 默认裁决 + clarify 轮） | **PASS** | 无残留 `[NEEDS CLARIFICATION]`；空选区 pending mark、查看者工具栏不显示、迷你纸页草稿来源、严格单层列表、快捷键非必须验收均已裁决 |
| Spec Status Draft | **不挡** | 产品经理口径：Draft 不挡开 plan；plan 前已过 checklist |
| 与 002 关系 | **清晰** | 增强编辑区观感 + 格式能力；002 保存/权限/多页/插图/FR-041/FR-042 继续有效，除非本规格明文修订（仅 FR-031） |

**过门结论**：**PASS with notes** —— 可进 plan；无红项挡门。Notes：Status 保持 Draft 直至实现收敛后由产品改；SC-001/003/004 含用户抽测口径，工程侧以自动化 + 手工巡检对照，不另开调研阻塞。

---

## Summary

在 **002 已交付的三区编辑器 + TipTap 白名单 + 按页自动保存**之上，做 Word 化**必要表面**与常用格式增量：

1. **纸张感编辑区**（FR-001/003/004）：浅色桌面 + 居中白纸（页边距/轻阴影/A4 可读宽），仍包在控制台壳内；只用云谱既有设计令牌，**禁止** vendoring Guizang/AGPL 外来主题。
2. **分组图标工具栏**（FR-002）：撤销重做｜段落样式｜字体字号｜**加粗/斜体/下划线**｜**列表**｜**对齐**｜插图；组间分隔；无「文件/开始」菜单栏。
3. **格式能力修订 FR-031**（FR-007…011）：启用 bold/italic/underline（含无选区 pending mark，对齐 Word）；严格单层 bullet/ordered list；段落左/中/右对齐；与既有标题/字体/字号/插图/撤销重做共存。
4. **服务端白名单同步**（FR-017）：`lib/article/schemas.ts` + `lib/article/doc.ts` 的节点/mark 白名单扩到新格式；粘贴清洗（`paste-filter.ts`）按新白名单保留、压平嵌套列表、仍丢弃颜色/表格等（FR-012/013）。
5. **迷你纸页预览**（FR-005）：`page-strip.tsx` 从「序号块」升级为迷你纸页表象；片段规则：当前页跟本地草稿，其他页最新已知内容；**不做**整页 DOM/位图缩略。
6. **查看者**（FR-018）：格式工具栏及其他写作用控件 **MUST NOT 渲染**（非禁用可见）；只读可见排版与纸张/页条观感。

**硬边界（产品旁观约束，违反即缺陷）**：

- 守住 003 范围：只修订 002 **FR-031** 禁令范围；**明确不做**文字颜色、行距、表格、引用块、图片 alt/图注、嵌套/多级列表、任务清单（FR-012）。
- **不做**模板套用/版式库/对齐基线（002 FR-042 / SC-011）、导出/分享/发布（002 FR-041）；界面不得留灰色入口（SC-005）。
- 查看者：**工具栏不出现**（FR-018 / SC-006），含「立即保存」、插图上传等写入口。
- 不做正文全文检索（ADR 0011；003 Assumptions 非目标）；不双写事实层；不新增表/迁移；不改能力矩阵；不改 `lib/lineage/**`。

改动集中在编辑器前端 + 文档白名单/粘贴清洗 + 少量样式与文档同步；**零迁移、零新 Action、零新媒体通道**。

---

## Technical Context

**Language/Version**：与主干一致——TypeScript（strict）、Node 24、React 19、Next.js App Router、pnpm。

**Primary Dependencies（增量）**：

- **复用已装**：`@tiptap/react` / `@tiptap/core` / `@tiptap/pm` / `@tiptap/starter-kit` / `@tiptap/extension-text-style` / `@tiptap/extension-image`（002 / ADR 0010）。
- **预期新增（实现时按 ADR 0009 §1 记账）**：
  - 若 TipTap 3 StarterKit 未覆盖对齐：`@tiptap/extension-text-align`（或等价官方扩展）。
  - Underline：TipTap 3 StarterKit 默认含 underline；002 曾显式 `underline: false`——本期改为启用，**优先不开新包**。
  - Bold/Italic/List：StarterKit 内置，002 禁用 → 本期按白名单启用；列表需额外约束「禁止嵌套」。
- **不引入**：第二套编辑器、主题包、状态库、协同/CRDT、图片处理库、i18n。

**Storage**：仍为 `article.content` jsonb 分页包 `{ schemaVersion: 1, pages: [{ id, doc }] }`；新 mark/节点写入既有 `doc`；`plain_text` 仍只由 `lib/article/doc.ts` 派生（ADR 0010）。**无新表、无迁移、不抬 `schemaVersion`**（加法兼容；旧文无新标记照常打开）。

**Testing**：Vitest 扩 `article-doc` / `article-schemas` / paste-filter 单测；必要时集成测「含新 mark 的保存→读回」；Playwright 增 Word 化主路径（加粗/列表/对齐 → 已保存 → 刷新一致）+ 查看者无工具栏巡检。门禁：`pnpm check && pnpm typecheck && pnpm test`（按范围 + integration/e2e/docs/arch）。

**Target Platform**：同 002——Vercel + Neon；桌面优先，窄屏工具栏可换行/收纳（FR 窄屏 Edge Case / SC-007）。

**Project Type**：Next.js 全栈单体；改动落在既有 `components/article/**` 与 `lib/article/**`。

**Performance Goals**：沿用 002（切页 <300ms、2s 自动保存）；迷你纸页不得引入整页渲染；页条仍用文本片段（现有 `pagePlainText`）。

**Constraints**：单文件 ≤400 行（`arch:check`）；只在 `lib/config.ts` 读 env；简体中文、无裸色值；非成员 404；软删语义不变；零后台任务（ADR 0005）；`@tiptap/*` 仍限制在 `lib/article/**` 与 `components/article/editor/**`（biome）。

**Scale/Scope**：不改篇/页/图上限；增量约数个编辑器文件改写 + 白名单/粘贴 + 样式 + 测试 + 文档同步（`11` FR-ART 口径、必要时 ADR 0010 备注「003 放开部分行内/列表」）。

---

## Constitution Check

*GATE：Phase 0 前判定；设计定稿后复核。*

| 门 | 判定 | 依据 |
|---|---|---|
| I 组织隔离与服务端授权 | 通过 | 不改鉴权；保存仍走既有 `saveArticlePage` + `withOrgWrite`；查看者写入仍拒；越权 404 |
| II 认证与连接分离 | 通过 | 不碰 auth / 新媒体 Route |
| III 写路径单事务 | 通过 | 不新增写路径；页保存事务语义不变；格式只是 `doc` 载荷 |
| IV 先失败测试后实现 | 通过（计划） | 先扩红单测（白名单拒颜色/嵌套列表；收 bold/list/align）再改实现；E2E 主路径与查看者无工具栏 |
| V 单一事实来源与最小改动 | 通过 | 白名单只在 `schemas.ts` + `doc.ts`；粘贴只在 `paste-filter.ts`；`plain_text` 派生不改入口；不双写；不改 lineage |
| 附加：软删 / 迁移 / 中文 UI / 零后台任务 | 通过 | 零迁移；文案中文；token 用既有 UI；无队列 |
| 附加：检索边界 ADR 0011 | 通过 | 003 **不做**正文检索；不重建 `idx_article_search` |
| 附加：产品硬边界 | 通过 | FR-012/014/015/018 写入本 plan Summary；实现与评审按「违反即缺陷」执行 |

**Phase 0 结论**：无违例，可进入设计与 `/speckit-tasks`。**待观察**：是否新增 `@tiptap/extension-text-align`（ADR 0009 记账）；列表禁嵌套的 TipTap 配置点（见开放问题）。

### 设计后复核（本 plan 定稿时）

| 门 | 复核 |
|---|---|
| I–III | 仍通过：无新 Action/媒体通道；载荷仍经 Zod 白名单 |
| IV | 测试清单见「测试策略」 |
| V | 扩白名单是有意的单一事实源更新；Complexity Tracking 记依赖与禁嵌套取舍 |
| 查看者工具栏 | 从「disabled 仍渲染」改为「`editable===false` 不挂载 `EditorToolbar`」；顶栏写控件已由 `canWrite` 守护，需回归确认插图入口一并消失 |

---

## 002 已落地 vs 003 增量边界

| 能力 | 002 现状（main） | 003 增量 |
|---|---|---|
| 三区壳 + 顶栏保存/标题 | ✅ `article-editor-shell.tsx` | 保持；不写作用控件对查看者继续隐藏 |
| TipTap 编辑器 | ✅ 节点：paragraph/heading(1\|2)/text/articleImage；mark：仅 textStyle(字体/字号)；**bold/italic/underline/list 全关** | 启用 B/I/U + 单层列表 + 对齐；StarterKit 配置与 schema 同步 |
| 工具栏 | ✅ 撤销重做/段落标题/字体字号/插图；**disabled 时仍显示** | 分组 Ribbon 风格；加 B/I/U、列表、对齐；**查看者不渲染** |
| 画布观感 | 基础 `article-canvas`，无明确「桌面+纸面」 | 纸张感布局（token，非外来主题） |
| 页条 | ✅ 文本摘要缩略（`PageStrip`） | 迷你纸页视觉；片段规则对齐 FR-005（当前实现已用内存草稿摘要，基本符合，补样式与当前页强调） |
| 粘贴 | ✅ 剥光几乎所有 mark，列表压成段落 | 白名单放行 B/I/U、单层 ul/ol、对齐；嵌套压平；仍丢颜色/表格/外链图 |
| 保存/权限/媒体 | ✅ | 不改契约；仅 doc 形状加法 |
| 模板/导出/颜色/表格 | ❌ 已排除 | **继续排除**（硬边界） |

---

## Research 摘要（Phase 0，内嵌）

### R1 — 格式如何进 ProseMirror JSON（选：启用 StarterKit + 对齐扩展）

- **决策**：Bold/Italic/Underline/BulletList/OrderedList/ListItem 用 TipTap StarterKit 开关打开；TextAlign 用官方 text-align 扩展（若需新包则记账）；对齐作用在 `paragraph`/`heading`（及列表项内段落）。
- **理由**：与 ADR 0010「引擎=TipTap、形状=PM JSON」一致；自写 mark 无收益。
- **放弃**：换 Lexical/自写 contenteditable；把格式存成平行字段（双写，违 V）。

### R2 — 服务端白名单（选：扩 schemas + sanitize，不抬 schemaVersion）

- **决策**：`ALLOWED_NODE_TYPES` 增加 `bulletList` / `orderedList` / `listItem`；marks 增加 `bold` / `italic` / `underline`；块 attrs 允许 `textAlign: left|center|right`；Zod 同步。未知 mark/节点仍丢弃。
- **理由**：单一事实源；旧文无新字段兼容；单版本部署无双端分叉问题。
- **放弃**：`schemaVersion: 2` 迁移（无 DDL 需求，徒增分支）；服务端不校验只靠客户端（违权威在服务端）。

### R3 — 无选区 B/I/U（选：TipTap 默认 storedMarks / toggleMark）

- **决策**：依赖编辑器 stored marks（pending）；工具栏反映 `isActive`；无选区不整段套格式；仅 pending、未键入时保存不得出现空格式残片（保存前 `normalizePageDoc` / 空 marks 过滤已有基础，补测）。
- **放弃**：无选区改整段（违 clarify）；无选区无反应（违 Word 一致）。

### R4 — 禁嵌套列表（选：关 sink/lift 快捷键 + schema/粘贴压平）

- **决策**：不提供缩进控件；禁用 Tab 产生子列表的命令；粘贴嵌套 → 扁平单层；服务端/sanitize 若见深层 list 则**压平保留文字**（产品 2026-11-04 定稿）。
- **放弃**：允许多级再 UI 隐藏（快捷键会漏）；任务列表扩展。

### R5 — 纸张与迷你纸页（选：CSS token 增强，无缩略图引擎）

- **决策**：编辑区外层桌面背景 + 内层白纸阴影/最大宽度居中；`PageStrip` 卡片改为迷你纸样式；片段继续 `pagePlainText`。
- **放弃**：html2canvas/DOM 缩略；第三方皮肤包。

### R6 — 查看者工具栏（选：不挂载）

- **决策**：`TipTapEditor` 在 `editable===false` 时不渲染 `EditorToolbar`；与 shell 顶栏 `canWrite` 一致。只读仍渲染纸面与页条。
- **放弃**：工具栏 disabled 可见（违 FR-018 clarify）。

---

## Project Structure

### Documentation (this feature)

```text
specs/003-article-editor-wordlike/
├── spec.md                  # 规格（含 Clarifications）
├── plan.md                  # 本文件（落库目标路径）
├── research.md              # 可选：将上文 Research 摘要拆出（若 tasks 需要独立文件）
├── data-model.md            # 可选：仅写「相对 002 data-model 的 mark/节点增量」
├── quickstart.md            # 可选：手工验收路径（纸张/格式/查看者）
├── contracts/               # 本期可不新增（无新 Action）；若写则只补「doc 白名单变更说明」
├── checklists/
│   └── requirements.md      # 16/16 Complete
└── tasks.md                 # /speckit-tasks 生成（本阶段未产出）
```

配套文档（实现 PR 同批，非本草稿落库范围）：

```text
docs/architecture/11-需求与实现状态.md   谱文/FR-ART：注明 003 修订 FR-031，格式能力状态
docs/decisions/0010-...md                可选备注：003 启用 B/I/U 与单层列表（边界仍为 PM JSON）
AGENTS.md / implementation-status        若「尚未实现」清单仍写死「无加粗」则改掉
tests/**                                 白名单与 E2E 增量
```

### Source Code（预期触点）

```text
components/article/
├── editor/
│   ├── tiptap-editor.tsx      改：启用 B/I/U/list；条件渲染工具栏；纸面容器 class
│   ├── toolbar.tsx            改：分组；B/I/U、对齐、列表；图标化
│   ├── paste-filter.ts        改：白名单放行；嵌套列表压平
│   ├── text-style.ts          可能小改（对齐若挂 textStyle 则否——对齐优先块 attrs）
│   └── text-align.ts          【可选新增】封装 TextAlign 扩展配置
├── page-strip.tsx             改：迷你纸页视觉
└── article-editor-shell.tsx   核：查看者写入口；一般无需大改

lib/article/
├── schemas.ts                 改：节点/mark/textAlign 白名单
├── doc.ts                     改：ALLOWED_NODE_TYPES + sanitize 保留新 mark；列表走 collect 文本
└── constants.ts               可选：对齐枚举常量

tests/
├── article-doc.test.ts        扩
├── article-schemas.test.ts    扩
├── article-paste-filter.test.ts 扩或新增
└── e2e/…                      扩 Word 化 + 只读无工具栏
```

**Structure Decision**：不新开顶层包；延续 `lib/article` + `components/article` 划分；TipTap 仍被 biome 限制在编辑器目录。

---

## Complexity Tracking

| Violation / 取舍 | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 可能新增 `@tiptap/extension-text-align` | 段落对齐是 P0（FR-009）；StarterKit 不含对齐 | 用行内 `textStyle` 存 textAlign：语义错（对齐是块级），且与字体 mark 耦合 |
| 列表「禁嵌套」需额外配置/压平 | clarify 严格单层；仅 UI 隐藏不够 | 只藏按钮：Tab/快捷键与粘贴仍可造嵌套，服务端若全收则违 FR-008 |
| 粘贴白名单从「几乎全剥」改为「有限放行」 | FR-013 明确允许白名单格式 | 继续全剥：用户从 Word 贴入加粗/列表会丢，伤 SC-001 |
| 纸张感纯 CSS | FR-001/004 | 引入外来主题包：许可与产品一致性均否决（spec Assumptions） |

---

## 实施阶段（供 `/speckit-tasks` 拆解）

> 阶段顺序有依赖；同阶段内标 `[*]` 的可并行。

### Phase A — 白名单与文档模型（阻塞后续）

1. 扩 `schemas.ts` / `doc.ts`：bold/italic/underline marks；bulletList/orderedList/listItem；textAlign。
2. 单测：合法 doc 过检；颜色/blockquote/table/嵌套 list 被拒或压平；旧无 mark 文档仍过；`derivePlainText` 对列表项仍取字。
3. *不改* Action 签名。

### Phase B — 编辑器能力

1. `tiptap-editor.tsx`：打开 StarterKit 对应项；挂 TextAlign；禁 sinkListItem/嵌套。
2. `toolbar.tsx`：分组 UI；B/I/U（含 isActive）；列表 toggle；对齐；保留既有组。
3. 空选区 B/I/U → storedMarks 行为补测。
4. `[*]` `paste-filter.ts` 与单测。

### Phase C — Word 化观感

1. 纸面画布样式（token）。
2. `page-strip.tsx` 迷你纸页；确认摘要来源=本地 ws 文档（已满足 FR-005 大部）。
3. 窄屏工具栏换行/收纳，能力不缺。

### Phase D — 权限与回归

1. 查看者：工具栏不挂载；无立即保存/插图；排版可见。
2. 巡检：无模板/导出/分享/发布/外来主题入口。
3. 002 回归：自动保存、多页、插图三档、撤销重做覆盖新格式。
4. E2E：加粗+列表+对齐 → 保存 → 刷新一致。

### Phase E — 文档同步

1. `11-需求与实现状态` / 实现状态清单：FR-031 由 003 修订。
2. ADR 0010 短注（可选）。
3. `pnpm docs:check --strict`。

---

## 测试策略

| 层 | 覆盖 |
|---|---|
| 单测 | Zod/sanitize 白名单；paste 放行与压平；plain_text 列表；空 marks 不残留 |
| 集成（按需） | 含新 mark 的 `saveArticlePage` 读回一致；越权仍 404（不改也可抽测） |
| E2E | US1 主路径；US2 迷你纸切页（≥3 页）；US3 查看者无工具栏 |
| 手工 / SC | SC-005 入口巡检；SC-003 纸面可辨（工程验收用截图/清单，正式抽测可挂账） |
| 门禁 | `pnpm check`、`typecheck`、`test`；范围及 `test:integration` / `test:e2e` / `docs:check --strict` / `arch:check` |

---

## 取舍与风险

| 风险 | 缓解 |
|---|---|
| 白名单与 TipTap schema 不一致 → 用户做出存不住的格式 | 扩展配置与 Zod **同一清单**；PR 自查对照表；单测锁 |
| 嵌套列表从粘贴/快捷键漏入 | 双端压平 + 禁 sink；E2E/单测 |
| 工具栏变复杂超出 400 行 | 拆分组子组件（仍在 `editor/`） |
| 纸张 CSS 在窄屏可读性 | 允许缩小仍居中；SC-007 |
| 范围漂移（颜色/表格「顺手做」） | **硬边界**写入本 plan；评审按缺陷打回 |
| 查看者仍见 disabled 工具栏 | 验收标准改为 DOM 不存在工具栏区域，不只 `disabled` |

---

## 开放问题（≤5，不瞎填）

1. **TextAlign 依赖**：实现时确认 TipTap 3 是否必须新增 `@tiptap/extension-text-align`；若官方 StarterKit 无对齐，则新增并按 ADR 0009 §1 在 PR 记账。不阻塞 plan / tasks。
2. **图标集**：工具栏默认既有 `lucide-react`，不新依赖。若实现中缺图标再另议。

### 产品已拍定（2026-11-04）

| 原开放项 | 裁决 |
|---|---|
| 嵌套列表服务端策略 | **压平保留文字**（默认且定稿）；粘贴与 sanitize 同口径 |
| 002 文档回标 | **不改** 002 `spec.md` 全文；实现 PR 在 `docs/architecture/11-需求与实现状态.md` 互链注明 FR-031 由 003 修订即可 |
| SC-001/003/004 用户抽测 | 交给质量工程师在 **converge** 定场次/代理口径；**不挡** plan/tasks |

---

## 建议落库与下一步

| 项 | 值 |
|---|---|
| 落库路径 | `specs/003-article-editor-wordlike/plan.md` |
| 建议 PR 标题 | `docs(spec): add 003 article editor wordlike plan` |
| 本回合 | 主人已【决策】落库开 PR；产品旁观 PASS + 开放项拍定已并入本文件 |
| 下一步 | CI 绿 → 大总管问主人合入 → `/speckit-tasks` |

