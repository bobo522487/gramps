# Bug Assessment: 世系表跨房支顺序错（generation→sort 交错，得不到房支 DFS 序）

- **Slug**: lineage-generation-order
- **Created**: 2026-11-03
- **Source**: pasted text（`docs/architecture/12-风险与演进规划.md` R30 摘要 + 代码核对；无 URL，未发生任何外部拉取）
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

用户粘贴的 R30 原文（摘自 `docs/architecture/12-风险与演进规划.md:46`）：

> R30 lineage table cross-branch order wrong: blood.sort compares generation then sort, but sort is sibling rank under one parent. Same-generation nodes from different branches interleave; expected DFS order elder-branch-whole then younger-branch-whole (FR-LIN-13). Suspected: components/lineage/derived.ts generation->sort; lib/db/queries/nodes.ts orderBy(generation, sort, createdAt). Suggested fix directions in risk doc: SQL order by generation, path (ltree prefix total order), OR drop SQL order and compute DFS in one pure function so order rules live in one place. Status: needs decision / not verified fixed.

风险表登记的影响面：「FR-LIN-13 的验收标准不成立：世系表看起来有序，实际不是族谱要求的房支序；一旦有人按世系表排版或导出，错序只能人工重排」。状态为「需决策」，并明确「**是否已修未证实**」。

本评估完成核对：**未修**，两条疑似路径逐字属实（见下）。

## Symptom

打开多房支族谱的世系表（或打印视图）：同一世次卡片内，来自不同房支的人丁按「每父节点内排行 `sort`」交错排列，而不是「长房整支在前、次房整支在后」的深度优先序。期望行为（FR-LIN-13 + 族谱成书惯例）：世系表按世次分组没问题，但**同世次内**必须按房支 DFS 序——先按长房这一世的全部人丁，再轮到次房。

最简交错例：二世有两子（长房 `sort=0`、次房 `sort=1`）；三世长房有二子（`sort=0,1`）、次房有一子（`sort=0`）。现排序得 `长房长子, 次房独子, 长房次子`；期望得 `长房长子, 长房次子, 次房独子`。

## Reproduction

1. 本地起应用，在某项目建一条谱系：始祖 → 两子（长房、次房，`sort` 依次为 0、1，走 `addChild` 自动排行，`lib/lineage/node-services.ts:117-141` 的 `nextSort` 按父节点分组取 `max(sort)+1`）。
2. 给长房添二子、给次房添一子（三世三人的 `sort` 分别是 0、1、0）。
3. 切到世系表视图（`components/lineage/lineage-detail.tsx:520` 的「世系表」），看「第 3 世」卡片的行序。
4. 观察到次房独子排进了长房两子之间；按「打印世系表」（同组件 `print:` 工具类）导出同样错序。

世系表分组逻辑本身无错（`lineage-detail.tsx:306-318` 的 `groups` 只是按 `index.blood` 插入序分桶），顺序完全继承自 `blood` 数组排序。

## Suspected Code Paths

- `components/lineage/derived.ts:38-43` — `blood.sort`：先比 `generation`，同代再走 `bySortThenName`（`sort` → 全名 zh 排序）。`sort` 是**同一父节点内的排行**，跨房支比较无意义，即症状根源。确认存在，未修。
- `lib/db/queries/nodes.ts:23` — `orderBy(asc(nodes.generation), asc(nodes.sort), asc(nodes.createdAt))`：SQL 层同样按每父排行排全表。确认存在，未修。
- `lib/lineage/node-services.ts:117-141`（`nextSort`）— 证据：`sort` 语义 = 单亲兄弟组内自增排行，佐证「同代跨房支不可直接比较」。
- `components/lineage/lineage-detail.tsx:264, 306-318` — 世系表消费方：`bloodNodes = index.blood` → `groups` 按世次分桶，桶内保持 `blood` 序 → `NodeRows`（677、718 行）。
- `components/lineage/derived.ts:218-229`（`matchLineagePerson`）— 搜索「第一个匹配」的遍历序依赖 `index.blood`，同受错序影响（次生消费方）。
- `components/lineage/canvas/layout/book-ltr.ts:52-60` — 画布布局把 `index.blood` 过滤后取 `roots` 顺序做纵向堆叠，是 `blood` 序的另一消费方（改序时需回归验证）。
- `components/lineage/types.ts:80-81` — `NodeView` **刻意不下发 `path`**（「keeps orgId / path / createdBy out of the browser」）。含义：客户端修复只能用 `parentId + sort`，也不能把「SQL 按 path 排」当成唯一修法指望到前端。

