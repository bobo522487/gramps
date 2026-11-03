# 用 Linus 的尺子再看这个仓库

> **评审对象**：`lib/**`、`app/**`、`components/lineage/**`、`components/article/**`、迁移 `0000`–`0021`、fitness function、`docs/architecture/11` 与 `12`
> **评审日期**：2026-11-03
> **评审基线**：`010bd87`（`main`）
> **性质**：评审记录，**不是规范**。结论要变成约束，必须先写进 `architecture/` 或 `decisions/`。
> **方法**：跟 [2026-10-24 评审](./2026-10-24-linus-architecture-review.md) 同一套八条尺子。每一条都对着这个提交的代码重测，不沿用旧行号。
> **不做的事**：不重跑已归档的 [10-26 精简计划](../plans/2026-10-26-linus-architecture-simplification.md)。那份计划的路径（单体 `lib/db/schema.ts`、`docs/architecture/07-quality.md`）已经失效，复选框也不能当进度。

---

## 0. 结论

**10 月能用补丁收口的，已经收口了。现在还在产生成本的，是同一件家谱事实被存了两套，而第二套不会跟着第一套变。**

活的写入在 `node`。配偶仍是一行特殊的人：`role = 'spouse'` 时 `path` 必须为空。事实层（`person` / `person_name` / `family` / `family_partner` / `family_child` / 事件）是一条单向回填，组织里只要已经有一行 `person` 就拒绝再跑，之后的谱系编辑不碰这些表。回填还声明自己表达不了传记、多配偶下的生母、血亲身上的配偶边，性别也被收成男/女两档。

所以事实层不是「下一版的读模型」。它是某一次 `node` 的快照。快照从回填完成的下一秒起就开始说谎，而且没有任何请求路径会发现。

| | 判断 |
|---|---|
| 10 月的数据层补丁（父边复合外键、世次 CHECK、`withOrgWrite`、索引只算一次、超时、删掉没人读的 `idx_node_search`） | **留着。** 这些是对的减法，别为了「再抽象一层」拆开 |
| 树的特例 | **还在，而且复制了一份。** 生产代码里 `role === 'blood' \| 'spouse'` 仍有 10 个文件、28 处。事实层本该换掉这个特例，结果两套并存 |
| 读路径上的整页事务税 | **降级，不再当 P0。** `cache()` 与动态路由还在；真正没接上的是失效范围 |
| 文档 | **三处在描述一个已经不存在的仓库**（谱文「没有读写路径」、回填「可重复」、谱文列表「只有 EmptyState」） |

一句话：**别再给事实层加表。先决定哪一套是真的。在那之前，每一行新的谱系代码都在给一套不会更新的投影付利息。**

### 0.1 五条要点

1. **两套人。** `lib/lineage/node-services.ts` 不引用 `person`。`backfillFactLayer` 写完不回写 `node`，再跑就抛 `FactLayerAlreadyBackfilledError`。
2. **投影是有损的，所以不能切换。** 传记没有事实层的列；一个父亲多名配偶时生母被丢掉；`sex = 0/1` 被收成 `male/female`，`other` / `unknown` 无来路。
3. **谱文的 trigram 索引在重复人丁索引已经犯过的错。** `plain_text` 每次保存都写，`idx_article_search` 每次都维护，全仓库没有一条查询读它。ADR 0011 留下它的前提（「谱文实现那天」）已经到了，查询没有到。
4. **失效函数放错了模块，范围也没收。** `revalidateWholeConsole` 住在 `lib/lineage/revalidate.ts`，认证、组织、项目、分类、谱文都来调用。旁边两个收窄函数写了、测了、没人调用。
5. **风险登记簿有两条已经与代码相反。** 谱文编辑器在跑；回填不能重复执行。拿 R21/R22 排技术债顺序，会排错。

---

## 1. 尺子

