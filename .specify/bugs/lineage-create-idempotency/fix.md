# Bug Fix: 人丁创建加客户端幂等键（R31）

- **Slug**: lineage-create-idempotency
- **Fixed**: 2026-11-03T18:21:00+08:00
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

按评估的 Preferred remediation 落地：`node` 增加可空列 `request_id` 与组织内部分唯一索引，五个创建类 Zod schema 把 `requestId` 设为必填 uuid，创建事务统一走一个新的幂等外壳——同键重放不再插第二行，而是返回首次写入的那一行（共创配偶按 `spouse_of_id` 一起找回），并发双飞撞 `23505` 时整体回滚后重查返回赢的那一行，不向用户报冲突。录入对话框每次打开生成一个键，同一次提交意图（含校验失败后的重试）复用。

## Changes

| File | Change | Notes |
|------|--------|-------|
| `lib/db/schema/lineage.ts` | modified | `requestId: uuid('request_id')`（可空，只有创建路径写）+ `uniqueIndex('uk_node_org_request_id').on(orgId, requestId).where(request_id is not null and deleted_at is null)` |
| `lib/db/migrations/0025_yummy_captain_cross.sql` | added | `pnpm db:generate` 产物 + 人工 review 说明头；只有 `ADD COLUMN` 与 `CREATE UNIQUE INDEX`，不夹带数据修复，历史行留 `NULL` 无需回填 |
| `lib/db/migrations/meta/0025_snapshot.json`、`meta/_journal.json` | added / modified | drizzle-kit 生成的快照与清单条目（`idx: 25`） |
| `lib/lineage/lineage-write.ts` | added | 新模块：从 `node-services.ts` 原样移入的 `withLineageWrite` / `loadLineageForUpdate`，加上本次新增的 `findCreatedNode` 与幂等外壳 `withCreateWrite`（锁内查重放 + 撞索引后回滚重查） |
| `lib/lineage/node-services.ts` | modified | 818 → 763 行（F6 豁免只许缩）：四条创建路径共用 `NodeCreateParams`（含必填 `requestId`），`recordNode` 把键写在主行上，共创配偶不写键 |
| `lib/genealogy/schemas.ts` | modified | `createRootNodeSchema` / `addChildSchema` / `addSiblingSchema` / `addPersonSchema` / `addSpouseSchema` 增加必填 `requestId: z.uuid('提交标识无效，请重新打开录入表单')`——缺键即拒 |
| `lib/lineage/actions.ts` | modified | 五个创建 Action 把 `data.requestId` 透传给 `*InTransaction` |
| `components/lineage/node-create-dialog.tsx` | modified | `useState(() => crypto.randomUUID())` 每次打开生成一次 + 隐藏域 `requestId`；行数仍为 581（F6 上限），做法见 Deviations #2 |
| `tests/integration/nodes.test.ts` | modified | 所有创建调用带键；新增 `node create idempotency` describe（7 条） |
| `tests/integration/constraints.test.ts` | modified | 新增 `keeps one live node per (organization, request_id)`：直插重复报 `23505`、`NULL` 不互斥、软删释放键 |
| `tests/integration/migrations.test.ts` | modified | 索引名清单 + 精确列 `(organization_id, request_id)` + 部分条件两条腿 + `request_id` 可空 uuid 列断言 |
| `tests/lineage-schemas.test.ts` | modified | 既有用例补 `requestId`；新增「五个创建 schema 缺键必拒、非 uuid 必拒」表驱动用例 |
| `tests/helpers/factories.ts` | modified | `createNode` 增加可选 `requestId`，供约束用例直插 |
| `docs/architecture/04-数据视图-数据架构.md` | modified | §9.2 列与索引 + 一段 `request_id` 语义（键的作用域、配偶不带键、部分索引三条边界）；§13 索引表加一行 |
| `docs/architecture/05-接口与集成设计.md` | modified | §5.3 并发控制改成两行（人丁创建=幂等键，其余创建=业务唯一索引），§6.1 幂等规则行同步，§6.5 五个创建 Action 入参补 `requestId` |
| `docs/architecture/12-风险与演进规划.md` | modified | R31 状态 `需决策` → `缓解中`，「现在的缓解」写实际机制与用例位置；插队项段落注明人丁创建部分已处理 |
| `docs/architecture/03-逻辑视图-模块设计.md` | modified | 模块表与事务表补 `lib/lineage/lineage-write.ts` |

