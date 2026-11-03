# Bug Verification: 人丁创建幂等键（R31）修复验证

- **Slug**: lineage-create-idempotency
- **Tested**: 2026-11-03T19:39:47+08:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

评估 §Reproduction 给出的自动化等价复现（同 `requestId` 重放、并发双飞、跨谱系并发、缺键拒绝）全部按修复后的期望行为通过：同键两次创建只多一行且返回同一个 `node.id`，并发与跨谱系由 `uk_node_org_request_id` 兜住恰好一行，缺 `requestId` 在 Zod 层必拒。修复新增/更新的 4 个测试文件、变更模块的 7 个聚焦集成回归文件、全量单测与 lint/typecheck/arch/docs 全绿，未发现回归。未在真实浏览器中双击「添加子女」（`pnpm test:e2e` 属破坏性套件，未经同意不跑），见 Residual Risks。

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) — 同键重放 | `pnpm vitest run --config vitest.integration.config.ts --reporter=verbose tests/integration/nodes.test.ts …`（真实 PostgreSQL 18，global setup 重置+全量迁移） | pass | `returns the first row when the same requestId is replayed` ✓：两次 `addChildInTransaction` 同键仅 +1 行、同一 `node.id`、`node_count` 仅 +1 |
| Reproduction (post-fix) — 并发双飞 | 同上 | pass | `settles a concurrent double submit on one row` ✓；`collapses a cross-lineage race onto the row that won the index` ✓（跨谱系锁不互斥，由唯一索引收敛） |
| Reproduction (post-fix) — 缺键拒绝 | `pnpm vitest run --reporter=verbose tests/lineage-schemas.test.ts` | pass | `requires an idempotency key on every create schema` ✓：五个创建 schema 缺键必拒（首个 issue 落 `requestId`）、非 uuid 必拒、补键通过 |
| Reproduction (post-fix) — 数据库层 | 同上（nodes/constraints/migrations 一并） | pass | `keeps one live node per (organization, request_id)` ✓（直插重复报 23505、NULL 不互斥、软删释放键）；不同键同名同父允许两行 ✓（不误伤） |
| New / updated tests | `pnpm vitest run --config vitest.integration.config.ts tests/integration/{nodes,constraints,migrations}.test.ts` | pass | `Test Files 3 passed (3) · Tests 55 passed (55)`；`tests/lineage-schemas.test.ts` `14 passed (14)`；fix.md 列出的幂等 describe 7 条用例逐名确认执行 |
| Regression — 聚焦集成 | `pnpm vitest run --config vitest.integration.config.ts tests/integration/{folders-lineages,with-org-write,org-scope,queries,tenant-immutability,search-boundary,spouse-sort-index}.test.ts` | pass | `Test Files 7 passed (7) · Tests 56 passed (56)`（覆盖 `withLineageWrite` 搬移与创建路径所在写链路） |
| Regression — 全量单测 | `pnpm test` | pass | `Test Files 46 passed (46) · Tests 354 passed (354)`，与 fix.md 基线一致 |
| Lint (Biome) | `pnpm check` | pass | `Checked 413 files … No fixes applied`，exit 0 |
| Typecheck | `pnpm typecheck` | pass | `tsc --noEmit` exit 0 |
| Arch constraints | `pnpm arch:check` | pass | `[F6] 217 files scanned, 7 exemptions, 0 violations` / `[F7] 0 process.env violations`（`node-services.ts` 未涨、`lineage-write.ts` 合规） |
| Docs check | `pnpm docs:check --strict` | pass | `0 issue(s)`（fix 改动了 04/05/12/03 四份文档） |
| 手工浏览器双击复现（评估步骤 1–4） | `pnpm test:e2e` | skipped | 破坏性套件（本地模式清空测试库），未经同意不跑；见 Residual Risks |
| 全量 `pnpm test:integration` | — | skipped | 超出「变更模块聚焦回归」范围；fix.md 记录本机 `fact-cli.test.ts` 3 条既有子进程超时与本修复无关 |
| Coverage / build / 网络类检查 | `pnpm test:coverage`、`pnpm build` | skipped | 未获同意不跑（昂贵/非必要） |