| # | 原则 | 本次怎么用 | 本次命中 |
|---|---|---|---|
| L1 | 数据结构优先 | 同一事实是否两列、两表各写一份 | `node` 与事实层；`content` JSON 与 `plain_text`；`lineage.node_count` |
| L2 | 好品味 = 消除特例 | 为迁就模型而存在的分支 | 配偶 `path IS NULL`；`folder.kind` 的 `0/1/2` 字面量 |
| L3 | 复杂即敌 | 一个目的几套机制 | 整树失效 + 两个没接线的收窄函数；谱文计数两次事务 |
| L4 | 理论服从实践 | 文档说的仓库还在不在 | R21、R22、[11 §4.2](../../architecture/11-需求与实现状态.md) 的占位句 |
| L5 | 不破坏用户空间 | 建议是否要动已经工作的写入 | 不重置库、不改历史迁移、不把 UI 切到事实层 |
| L6 | 给我看代码 | 每条都有文件和行 | 见 §3 |
| L7 | 约束要有执行者 | 索引、列、风险条目有没有读者 | `idx_article_search`、`article.kind`、F6 豁免 |
| L8 | 一次一个补丁 | 建议能否各自回滚 | §6 |

不评审视觉、无障碍、定价、产品范围。

---

## 2. 不要动

这些是 10-24 之后已经做对的，或者本来就对。下一轮不要以「整理」的名义拆掉。

| # | 决策 | 证据 |
|---|---|---|
| 1 | 父边、配偶边都在同一组织、同一谱系里 | `fk_node_parent_same_lineage`、`fk_node_spouse_same_lineage`（`lib/db/schema/lineage.ts` 105–116 行） |
| 2 | 世次不是路径深度的第二份拷贝；可以比树深，不能比树浅 | 同文件 63–75 行、125–128 行的 `ck_node_generation_gte_tree_depth`。`depth` 列已删除 |
| 3 | 分类树的父边同样是复合外键 | `fk_folder_parent_same_project`（`lib/db/schema/project.ts` 90–94 行） |
| 4 | 写入口收成 `withOrgWrite` → `requireOrgPermission` | `lib/db/write.ts`、`lib/db/guards.ts` |
| 5 | `buildLineageIndex` 一次渲染只算一遍 | `components/lineage/lineage-index-context.tsx` |
| 6 | 人丁 trigram 索引删了，因为没有查询用它 | `lib/db/migrations/0013_drop_node_trgm.sql`，决策在 [ADR 0011](../../decisions/0011-search-boundary-node-client-article-trgm.md) |
| 7 | 语句超时落在角色上，不落在每个查询里 | `lib/db/migrations/0006_statement_timeouts.sql` |
| 8 | F1′–F9 有执行者 | [08-非功能性设计](../../architecture/08-非功能性设计.md) 的 fitness 表；`pnpm arch:check` 的豁免是棘轮（只许缩） |
| 9 | 谱文导航不塞进谱系的 `nav.ts` | `lib/article/nav.ts` 与 `lib/lineage/nav.ts` 各包一层 `cache()` |
| 10 | 零后台任务、`getSessionUser()` 只返回窄 DTO、只读 Route Handler 保留 | 与 10-24「不要动」清单相同，这次没有看到回退 |

`folder_id` 没有复合外键，是 [ADR 0016](../../decisions/0016-tenant-columns-immutable.md) 已经批准的残留缺口（该文「残留缺口」段，[04](../../architecture/04-数据视图-数据架构.md) 1459 行复述）。这次不把它再升成新发现。应用层对谱系查 `kind = 0`（`lib/lineage/services.ts` 的 `validProjectFolder`），对谱文查 `kind = 1`（`lib/article/mutations.ts` 68–83 行）。库层仍然不挡。

---

## 3. 问题

优先级：**P0** = 现在就在制造第二份会过期的真相 · **P1** = 下一个功能（谱书、事实层切换、正文检索）之前必须收口 · **P2** = 已经登记、这次只确认还在 · **-D** = 文档与代码相反。

### 3.1 已关闭（10-24 的编号，避免再排进计划）