## Diff Highlights (optional)

```ts
// lib/lineage/lineage-write.ts — 锁内先重放，撞索引回滚后再取赢的那一行
export async function withCreateWrite(params, fn): Promise<NodeMutationResult> {
  try {
    return await withLineageWrite(params, async (tx, lineage) => {
      const replay = await findCreatedNode(tx, params.orgId, params.requestId);
      if (replay) {
        return replay;
      }
      return fn(tx, lineage);
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const raced = await withOrg(params.userId, (tx) =>
      findCreatedNode(tx, params.orgId, params.requestId)
    );
    if (!raced) {
      throw error;
    }
    return raced;
  }
}
```

```ts
// lib/lineage/node-services.ts — 只有主行带键；共创配偶留 NULL，重放按 spouse_of_id 找回
const node = await insertNode(tx, { id, createdBy: userId, requestId, ...buildValues(id) });
```

```tsx
// components/lineage/node-create-dialog.tsx — 一次打开 = 一次提交意图
const [requestId] = useState(() => crypto.randomUUID());
...
<input type="hidden" name="requestId" value={requestId} />
```

## Tests Added or Updated

- `tests/integration/nodes.test.ts::node create idempotency > returns the first row when the same requestId is replayed` — 同键两次 `addChildInTransaction` 只多一行、两次同一个 `node.id`，`node_count` 也只 +1。
- `… > keeps two same-named brothers when the request keys differ` — 同名同父但不同键仍允许两行（不误伤真实族谱）。
- `… > settles a concurrent double submit on one row` — 同一谱系同一键并发：最终一行、两个调用都拿到同一个 `node.id`。
- `… > collapses a cross-lineage race onto the row that won the index` — 跨谱系同键并发（谱系锁互不互斥）由 `uk_node_org_request_id` 兜住：带该键的活行恰好一行。
- `… > replays root, sibling and spouse creates onto the existing row` — `createRoot` / `addSibling` / `addSpouse` 三条路径回归覆盖；始祖重放返回原行而不是 `root_exists`。
- `… > does not add a second co-recorded spouse on replay` — 重放不再加第二个配偶，并断言只有血亲行带 `request_id`。
- `… > lets a soft-deleted node free its request key for a new record` — 部分索引语义：软删后同键可再录。
- `tests/integration/constraints.test.ts > keeps one live node per (organization, request_id)` — 数据库层直接挡住重复活行（`23505`），`NULL` 键之间不互斥，软删释放键。
- `tests/integration/migrations.test.ts > … exact columns` / `> adds nullable request_id to node for create idempotency` — 迁移产物：索引名、列序 `(organization_id, request_id)`、部分条件两条腿、列为可空 uuid。
- `tests/lineage-schemas.test.ts > requires an idempotency key on every create schema` — 五个创建 schema 缺键被拒且首个 issue 落在 `requestId`，非 uuid 被拒，补键通过。

## Local Verification

- `pnpm check` → `Checked 413 files · No fixes applied`（Biome 干净）
- `pnpm typecheck` → `tsc --noEmit` 退出 0
- `pnpm arch:check` → `[F6] 217 files scanned, 7 exemptions, 0 violations` / `[F7] 0 process.env violations`（`node-services.ts` 763 行，未涨过 820 的上限；`node-create-dialog.tsx` 仍 581；`lineage-write.ts` 139 < 400）
- `pnpm docs:check --strict` → `0 issue(s)`
- `pnpm test` → `Test Files 46 passed (46) · Tests 354 passed (354)`
- `pnpm vitest run --config vitest.integration.config.ts tests/integration/{nodes,constraints,migrations}.test.ts`（真实 PostgreSQL 18，迁移已应用）→ `3 passed (3) · 55 tests passed`
- 追加跑 `{folders-lineages,with-org-write,org-scope,queries,tenant-immutability,search-boundary,spouse-sort-index}` → 合计 `10 files / 110 tests passed`
- 收敛后复跑（`git stash` 基线实验之后）：`{nodes,constraints,migrations,folders-lineages,with-org-write,spouse-sort-index}` → `6 files / 77 tests passed`
- `pnpm test:integration`（全量）→ `341 passed | 3 failed (344)`，3 条失败全在 `tests/integration/fact-cli.test.ts`，报 `Test timed out in 15000ms`（该文件用子进程跑 `data:*` CLI）；把本次改动 `git stash` 后同一文件同样 3 条超时，`--testTimeout=90000` 时 8 条全过 → 判定为本机子进程启动慢的既有问题，与本修复无关。
- `pnpm db:generate` 二次运行 → `No schema changes, nothing to migrate`（迁移与 schema 不漂移）
- 手工核对：`gramps_test` 库中 `select indexdef from pg_indexes where indexname='uk_node_org_request_id'` 返回 `CREATE UNIQUE INDEX … (organization_id, request_id) WHERE ((request_id IS NOT NULL) AND (deleted_at IS NULL))`
- 未跑：`pnpm test:e2e`（本地模式会清空测试库，属破坏性套件，按要求不跑）、`pnpm test:coverage`、`pnpm build`；创建路径的 E2E 走的是同一个对话框，隐藏域已带 `requestId`。

