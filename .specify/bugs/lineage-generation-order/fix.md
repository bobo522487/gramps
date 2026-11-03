# Bug Fix: 世系表跨房支顺序改为深度优先前序（单一顺序真源落在 derived.ts）

- **Slug**: lineage-generation-order
- **Fixed**: 2026-11-03T20:57:42+08:00
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

按评估的 Preferred 方案把 `components/lineage/derived.ts` 里 `index.blood` 的输出序从
`generation → sort → 全名` 改为**从 `roots` 出发的显式栈深度优先前序**（长房整支 → 次房整支），
并把 `lib/db/queries/nodes.ts` 的 `orderBy(generation, sort, createdAt)` 降为纯稳定化排序
（`createdAt, id`），使显示序只剩一处真源。世系表世次卡片、打印视图、画布纵向堆叠、搜索首匹配
都直接继承这个序，代码本身没再改它们。孤儿/成环脏数据走确定性兜底追加，保证一个人丁都不丢。

评估登记的三个 `[NEEDS CLARIFICATION]` 由本次任务的使用者裁决（不再询问）：
① 保留按世次分组卡片、组内按房支 DFS 序；② 多个始祖之间按 `sort` → `fullName`；
③ 女儿支/入赘支沿用既有 `sort`，不引入按性别重排。三条都已如实落到实现与注释里。

## Changes

| File | Change | Notes |
|------|--------|-------|
| `components/lineage/derived.ts` | modified | 新增 `bloodDepthFirst()`（显式栈前序 + 兜底）；`buildLineageIndex` 先建 `childrenByParent`/`roots` 再据此定序；`roots` 现在按 `sort` → 全名定序；`countDescendants` 加环重入守卫 |
| `lib/db/queries/nodes.ts` | modified | `orderBy(generation, sort, createdAt)` → `orderBy(createdAt, id)`，注释声明显示序归 `derived.ts` |
| `tests/lineage-derived-order.test.ts` | added | FR-LIN-13 行为测试：房支 DFS 全序、世次切片序、多根定序、孤儿/成环/自环不丢且稳定、深链 2000 代 |
| `tests/lineage-canvas-layout.test.ts` | modified | 「stacks multiple roots」用例的 fixture 显式给 `sort`（新根序规则），断言未改 |
| `docs/architecture/12-风险与演进规划.md` | modified | R30 状态 `需决策` → `缓解中`，并写明 `ORDER BY generation, path` 被否证；「插队项」段落同步 |

## Diff Highlights

```ts
// components/lineage/derived.ts —— 显示序的唯一真源
const stack = [...roots].reverse();
while (stack.length > 0) {
  const node = stack.pop();
  if (!node || visited.has(node.id)) continue;
  visited.add(node.id);
  ordered.push(node);
  const children = childrenByParent.get(node.id);
  if (children) stack.push(...[...children].reverse());   // 副本：桶还服务 rankLabel
}
// 兜底：只有父链成环的节点走不到（悬空 parentId 已算根），按 generation → sort → 全名追加
```

```ts
// lib/db/queries/nodes.ts —— 不再是显示序
.orderBy(asc(nodes.createdAt), asc(nodes.id))
```

交错例（评估 Reproduction 的数据）修复前后三世卡片行序：

- 旧：`长房长子, 次房独子, 长房次子`
- 新：`长房长子, 长房次子, 次房独子`

## Tests Added or Updated

- `tests/lineage-derived-order.test.ts::walks the whole elder branch before the younger branch` — `index.blood` 全序 = `r, a, a1, a2, b, b1`（评估的最简例）
- `...::no longer lines up "the N-th son of every house" side by side` — 锁住三世切片不再是 `a1, b1, a2`（回归即失败）
- `...::世系表 generation buckets keep the DFS order inside each card` — FR-LIN-13 行为断言：卡片行序 = 世次切片序
- `...::orders a deeper tree as preorder, whole subtree at a time` — 四世两层的前序
- `...::ignores the row order the query returned` — 输入行序无关（顺序真源在 derived，不在 SQL）
- `...::orders multiple roots by sort, then fullName` — 裁决 ②
- `...::treats a dangling parentId as a root and still walks its subtree` / `keeps every node when a parent chain forms a cycle` / `is stable for a self-parented node and repeated builds` — 孤儿、双向环、自环：不丢节点 + 两次构建一致（含反向输入）
- `...::walks a deep chain without dropping nodes (explicit stack)` — 2000 代深链不丢、不爆栈
- `tests/lineage-canvas-layout.test.ts`（18 用例）全绿；「stacks multiple roots」只改 fixture，见 Deviations ③

## Local Verification