| 旧编号 | 当时的说法 | 这次实测 |
|---|---|---|
| P0-1 | 父边没有复合外键 | 已有，见 §2 |
| P0-2 | 详情页 7 个事务 / 约 35 次往返 | 不再成立为 P0。详情页仍是多次 `withOrg`（`requireProjectContext`、`getLineageById`、`getNodes`、`getNavFolders`），但不是那份附录里的数字 |
| P0-4 | 世次与深度没有 CHECK，`generation` 是冗余 | CHECK 已在；`generation` 被明确允许深于路径，不再是冗余列 |
| P1-5 | `requireLineageWrite` 两份 | 已收成 `withOrgWrite` |
| P1-6 | 索引算四遍 | 已收成 Provider |
| P1-11 | 没有 `statement_timeout` | `0006` 已加 |
| P1-12 | 架构约束没有执行者 | F1′–F9 已接线 |
| — | `idx_node_search` 无读者 | `0013` 已删 |

### 3.2 仍然成立，而且比 10 月更贵

#### P0-1 事实层是快照，写入不更新它

`lib/db/backfill/fact-layer.ts` 开头写明：单向桥，每个组织一个事务，**不写回 `node`**。`lockOrganization`（同文件 56–71 行）对 `person` 做 `count(*)`，大于 0 就抛 `FactLayerAlreadyBackfilledError`。函数注释（334–338 行）说这是唯一的重入闸门，因为事件没有自然幂等键。

活路径在 `lib/lineage/node-services.ts`，经 `withOrgWrite` 写 `node`。全仓库 `lib/` 里没有任何谱系写入去 `insert(persons)` 或更新 `legacy_node_id`。

[12-风险与演进规划](../../architecture/12-风险与演进规划.md) R21 写「回填 + 对账 CLI 可重复执行」。对账可以重复。回填不可以：第二次调用在写入之前就失败。技术债顺序的第一条（「先补事实层切换」）建立在一个比代码乐观的合同上。

这不是「还没做完的功能」。这是两套结构。一套在被编辑，一套在被当成迁移目标。中间没有同步。

#### P0-2 这套投影表达不了现在的 `node`，所以不能把读切过去

`lib/db/backfill/fact-layer-rules.ts` 的 `LossReport` 把损失写成计数器，而不是修掉：

| 损失 | 代码在说什么 |
|---|---|
| `biographyDropped`（29–34 行） | 事实层没有传记列。正文留在 `node`，**没有对账** |
| `unknownMother` / `noMotherAtAll`（15–18 行） | 多名配偶时，子女的生母在 `node` 里本来就不存在。投影无法发明它 |
| `spouseEdgeOnBloodNode`（39–44 行） | `ck_node_spouse_has_no_path` 允许血亲行带 `spouse_of_id`，事实层跳过这条边 |
| 性别 | `fact-layer.ts` 87 行：`CASE WHEN n.sex = 0 THEN 'male' ELSE 'female' END`。`person.sex` 的合法值还有 `other`、`unknown`（`lib/genealogy/constants.ts` 13–18 行）。回填永远写不出这两档，也没有路写回 `smallint` |

配偶特例因此没有被消除，只是被翻译了一次。生产代码里仍要分支（不含测试）：

| 文件 | `role === 'blood' \| 'spouse'` 次数 |
|---|---|
| `components/lineage/person-inspector.tsx` | 8 |
| `components/lineage/node-commands.ts` | 5 |
| `lib/lineage/node-services.ts` | 3 |
| `components/lineage/derived.ts` | 3 |
| `lib/db/backfill/fact-layer-rules.ts` | 3 |
| `lib/lineage/subtree.ts` | 2 |
| 画布、布局、详情、移动对话框各 1 | 4 |
| **合计** | **10 个文件，28 处** |

约束本身把特例焊进了表：`ck_node_spouse_has_no_path`（`lineage.ts` 119–122 行）要求配偶 `path IS NULL` 且 `spouse_of_id` 非空，血亲则 `path` 非空。

#### P1-3 `plain_text` 与 `idx_article_search` 没有读者

[ADR 0011](../../decisions/0011-search-boundary-node-client-article-trgm.md) 第 3 条：留下 `pg_trgm` 和 `idx_article_search`，因为 FR-ART-5 在谱文实现的那天要用。谱文读写已经落地（`lib/article/actions.ts`、`app/(dashboard)/dashboard/project/[projectRef]/articles/`）。正文检索没有落地。