## Output Excerpts

```
✓ tests/integration/nodes.test.ts > node create idempotency > returns the first row when the same requestId is replayed 193ms
✓ tests/integration/nodes.test.ts > node create idempotency > keeps two same-named brothers when the request keys differ 209ms
✓ tests/integration/nodes.test.ts > node create idempotency > settles a concurrent double submit on one row 184ms
✓ tests/integration/nodes.test.ts > node create idempotency > replays root, sibling and spouse creates onto the existing row 248ms
✓ tests/integration/nodes.test.ts > node create idempotency > does not add a second co-recorded spouse on replay 186ms
✓ tests/integration/nodes.test.ts > node create idempotency > lets a soft-deleted node free its request key for a new record 212ms
✓ tests/integration/nodes.test.ts > node create idempotency > collapses a cross-lineage race onto the row that won the index 196ms
✓ tests/integration/constraints.test.ts > node tree invariants enforced by the database > keeps one live node per (organization, request_id) 144ms
✓ tests/integration/migrations.test.ts > migrations > adds nullable request_id to node for create idempotency 30ms
 Test Files  3 passed (3)      Tests  55 passed (55)
```

```
✓ tests/lineage-schemas.test.ts > node creation schemas > requires an idempotency key on every create schema 3ms
 Test Files  1 passed (1)      Tests  14 passed (14)
```

```
 Test Files  7 passed (7)      Tests  56 passed (56)   (focused integration regression set)
 Test Files  46 passed (46)    Tests  354 passed (354) (pnpm test)
 Checked 413 files in 204ms. No fixes applied.         (pnpm check)
 [F6] 217 files scanned, 7 exemptions, 0 violations · [F7] 0 process.env violations
 0 issue(s)                                            (pnpm docs:check --strict)
```

## Residual Risks

- **真实浏览器路径未执行**：评估的手工步骤（打开「添加子女」→ 双击提交）未被端到端覆盖。对话框侧「每次打开生成一个 `crypto.randomUUID()` + 隐藏域透传」只有代码审查与 typecheck 证据，没有运行时执行证据；服务端契约（缺键必拒、同键幂等、并发收敛、23505 回滚重查）已由上述自动化等价物完整覆盖。建议合入前单独获准跑一次 `pnpm test:e2e`（会清空 `gramps_test` 库）。
- **全量集成套件未跑**：`fact-cli.test.ts` 3 条子进程用例在本机有既有超时（fix.md 已用 `git stash` 基线实验证明与本修复无关，`--testTimeout=90000` 可全过）；本次按指示只跑变更模块的聚焦回归。
- **键的作用域取舍**：组织级命中即返回、不比对本次 `lineageId`/`parentId`（fix.md Deviations #5），跨谱系同键并发被索引收敛为「赢者一行」——已有用例覆盖该语义，但它是有意的行为选择，回归解读时需按此预期。
- **共创配偶找回的边角**：配偶行不带键、重放按 `spouse_of_id` 取 `sort` 第一条；若该血亲后来被别的请求追加过配偶，同键重放可能返回后来的配偶（fix.md Deviations #3，UI 仅用于选中定位，可接受）。
- 历史行 `request_id` 为 NULL、软删释放键属设计语义，不是缺陷；生产迁移 job（R29）绿与否属合入后验证，不在本地范围。

## Recommendation

关闭此缺陷——服务端症状（重放/双击/并发多出人丁）已按评估自带的自动化等价复现逐项验证消失，聚焦回归与静态检查全绿，无回归迹象。若想在证据上封死最后一寸，合入 main 前单独批准跑一次 `pnpm test:e2e` 覆盖真实浏览器双击路径即可，无需重开评估。
