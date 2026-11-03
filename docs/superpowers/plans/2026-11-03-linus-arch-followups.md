# Linus 架构评审后续补丁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 [2026-11-03 Linus 架构评审](../../archive/reviews/2026-11-03-linus-architecture-review.md) §4 的六条建议落成可独立回滚的小补丁：文档与代码对齐、去掉无读者的谱文 trigram 索引、失效函数移出谱系模块、谱文分类计数单事务、谱书编目复合外键、钉住「`node` 写不碰事实层」。

**Architecture:** 不切读到事实层、不做 node/person 双写、不实现正文全文检索（FR-ART-5 后置项仍后置）。ADR 0011 第 3 条改为「索引随查询一起加」：先删 `idx_article_search`，保留 `plain_text` 列与 `pg_trgm` 扩展。失效范围行为不变，只改模块归属。

**Tech Stack:** Next.js App Router · Drizzle · PostgreSQL 18 · Vitest（单测 + 真实 PG 集成）· 现有 `pnpm docs:check` / `arch:check`

**Spec / 输入:** [2026-11-03 评审](../../archive/reviews/2026-11-03-linus-architecture-review.md) §4 · [ADR 0011](../../decisions/0011-search-boundary-node-client-article-trgm.md) · [12-风险与演进规划](../../architecture/12-风险与演进规划.md) R21/R22

## Global Constraints

- 不重置数据库；不改已提交的历史迁移；新迁移只追加 `0025+`。
- 迁移与业务代码分开提交；迁移不得夹带数据修复。
- 不做事实层双写；不把 UI 切到 `person`；不实现谱文正文检索查询。
- 收窄 `revalidatePath` 范围**不在本期**（Action 仍无公开 ID）；只搬家。
- 面向用户文案简体中文；提交前相关测试绿。
- 开工在分支 `cursor/linus-architecture-review-4e90`（已含评审文档）。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `docs/architecture/12-风险与演进规划.md` | 修改 | R21/R22 与技术债顺序对齐现状 |
| `docs/architecture/11-需求与实现状态.md` | 修改 | §4.2 脚注不再把谱文说成 EmptyState |
| `docs/decisions/0011-search-boundary-node-client-article-trgm.md` | 修改 | 第 3 条改为删索引；更新后果 |
| `lib/db/migrations/0025_drop_article_trgm.sql` | 新建 | `DROP INDEX idx_article_search` |
| `tests/integration/search-boundary.test.ts` | 修改 | article 上零 trigram 索引；扩展仍在 |
| `lib/console/revalidate.ts` | 新建 | 从 lineage 挪来的失效 helper |
| `lib/lineage/revalidate.ts` | 删除 | 改由 console 拥有 |
| `lib/*/actions.ts`、`lib/auth/actions/account.ts` | 修改 | import 路径 |
| `tests/revalidate-paths.test.ts` | 修改 | import 新路径；Action 列表含 article |
| `lib/db/queries/articles.ts` | 修改 | `countArticlesByFolder` 一次 `withOrg` |
| `tests/integration/queries.test.ts` | 修改 | 既有用例仍过；必要时补断言 |
| `lib/db/schema/content.ts` | 修改 | `book_catalog` → `book` 复合外键 |
| `lib/db/migrations/0026_*.sql` | 生成/手写 | 复合外键迁移（单独 commit） |
| `tests/security-regressions.test.ts` 或新建 | 修改 | 源码钉：node 写路径不碰 person |

---

### Task 1: 文档对齐现状

**Files:**
- Modify: `docs/architecture/12-风险与演进规划.md`（R21、R22、§技术债偿还顺序第 1 条）
- Modify: `docs/architecture/11-需求与实现状态.md`（约 223 行脚注）

**Interfaces:** 无代码接口。

- [ ] **Step 1: 改 R21**

把缓解列从「回填 + 对账 CLI 可重复执行」改成明确合同：回填每个组织一次（已有 `person` 则 `FactLayerAlreadyBackfilledError`）；对账可重复；谱系写入不更新事实层；切换计划未编写。

- [ ] **Step 2: 改 R22**