- 列表自己写明：标题过滤在已经下发的全量数据上做，正文检索才需要 `plain_text`（`components/article/article-list.tsx` 24–30 行）。
- `lib/` 里对 `plainText` 的引用全是写入（`lib/article/page-services.ts` 四处 `derivePlainText`，`services.ts` 新建时写空串）。没有 `ILIKE`、`similarity` 或 trigram 运算符。
- 唯一读这列的是测试。索引的执行者是 `tests/integration/search-boundary.test.ts`，它断言索引**存在**，不断言有查询用它。
- 每次保存都更新 `plain_text`，GIN 就跟着做一次 trigram 分解。这正是 `0013` 删掉 `idx_node_search` 的理由，迁移注释还把谱文索引留作「实现那天」。那天已经过去了。

`article.kind` 是同一类列：schema 保留，创建时恒为 `null`（`lib/article/services.ts` 65 行）。[04](../../architecture/04-数据视图-数据架构.md) 1068 行承认这一点。列还在，就还会有人给它写含义。

#### P1-4 失效：范围是整棵控制台，所有权在谱系模块

`lib/lineage/revalidate.ts` 6–16 行写着现状：所有写 Action 只调 `revalidateWholeConsole()`；`revalidateProject` / `revalidateOrg` 没接线，因为入参里没有公开 ID。34–36 行是实际入口，`revalidatePath('/dashboard', 'layout')`。

调用方包括 `lib/article/actions.ts`、`lib/folder/actions.ts`、`lib/org/actions.ts`、`lib/project/actions.ts`、`lib/auth/actions/account.ts`。改密码和改谱文走同一个谱系文件。

文件自己解释了为什么现在不炸：构建产物里业务路由都是动态的，整树失效打的是客户端 Router Cache。这个解释成立，就不要为了「看起来收窄」去改行为。要改的是**依赖方向**：控制台失效不属于谱系。

#### P1-5 谱文分类计数用了两个事务算一个差

`countArticlesByFolder`（`lib/db/queries/articles.ts` 117–168 行）对分组计数和总数各开一次 `withOrg`，再 `Promise.all`。`unfiled = total - filed` 来自两个快照。中间有写入时，未分类数可以偏一，极端时为负。一次事务里两条语句就够。

#### P1-6 谱书还没写入口，但书的外键已经是窄的

`book_catalog.book_id` 引用 `book.id`（`lib/db/schema/content.ts` 92–94 行，基线迁移里的 `book_catalog_book_id_book_id_fk`）。父边后来补成了 `(parent_id, organization_id, book_id)`。**书本身没有 `(organization_id, book_id)` 复合外键。** 编目行的 `organization_id` 可以和书的 `organization_id` 不同；同时是两个组织成员的人，只要知道对方的书 UUID，就能把编目挂过去。

谱书页面仍是占位（`app/(dashboard)/dashboard/project/[projectRef]/books/page.tsx` 24–28 行）。现在没有写入口，洞是潜伏的。**先补复合外键，再做编目 UI。** 倒过来就会把 10 月在 `node.parent_id` 上修过的坑再挖一次。

#### P1-7 F6 守住了增长，守不住阅读

豁免在 `scripts/check-file-size.mjs` 21–29 行。这次的行数（上限 → 现值）：

| 文件 | 上限 | 现值 |
|---|---|---|
| `lib/lineage/node-services.ts` | 820 | 817 |
| `components/lineage/lineage-detail.tsx` | 865 | 791 |
| `components/lineage/canvas/genealogy-canvas.tsx` | 773 | 765 |
| `components/lineage/lineage-sidebar.tsx` | 734 | 719 |
| `components/ui/sidebar.tsx` | 717 | 717 |
| `components/lineage/person-inspector.tsx` | 606 | 543 |
| `components/lineage/node-create-dialog.tsx` | 581 | 581 |

