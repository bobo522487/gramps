# Bug Verification: 世系表跨房支顺序（generation→sort 交错 → 房支深度优先前序）

- **Slug**: lineage-generation-order
- **Tested**: 2026-11-03T21:15:05+08:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

症状不再出现：把评估里那条「始祖 → 长房(2 子) + 次房(1 子)」的树，用应用自己的写入服务落到**真实 PostgreSQL**、再用页面自己的读取链（`getNodes` → `toNodeViews` → `buildLineageIndex` → `groups` 分桶）读回来，第 3 世卡片行序是 `长房长子 → 长房次子 → 次房独子`（期望值），而同一份数据跑 git HEAD 的旧 `derived.ts` 仍给出交错的 `次房独子 → 长房长子 → 长房次子`——说明这条检查真能抓到原 bug。全量单测、nodes/queries 集成测试、Biome/tsc/arch/docs 检查与 `CI=1` 关键路径 E2E 全部通过，未发现回归。唯一未覆盖的是「多房支树在浏览器里的肉眼视觉复核」，见 Residual Risks。

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix, 数据层等价) | `pnpm vitest run --config .specify/bugs/lineage-generation-order/verify/vitest.repro.config.ts` | pass | 评估 Reproduction 1–3 步的自动化等价：真实库 + 真实写入路径（`createRootNodeInTransaction` / `addChildInTransaction` → `nextSort`）+ 真实查询 + 真实 `buildLineageIndex` + `lineage-detail.tsx` 的分桶规则。exit 0，1 passed |
| Pre-fix control（同一检查对旧代码必须失败） | `git show HEAD:components/lineage/derived.ts` + Node 脚本跑同一 fixture | pass | 旧序 blood = `始祖, 长房, 次房, 次房独子, 长房长子, 长房次子`（交错=true）；新序 = `始祖, 长房, 长房长子, 长房次子, 次房, 次房独子`（交错=false） |
| New / updated tests | `pnpm vitest run tests/lineage-derived-order.test.ts tests/lineage-canvas-layout.test.ts` | pass | 11 + 18 = 29 passed，与 fix.md 登记的数字一致 |
| Regression suite（全量单测） | `pnpm test` | pass | 47 files / 365 tests passed（含 `lineage-search-consistency`、`lineage-canvas-layout` 等 `index.blood` 消费方） |
| Integration (nodes + queries, 一条命令) | `pnpm vitest run --config vitest.integration.config.ts tests/integration/queries.test.ts tests/integration/nodes.test.ts` | pass | 31 passed（nodes 18 + queries 13，含 `getNodes` 的行序断言），真实 PostgreSQL 18（docker `gramps-postgres` → localhost:54322，库 `gramps_test`，每次 `drop schema` 后重新迁移） |
| Lint / type-check | `pnpm check` / `pnpm typecheck` | pass | Biome 414 files，no issues；`tsc --noEmit` 无输出 |
| Project checks | `pnpm arch:check` / `pnpm docs:check --strict` | pass | `[F6] 217 files, 7 exemptions, 0 violations`、`[F7] 0`；docs 0 issue(s) |
| E2E critical path (CI=1) | `pnpm build` → `CI=1 LD_LIBRARY_PATH=$PWD/.local-libs/usr/lib/x86_64-linux-gnu pnpm test:e2e tests/e2e/critical-path.spec.ts --retries=0` | pass | 生产构建 8s（旧的 `.next` 是 07:43 的构建，早于 20:52 的改动，必须先重建，否则 `pnpm start` 跑的是修复前的包）；2 passed (2.5m)，production server + 真浏览器 |
| 浏览器里「多房支世系表」的肉眼视觉复核 | 手工 | not-run | 仓库里没有带 3 世×多房支数据的 UI 用例，`critical-path.spec.ts` 只有一根 + 一子、且不断言行序；本次不为验证去改测试源码（guardrail），故记 not-run |

## Output Excerpts