拆开谱文与谱书：谱文已有列表/编辑器/Action；谱书仍只有 `EmptyState`。状态可仍为「缓解中」（谱书缺口）。

- [ ] **Step 3: 改技术债顺序第 1 条**

不要写「谱文路径无」。改成：事实层仍是冻结快照（R21）；谱书仍无读写（R22 谱书半边）。下一步仍是「先定唯一写入路径再切读」，**禁止**在每个 `node` 写入口双写。

- [x] **Step 4: 改 11 §4.2 脚注**

原文把 `/articles` 与 `/books` 绑成「只有列表 + EmptyState」。改为：谱文列表与编辑器已实现（见同行 L3 与 §7）；谱书列表仍为 `EmptyState`；编目标路由未建。

- [ ] **Step 5: 验证并提交**

Run: `pnpm docs:check --strict`  
Expected: `0 issue(s)`

```bash
git add docs/architecture/12-风险与演进规划.md docs/architecture/11-需求与实现状态.md
git commit -m "docs(docs): 对齐 R21/R22 与谱文实现现状"
```

---

### Task 2: 去掉无读者的 `idx_article_search`

**Files:**
- Create: `lib/db/migrations/0025_drop_article_trgm.sql`
- Modify: `lib/db/migrations/meta/_journal.json`（登记 tag）
- Modify: `tests/integration/search-boundary.test.ts`
- Modify: `docs/decisions/0011-search-boundary-node-client-article-trgm.md`
- 若 `tests/integration/migrations.test.ts` 硬编码索引名：同步改

**Interfaces:**
- Produces: article 表上零 `gin_trgm_ops` 索引；`pg_trgm` 扩展仍安装；`article.plain_text` 列保留并由 `derivePlainText` 继续写。

- [ ] **Step 1: 改失败的边界测试**

把「article 恰有 `idx_article_search`」改成「article 上零 trigram 索引」；第三条改为「保留 `pg_trgm` 扩展（正文检索落地当天再建索引）」：

```ts
  it('keeps no trigram index on article until a query consumes one', async () => {
    const articleTrgm = await getTestSql()<
      { indexname: string }[]
    >`select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'article'
        and indexdef ilike ${'%gin_trgm_ops%'}`;

    expect(articleTrgm).toEqual([]);
  });

  it('keeps the pg_trgm extension for the day FR-ART-5 body search ships', async () => {
    const extensions = await getTestSql()<
      { extname: string }[]
    >`select extname from pg_extension where extname = 'pg_trgm'`;

    expect(extensions).toEqual([{ extname: 'pg_trgm' }]);
  });
```

文件头注释同步改写。

- [ ] **Step 2: 跑集成测试确认失败**

Run: `pnpm exec vitest run tests/integration/search-boundary.test.ts`  
Expected: article 索引那条 FAIL（仍能看到 `idx_article_search`）

- [ ] **Step 3: 手写迁移（照 `0013_drop_node_trgm.sql`）**

```sql
-- idx_article_search has had no consumer since 谱文列表用前端标题过滤
-- (components/article/article-list.tsx). plain_text is still derived on save
-- (ADR 0010); the GIN index only paid trigram maintenance. FR-ART-5 body
-- search remains deferred: re-add the index in the same change as the query.
-- Keep pg_trgm installed so that day is one CREATE INDEX, not CREATE EXTENSION.
DROP INDEX IF EXISTS "idx_article_search";
```

在 `_journal.json` 追加 idx 25 / tag `0025_drop_article_trgm`（`when` 用当前毫秒时间戳）。

- [ ] **Step 4: 更新 ADR 0011**

决策第 3 条改为：在出现真正的正文检索查询之前，`article` 不保留 trigram 索引。后果段删掉「中性 · article 侧不受影响」。重估触发：正文检索开工时，同一改动里加查询 + `CREATE INDEX` + 放宽 `search-boundary` 断言。

- [ ] **Step 5: 跑迁移相关测试并提交（仅迁移 + ADR + 测试）**

Run: `pnpm exec vitest run tests/integration/search-boundary.test.ts tests/integration/migrations.test.ts`  
Expected: PASS