## Deviations from Assessment

1. **新建 `lib/lineage/lineage-write.ts` 并把 `withLineageWrite` 移出 `node-services.ts`**。评估没提这个文件；原因是仓库 F6 规则——`node-services.ts` 的豁免上限是 820 行、当前 818 行，而 AGENTS.md 规定「存量豁免只许缩不许涨」。幂等要覆盖四条创建路径，共享逻辑必须落在不属于任何一条路径的地方，于是把写前奏 + 幂等外壳放进新模块（原 `withLineageWrite` / `loadLineageForUpdate` 逐字搬移，无行为改动）。结果 `node-services.ts` 缩到 763 行。
2. **`node-create-dialog.tsx` 里把「模式 → Action」的三层嵌套三元换成等价的对象查表**，同样是为了守住 581 行的豁免上限（该文件也是贴线状态）：查表得到的是同一批模块级函数引用，行为与身份都不变。同时**没有**在成功后显式换新键——`lineage-detail.tsx` 的 `handleCreated()` 会 `setCreateDialog(null)` 卸载对话框，且 `key={mode}-{targetId}` 保证重新打开即重挂载，语义就是评估要的「成功关闭后换新键」。
3. **共创配偶不写 `request_id`**（评估留的开放问题，这里定了）：索引是 `(organization_id, request_id)` 部分唯一，同事务的血亲与配偶共用一键会自己撞索引；所以键只挂主行，重放时按 `spouse_of_id`（按 `sort` 取第一条）找回配偶。副作用：若某血亲后来被别的请求追加过配偶，同键重放可能返回那条而不是当初那条——`spouseId` 在 UI 里只用于选中定位，可接受。
4. **缺少 `requestId` 一律拒绝**（另一个开放问题，选了「是」）：必填放在 Zod 层，返回中文文案 `提交标识无效，请重新打开录入表单`，服务端没有无键创建通道。
5. **键的作用域是组织，命中即返回、不再比对本次的 `lineageId`/`parentId`**：与索引定义一致，也是评估第 5 条的字面语义；已写进 04 文档，并有跨谱系并发用例覆盖。
6. **重放在锁内先于各路径自己的校验**（否则 `createRoot` 重放会退化成 `root_exists` 报错）；重放也不再写活动日志、不再加 `node_count`。
7. 未做的事：R30 未动（评估明确不在本条范围内）；`11-需求与实现状态.md` 未改（本次是缺陷修复，不是 FR 状态变化）。

## Follow-ups

- 迁移与业务代码按 AGENTS §9 分两个 commit；合入 `main` 后确认 `.github/workflows/migrate-production.yml` 这条 job 绿（R29）。
- 其余创建类写入（组织、项目、分类、谱系、谱书、编目）仍只有业务唯一索引、没有幂等键：R31 现记为「缓解中」，下次动那些创建路径时按同一手法补。
- 若将来要把 `uk_node_org_request_id` 之类手写索引收进 schema，顺手把 0014 的 `idx_node_spouse_sort` 一起收编（它只存在于迁移里）。
- `tests/integration/fact-cli.test.ts` 三条子进程用例在本机稳定超时（15s 上限），要么给它单独 `testTimeout`，要么改成注入连接对象的进程内调用——与本修复无关，建议单开一条。
- 建议下一步跑一次 `/speckit-bug-test slug=lineage-create-idempotency`，并补一次 `pnpm test:e2e`（会清空测试库）覆盖「双击添加子女」的真实浏览器路径。