- `pnpm vitest run tests/lineage-derived-order.test.ts` → 11 passed
- `pnpm vitest run tests/lineage-derived-order.test.ts tests/lineage-canvas-layout.test.ts` → 29 passed
- `pnpm test`（全量单测）→ 47 files / 365 tests passed
- `pnpm vitest run --config vitest.integration.config.ts tests/integration/queries.test.ts` → 13 passed（含 `getNodes` 的行序断言）
- `pnpm vitest run --config vitest.integration.config.ts tests/integration/nodes.test.ts` → 18 passed（真实 PostgreSQL）
- `pnpm check` → Biome 无 issue（414 files）；`pnpm typecheck` → 无错误
- `pnpm arch:check` → `[F6] 217 files, 7 exemptions, 0 violations`（`derived.ts` 由 236 → 295 行，仍在 400 以内；未新增/扩大豁免）· `[F7] 0 violations`
- `pnpm docs:check --strict` → 0 issue(s)
- Manual checks：世系表分桶（`lineage-detail.tsx:306-318`）与打印视图未改动，只继承 `index.blood`；`matchLineagePerson` 的首匹配随之前移（纠正，见 Follow-ups）
- 未跑 `pnpm test:e2e`（需要 production server 与清空 E2E 库，非本次快速可验证范围），见 Follow-ups

## Deviations from Assessment

均在评估点名的文件内，未扩大改动面：

1. **`countDescendants` 加了环重入守卫**（评估第 1 步只字未提）。不改的话，成环脏数据在
   `buildLineageIndex` 里直接 `RangeError: Maximum call stack size exceeded`（这个无界递归早于本次
   改动就存在），评估自己要求的「成环不丢节点」用例根本跑不到——环上重入的节点按 0 计、不写缓存，
   非环数据的计数结果与改动前逐字相同（既有单测未动即绿）。
2. **SQL 稳定化键选了 `createdAt, id`**，而不是评估举例的「仅 `createdAt`」或直接去掉。E1 的教训是
   并列键的 tie-break 不能静默变：同一事务插入的行 `created_at` 相同（`defaultNow()` 取事务时刻），
   只有 `createdAt` 时并列兄弟的输入序仍不确定；补一个 `id`（uuidv7 = 入库序）才是确定的。显示语义
   依旧为 0。
3. **`tests/lineage-canvas-layout.test.ts`「stacks multiple roots」改的是 fixture 而不是断言**：新规则下
   根之间按 `sort` → 全名，而该用例两根都是 `sort=0`，先后要靠 `陈始祖` / `陈失考祖` 的 ICU 拼音比较
   才能定——断言会随 locale 数据变脆。给它们显式 `sort: 0 / 1` 后，原断言（始祖在上、失考祖下移一行）
   全部保持成立。
4. **FR-LIN-13 行为测试用「世次切片」等价替代 `groups` 产物**：`lineage-detail.tsx` 的 `groups` 是
   组件内 `useMemo`、未导出（791 行，另有 F6 豁免上限 865，只许缩），为不动它，测试直接对 `blood`
   做等序的 `filter`——`groups` 只是按世次分桶、桶内保序，切片即卡片行序。
5. 未做评估 Alternatives 里的任何一项（递归 CTE / path 排序 / label 编排行），按裁决走纯函数 DFS。

## Follow-ups

- 跑 `/speckit-bug-test slug=lineage-generation-order` 做修复验证；期间顺带用真实多房支谱系过一遍
  `pnpm test:e2e`（`tests/e2e/critical-path.spec.ts`）与画布多根堆叠的视觉复核——根序规则变了，
  纵向位置属可感变更。
- PR 描述要写明两处可感行为变更：搜索「第一个匹配 / 下一个」的落点前移（纠正）；
  `node-create-dialog.tsx` 'person' 模式默认父节点取 `index.roots[0]`，其序由「世次→sort」变为「sort→全名」。
- 「顺序规则只留一处」还差两条表单副本：`components/lineage/node-create-dialog.tsx:169-174`
  （`parentOptions`）与 `components/lineage/node-move-dialog.tsx:75-85`（移动目标候选）仍各自
  `generation → sort` 排序。它们是下拉列表、不是世系表显示序，本次按最小改动没动；
  谱书成书/导出立项时一起收敛。
- `docs/architecture/11-需求与实现状态.md:459` 登记的「FR-LIN-13 只有布局/谓词/常量单测、无行为测试」
  缺口现由 `tests/lineage-derived-order.test.ts` 补上；11 号文档不在本次评估的改动清单里，
  下次按「状态只写 11 §7」的口径同步。
- 若将来要「全表扁平 DFS（不分世次）」的成书排版，是产品裁决问题（裁决 ① 只覆盖了保留世次卡片的现状）。