```bash
git add lib/db/migrations/0025_drop_article_trgm.sql lib/db/migrations/meta/_journal.json \
  tests/integration/search-boundary.test.ts tests/integration/migrations.test.ts \
  docs/decisions/0011-search-boundary-node-client-article-trgm.md
git commit -m "fix(db): 删除无查询消费的 idx_article_search"
```

---

### Task 3: 失效入口移到 `lib/console/`

**Files:**
- Create: `lib/console/revalidate.ts`（内容即现 `lib/lineage/revalidate.ts`）
- Delete: `lib/lineage/revalidate.ts`
- Modify: `lib/lineage/actions.ts`、`lib/folder/actions.ts`、`lib/project/actions.ts`、`lib/org/actions.ts`、`lib/article/actions.ts`、`lib/auth/actions/account.ts`
- Modify: `tests/revalidate-paths.test.ts`

**Interfaces:**
- Produces: `revalidateWholeConsole(): void`、`revalidateProject(orgSlug, projectRef): void`、`revalidateOrg(orgSlug): void`，行为与现实现逐字相同。

- [ ] **Step 1: 新建 `lib/console/revalidate.ts`，更新测试 import**

`tests/revalidate-paths.test.ts` 改为 `from '@/lib/console/revalidate'`；Action 列表补上 `lib/article/actions.ts`。

- [ ] **Step 2: 跑单测确认仍绿（文件已存在时可先复制再改 import）**

Run: `pnpm exec vitest run tests/revalidate-paths.test.ts`  
Expected: PASS

- [ ] **Step 3: 六个 Action 改 import；删除旧文件**

全部改为 `from '@/lib/console/revalidate'`。不要留 `lib/lineage/revalidate.ts` 再导出（避免第二入口）。

- [ ] **Step 4: 全仓确认无旧路径**

Run: `rg "lineage/revalidate" -g '*.ts' -g '*.tsx'`  
Expected: 无匹配（文档里历史引用除外）

- [ ] **Step 5: 提交**

```bash
git add lib/console/revalidate.ts lib/lineage/revalidate.ts \
  lib/lineage/actions.ts lib/folder/actions.ts lib/project/actions.ts \
  lib/org/actions.ts lib/article/actions.ts lib/auth/actions/account.ts \
  tests/revalidate-paths.test.ts
git commit -m "refactor(ui): 把控制台失效入口移出谱系模块"
```

---

### Task 4: `countArticlesByFolder` 单事务

**Files:**
- Modify: `lib/db/queries/articles.ts:117-169`
- Modify: `tests/integration/queries.test.ts`（既有 `counts articles per 谱文 folder` 必须仍过）

**Interfaces:**
- Consumes: `withOrg(userId, fn)`
- Produces: 同一签名 `countArticlesByFolder(userId, orgId, projectId): Promise<ArticleFolderCounts>`；`unfiled = total - filed` 来自同一事务快照。

- [ ] **Step 1: 改实现为一次 `withOrg`**

```ts
export async function countArticlesByFolder(
  userId: string,
  orgId: string,
  projectId: string
): Promise<ArticleFolderCounts> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({ folderId: folders.id, value: sql<number>`count(*)` })
      .from(articles)
      .innerJoin(
        folders,
        and(
          eq(folders.id, articles.folderId),
          eq(folders.kind, 1),
          isNull(folders.deletedAt)
        )
      )
      .where(
        and(
          eq(articles.orgId, orgId),
          eq(articles.projectId, projectId),
          isNull(articles.deletedAt)
        )
      )
      .groupBy(folders.id);

    const totalRows = await tx
      .select({ value: sql<number>`count(*)` })
      .from(articles)
      .where(
        and(
          eq(articles.orgId, orgId),
          eq(articles.projectId, projectId),
          isNull(articles.deletedAt)
        )
      );
    const total = Number(totalRows[0]?.value ?? 0);

    const byFolder = new Map<string, number>();
    let filed = 0;
    for (const row of rows) {
      byFolder.set(row.folderId, Number(row.value));
      filed += Number(row.value);
    }

    return { byFolder, unfiled: total - filed, total };
  });
}
```

- [ ] **Step 2: 跑集成测试**

Run: `pnpm exec vitest run tests/integration/queries.test.ts -t 'counts articles per'`  
Expected: PASS；`unfiled` 仍为既有夹具期望值。