### 相关文档核对

- FR-LIN-13：`docs/architecture/11-需求与实现状态.md:296`（「表格形式按世次列出全部人丁，支持打印视图」）、`:418`（实现映射：世系表组件 + `print:` 工具类，仅单测）、`:459`（测试缺口：FR-LIN-13 只有布局/谓词/常量单测，无行为测试）。
- 历史评审已定性为 P0：`docs/archive/reviews/2026-10-22-architecture-review.md:217`（P0-3，「修法极简：`buildLineageIndex` **已经**构造了 `childrenByParent` 和 `roots`，只是没用它们排序」）、`:522`。
- ADR 0003（`docs/decisions/0003-tree-storage-ltree.md:35, 44`）自相矛盾地给出线索：正面说「`path` 天然给出房支顺序」，负面又说「**label 是 UUID，不含排行信息，所以 `path` 字典序给不出长房→次房**」。这直接否决了风险文档建议方向之一的可行性（见下）。
- 归档计划 `docs/archive/plans/2026-10-27-linus-stack-pass.md:63`（E1）警告：**不要**在不复刻全部排序键的情况下删 DB 排序，否则同键并列时的 tie-break 会静默改变——修复时必须吸收这一点。

## Root Cause Hypothesis

**置信度：高（代码级证实，非假设）**。排序键选错语义域：`sort` 是兄弟组内局部排行（per-parent rank），却被当作全局序使用；`generation → sort → 名字` 的字典序天然把「各房支的第 N 子」横向对齐，产生跨房支交错。数据库侧 `orderBy(generation, sort, createdAt)` 与应用侧 `blood.sort` 是同一错误的两处副本，正是要消除的「顺序规则散落多处」。ltree `path` 虽然全序且祖先必为前缀，但其 label 是无语义 UUID（`nodeLabel`，`node-services.ts:51`），字典序与长幼房支序无关，故「SQL 改 `ORDER BY generation, path`」并不能达成期望的 elder-branch-first。

## Proposed Remediation

**Preferred（一个顺序真源：纯函数 DFS，落在 `derived.ts`）**：

1. 在 `buildLineageIndex` 中，把 `blood` 的输出序改为**从 `roots` 出发的深度优先前序**：根之间按 `sort`→`fullName`；每层孩子复用已构造好的 `childrenByParent`（已按 `bySortThenName` 排好，`derived.ts:49-58`）。用显式栈实现（不用递归，万人谱 + 兼作 `countDescendants` 深链的护栏）。DFS 结束后仍不在序中的节点（父链断裂成环、悬空 `parentId` 的孤儿——现有 `roots` 定义已把它们当根，但要防环导致漏节点）按现行 `generation → sort → fullName` 作确定性兜底追加，**保证不丢节点**。
2. 世系表分桶（`groups`）、搜索首匹配、打印视图随 `index.blood` 序自动纠正，无需各自改排序——这正是「顺序规则只留一处」的收敛点。
3. `lib/db/queries/nodes.ts:23` 的 `orderBy(generation, sort, createdAt)` **降为纯稳定化用途**（如仅 `orderBy(createdAt)`，或直接去掉并加注释声明「显示序由 `components/lineage/derived.ts` 唯一决定」）。吸收 E1 教训的前提是第 1 步的排序已是全序 + 确定性兜底，删 SQL 排序不会引入第二语义。

**Alternatives**：