棘轮有效：没有一个文件变长。但改谱系仍要读 500–800 行的文件，而 400 行规则的豁免恰好就是这些文件。`person-inspector.tsx` 已降到 543，离摘掉豁免最近。不要为了摘豁免把文件按任意标题切开。

`valueSet` 在 `lib/db/schema/person.ts`、`family.ts`、`event.ts` 各有一份逐字相同的函数（约 40 行附近）。三份都能生成 CHECK 字面量。这是小的，不要单独开一轮重构；下一次改事实层 schema 时收成一处。

### 3.3 文档与代码相反（-D）

| 文档 | 写法 | 代码 |
|---|---|---|
| [12](../../architecture/12-风险与演进规划.md) R22 | 谱文 / 谱书表已落库但没有读写路径；页面只渲染 `EmptyState` | 谱文列表、编辑器、Action、集成测试都在。谱书页面确实仍是 `EmptyState` |
| 同文件 R21 | 回填可重复执行 | `FactLayerAlreadyBackfilledError` |
| 同文件「技术债顺序」第 1 条 | 不切换就要一直维护两套形态 | 方向对，合同错：今天并没有在维护第二套，第二套是冻结的 |
| [11 §4.2](../../architecture/11-需求与实现状态.md) 223 行 | `/articles` 与 `/books` 目前只有列表页并渲染占位 `EmptyState` | 同文件 214 行和 §7 的 FR-ART 矩阵写的是编辑器已实现。223 行把谱文和谱书绑成同一句，谱文半句是错的 |
| [ADR 0011](../../decisions/0011-search-boundary-node-client-article-trgm.md) 第 3 条 | 索引留给谱文实现的那天 | 谱文在，查询不在。决策需要重估，不是再解释一遍 |

R30（世系表按 `generation, sort` 而不是房支深度优先）仍在：`components/lineage/derived.ts` 38–43 行，`lib/db/queries/nodes.ts` 23 行的 `orderBy(generation, sort, createdAt)`。R31（创建无幂等键）仍在：`node` 上没有 `request_id`。R17（`getNodes` 无上限，`select()` 整行）仍在：`lib/db/queries/nodes.ts` 8–24 行。这三条风险文档写对了，这次不升优先级，但也不要当成已修。

---

## 4. 建议的补丁顺序

每一步都能单独回滚。不要合成一个「事实层切换」大补丁。

1. **改三处文档，让它们描述这个提交。** R22 拆成「谱文已有读写 / 谱书仍是占位」。R21 改成「回填一次；对账可重复；写入不更新事实层」。删掉 11 §4.2 里把谱文列表说成 EmptyState 的那句。这是零行为变更。
2. **重估 ADR 0011 第 3 条。** 两条路二选一：做出真正使用 `plain_text` 的查询，或按 `0013` 的同样理由暂时去掉 `idx_article_search`（列可以留，索引先走）。不要两边都留着。
3. **把 `revalidateWholeConsole` 移出 `lib/lineage/`。** 行为不变，调用点改 import。收窄失效仍然等到 Action 拿得到 `orgSlug` / `projectRef`，文件里的理由继续有效。
4. **`countArticlesByFolder` 收成一次 `withOrg`。** 补一条并发下 `unfiled` 不为负的集成测试。
5. **谱书动手之前，给 `book_catalog` 加 `(organization_id, book_id) → book(organization_id, id)`。** `book` 上已有 `uk_book_organization_id`。迁移单独提交，不夹数据修复。
6. **事实层：在写出唯一写入路径之前，不加表、不切读。** 可接受的小步只有两个：写一条测试钉住「`node` 的写入口不修改 `person`」，防止有人以为已经双写；或者写切换计划。双写（每个 `node` 写入口再写一遍事实层）是第三套机制，会漂，不要做。

明确不做：把 UI 改成读 `person`；为了 F6 把 `node-services.ts` 按标题拆开；给 `folder.kind` 再包一层枚举框架（`FOLDER_KINDS` 已经在 `lib/genealogy/schemas.ts` 9 行，调用点的 `0`/`1` 留到碰那几行时换成常量）；重做 10 月已经落地的父边外键。