```
$ pnpm vitest run tests/lineage-derived-order.test.ts tests/lineage-canvas-layout.test.ts
 ✓ tests/lineage-derived-order.test.ts (11 tests) 36ms
 ✓ tests/lineage-canvas-layout.test.ts (18 tests) 29ms
      Tests  29 passed (29)

$ pnpm test
 Test Files  47 passed (47)
      Tests  365 passed (365)

$ pnpm vitest run --config vitest.integration.config.ts tests/integration/queries.test.ts tests/integration/nodes.test.ts
 ✓ tests/integration/nodes.test.ts (18 tests) 4226ms
 ✓ tests/integration/queries.test.ts (13 tests) 2874ms
      Tests  31 passed (31)

$ pnpm vitest run --config .specify/bugs/lineage-generation-order/verify/vitest.repro.config.ts
 ✓ .specify/bugs/lineage-generation-order/verify/generation-order.repro.test.ts (1 test) 645ms
   ✓ walks 长房整支 before 次房整支 through the real read path 632ms

关键断言（真实库读回的那棵树，`getNodes` 的原始行序 = 入库序 r,a,b,a1,a2,b1）：
  index.blood   = 始祖, 长房, 长房长子, 长房次子, 次房, 次房独子
  第 3 世卡片   = 长房长子 → 长房次子 → 次房独子        （期望）
  nextSort 实测 = 二世 [0,1]、三世 [0,1,0]                （sort 只在同一父节点内递增 → 旧序必须作废）

pre-fix control（git HEAD 的 derived.ts，同一份数据）：
  PRE-FIX blood   = 始祖, 长房, 次房, 次房独子, 长房长子, 长房次子
  PRE-FIX 3rd-gen = [次房独子, 长房长子, 长房次子]      ← 交错，即评估登记的症状

$ CI=1 pnpm test:e2e tests/e2e/critical-path.spec.ts --retries=0
 [e2e] test database reset and migrated
 ✓  1 … critical path: sign up, create project, record founder, add child, edit inspector (9.1s)
 ✓  2 … auth journey: invite, sign out, sign in, accept invitation (2.7s)
   2 passed (2.5m)
```

## Residual Risks

- **浏览器视觉层未肉眼复核**：世系表卡片行序由 `index.blood` 直接分桶（`lineage-detail.tsx:295-318` 的 `visibleBlood`/`groups` 只做 filter + 按世次 push，`NodeRows:141` 只 `.map()`，都不再排序），代码路径已核对 + 数据层已实测，但「多房支真实谱系在浏览器里的样子」没有跑过；画布多根纵向堆叠（`book-ltr.ts`）随根序规则改变属可感视觉变更，同样只由单测覆盖。
- **评估的交错例子与实际 tie-break 略有出入**（不影响结论）：旧规则在 `sort` 并列时按 `fullName.localeCompare(..., 'zh-Hans-CN')` 决胜负，本次实测旧序是 `[次房独子, 长房长子, 长房次子]`，评估原文写的是 `[长房长子, 次房独子, 长房次子]`；两者都是「跨房支交错」，新序一致为 DFS。
- **顺序真源仍差两处表单副本**（fix.md Follow-ups 已登记，本次未动）：`node-create-dialog.tsx:173` 与 `node-move-dialog.tsx:83` 仍各自 `generation → sort`；它们是下拉列表序、不是世系表显示序，成书/导出立项时一起收敛。
- **可感行为变更需要在 PR 里写明**：搜索「第一个匹配 / 下一个」落点前移、`node-create-dialog.tsx` 'person' 模式默认父节点 `index.roots[0]` 的取值规则由「世次→sort」变为「sort→全名」——本次验证确认这两处随新序生效且测试全绿，但产品侧是否接受仍需 PR 评审确认。
- **裁决 ①（是否保留世次分卡片）与 ③（女儿支/入赘支相对次序）按使用者裁决落地**，属业务约定而非本报告的独立证据；若修谱惯例另有要求，是产品裁决问题。
- 本次运行会**重置 `gramps_test` 库**（集成测试与 E2E 的 global setup 都 `drop schema cascade` + 重新迁移），且工作区里还叠着另一批未提交改动（R31 幂等：`node-services.ts`、`node-create-dialog.tsx`、迁移 `0025`、`tests/integration/nodes.test.ts` 的幂等 7 条等），所以集成/E2E 结果反映的是「两批改动叠加后的工作区」，不是单独这一次修复的隔离环境。
- 无迁移、无 API/DTO 变更（`path` 依旧不下发客户端），组织隔离与权限路径未被触碰，故未额外做越权类检查。

## Recommendation

关闭这个 bug：Preferred 方案（单一顺序真源 = `derived.ts` 的深度优先前序 + `nodes.ts` 的 `orderBy` 降级为 `createdAt, id`）在真实数据库、真实写入/读取链路上成立，交错症状消失，且同一检查对修复前代码会失败，说明证据有效而非自我印证；全量单测、集成、静态检查与 `CI=1` 关键路径 E2E 全绿，没有发现回归。合并前建议做两件小事：① 在本地拿一条真实多房支谱系打开世系表与打印视图肉眼扫一遍（顺带看画布多根堆叠的新位置），② PR 描述按 fix.md Follow-ups 写明两处可感行为变更。风险文档 R30 现记「缓解中」是合适的——成书/导出尚未立项，届时复用同一条序并回来复核；下拉列表那两处排序副本按 Follow-ups 单独收敛，不必重开本 bug。

## Verification Artifacts

本次为验证新增两个文件（都在 bug 目录内，`biome.json` 已忽略 `.specify`，`vitest.config.ts` 的 `include` 也不会自动收集它们，不参与仓库任何脚本）：

- `verify/generation-order.repro.test.ts` — 评估 Reproduction 的端到端等价用例（真库 + 真写入路径 + 真读取链）。
- `verify/vitest.repro.config.ts` — 只给上面这个文件用的 vitest 配置，复用 `tests/integration/global-setup.ts` 与 `setup.ts`。