- **SQL 递归 CTE 生成带排行的 DFS rank**（`ORDER generation, dfs_rank`）：能在服务端一劳永逸，且未来导出/排版可复用；但顺序规则从此存在 SQL + JS 两份副本（违背本次「单一真源」目标），Drizzle 写 ltree+array_agg 递归复杂度高，且 `path` 不下发客户端、世系表仍是内存重排。适合 M2「按世系表成书/导出」立项时再评估。
- **`ORDER BY generation, path`（风险文档建议之一）**：如上，UUID label 使 path 字典序与房支长幼无关，**不能单独成立**，予以否证并建议回写风险文档。
- 把排行编进 ltree label（如 `0001.0002` 段）：触碰 ADR 0003 单向门，需要全表 path 迁移且每次 reorder 重写子树，代价远超收益，否决。

**Files likely to change**:

- `components/lineage/derived.ts` — `blood` 序改 DFS 前序（核心改动，唯一新增顺序真源）
- `lib/db/queries/nodes.ts` — 去掉/降级 `orderBy`，注释声明显示序归属
- `docs/architecture/12-风险与演进规划.md` — R30 状态更新（修复后从「需决策」改为缓解中/已修，并记录「path 字典序不可行」的否证结论）

**Tests to add or update**:

- 新增单测（`tests/lineage-derived-order.test.ts` 或并入 `tests/lineage-canvas-layout.test.ts` 的 `buildLineageIndex` 用例区）：多房支固定例（上文 Reproduction 的 2 世×2 子 + 3 世×3 子）断言 `index.blood` 全序 = 房支 DFS（长房整支在前）；同代卡片内 `groups` 桶内序随之正确。
- 兜底用例：孤儿（`parentId` 指向不存在节点）与成环数据不丢失、顺序确定（两次 `buildLineageIndex` 结果一致）。
- 回归：`tests/lineage-canvas-layout.test.ts` 全绿（`roots` 堆叠序、`rankLabel`、`matchLineagePerson` 首匹配可能随序变化，需按新期望更新断言处逐一确认是「纠正」而非「破坏」）。
- 补 `docs/architecture/11-需求与实现状态.md:459` 点名的 FR-LIN-13 行为测试缺口：世系表按房支序渲染（可用对 `groups` 产物的纯函数断言替代 DOM 测试，维持现有测试分层）。

## Risks & Considerations

- 画布布局消费 `index.blood` 序（`book-ltr.ts:52-60` 的 roots 堆叠）：改为 DFS 序后多根/窗口裁剪下的纵向位置可能变（更合族谱直觉，但属视觉变更），需在改动时跑 E2E `tests/e2e/critical-path.spec.ts` 与布局单测确认。
- 搜索「第一个匹配」与「下一个」的落点随序变化——是纠正，但对用户是可感行为变更，PR 描述需写明。
- 大谱性能：DFS 前序 O(n)，与现 O(n log n) 排序同量级；显式栈避免深树爆栈。
- 无迁移、无 API/DTO 变更（`NodeView` 不动、`path` 继续不下发），不触碰组织隔离与权限路径。
- 删/降 SQL `orderBy` 依赖「JS 排序已是全序 + 确定性兜底」这一前提（归档计划 E1 的教训），否则并列键 tie-break 会静默变——测试必须锁住这一点。
- 风险文档建议之一（`ORDER BY generation, path`）经 ADR 0003 与 `nodeLabel` 证据否证，应回写 R30，避免下一个读者照做踩坑。

## Open Questions

- [NEEDS CLARIFICATION: FR-LIN-13「按世次列出」与「长房整支→次房整支」的组合语义] 本评估按「保留按世次分组卡片、组内按房支 DFS 序」修复（世系表仍分世次，符合现文案）；若成书/打印期望**全表扁平 DFS（不分世次）**，需另行产品裁决。
- [NEEDS CLARIFICATION: 多始祖（`roots` > 1）时房支间长幼如何定] 现方案按根自身 `sort`→`fullName`；无谱内全局长幼来源。
- [NEEDS CLARIFICATION: 女儿支/入赘支与儿子支的相对次序] `sort` 不分性别（`rankLabel` 才分），DFS 直接按 `sort` 走是否与修谱惯例一致，需家谱业务确认。