- [ ] **Step 3: 提交**

```bash
git add lib/db/queries/articles.ts
git commit -m "fix(db): 谱文分类计数在同一事务内求差"
```

---

### Task 5: `book_catalog` 复合外键（迁移单独 commit）

**Files:**
- Modify: `lib/db/schema/content.ts`（`bookCatalogs`）
- Create: `lib/db/migrations/0026_*.sql`（由 `pnpm db:generate` 或手写，须人工 review）
- Modify: `lib/db/migrations/meta/_journal.json`
- Test: 若有 catalog / book 集成测试则跑；否则加一条最小集成断言跨组织挂编目被拒

**Interfaces:**
- Produces: `fk_catalog_book`（或 drizzle 生成名）`FOREIGN KEY (organization_id, book_id) REFERENCES book(organization_id, id)`；去掉仅引用 `book(id)` 的窄外键。

- [ ] **Step 1: 改 schema**

在 `bookCatalogs` 上：

1. 去掉 `.references(() => books.id, { onDelete: 'cascade' })`（`app_rw` 无 DELETE，cascade 本就死重量；父边已是 `restrict`）。
2. 增加：

```ts
foreignKey({
  columns: [t.orgId, t.bookId],
  foreignColumns: [books.orgId, books.id],
  name: 'fk_catalog_book',
}).onDelete('restrict'),
```

`uk_book_organization_id` 已存在，可作为目标。

- [ ] **Step 2: 生成或手写迁移并 review**

优先 `pnpm db:generate`，人工确认：`DROP` 旧 `book_catalog_book_id_book_id_fk`，`ADD` 复合外键。空库可一次跑通；无数据 backfill。

- [ ] **Step 3: 迁移单独提交**

```bash
git add lib/db/schema/content.ts lib/db/migrations/
git commit -m "fix(db): book_catalog 用复合外键钉住书的组织"
```

业务代码若无其它改动，本任务到此结束。若补了集成测试，测试可与 schema 同 commit（仍不算「业务功能」）。

---

### Task 6: 钉住「谱系写入口不碰事实层」

**Files:**
- Modify: `tests/security-regressions.test.ts`（或 `tests/fact-layer-write-boundary.test.ts` 新建）

**Interfaces:**
- Produces: 源码级不变量——`lib/lineage/node-services.ts` 与 `lib/lineage/services.ts` 不出现 `persons` / `personNames` / `families` / `familyPartners` / `familyChildren` 的 schema import 或表名字符串写入。

- [ ] **Step 1: 写测试**

```ts
it('lineage write services do not import the fact-layer tables', () => {
  const files = [
    'lib/lineage/node-services.ts',
    'lib/lineage/services.ts',
  ];
  const sources = files
    .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
    .join('\n');

  expect(sources).not.toMatch(/\bpersons\b/);
  expect(sources).not.toMatch(/\bpersonNames\b/);
  expect(sources).not.toMatch(/\bfamilies\b/);
  expect(sources).not.toMatch(/\bfamilyPartners\b/);
  expect(sources).not.toMatch(/\bfamilyChildren\b/);
});
```

（若 `security-regressions` 已有 `readFileSync` 模式，跟它放一起。）

- [ ] **Step 2: 跑测试**

Run: `pnpm exec vitest run tests/security-regressions.test.ts`  
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add tests/security-regressions.test.ts
git commit -m "test(db): 钉住谱系写入不碰事实层表"
```

---

### Task 7: 收尾验证

- [ ] **Step 1: 全量门禁**

Run: `pnpm check && pnpm typecheck && pnpm test`  
Expected: 全绿

- [ ] **Step 2: 文档与架构**

Run: `pnpm docs:check --strict && pnpm arch:check`  
Expected: 0 issue

- [ ] **Step 3: 有库则跑相关集成**

Run: `pnpm exec vitest run tests/integration/search-boundary.test.ts tests/integration/queries.test.ts tests/integration/migrations.test.ts`  
Expected: PASS

- [ ] **Step 4: finishing-a-development-branch**

推送分支、更新 PR 描述（含本计划六项落地说明）。
