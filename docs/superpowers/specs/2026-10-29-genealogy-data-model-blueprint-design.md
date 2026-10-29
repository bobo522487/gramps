# 家谱数据模型全域蓝图（目标设计）

> **状态**：待评审 · 2026-10-29
> **范围**：全域目标模型（九层）+ 分段落地顺序。**不是实施计划**——DDL、索引列、触发器、迁移脚本、DTO 由后续 `writing-plans` 产出。
> **取代**：[ADR 0003](../../decisions/0003-tree-storage-ltree.md)（严格父系 ltree 单树）；[A1 spec](2026-10-29-person-family-model-design.md) §2 决策 2（`person` 归属 `lineage`）、§4.1（`person.role`）、§4.4（`person_tree` 挂 `person`）。
> **相关**：[数据模型](../../data-model.md) · [架构 05-data](../../architecture/05-data.md) · [附件 v1.0 评审](../../reviews/2026-10-29-data-model-v1.0-review.md) · [A2.1 计划](../plans/2026-10-29-a2-lifespan-layer.md) · [ADR 索引](../../decisions/README.md) D-4

> **基线声明**：本文的「现状」以**代码**为准（`lib/db/schema.ts:57-560`，11 张业务表），不以 `docs/data-model.md` 为准——后者已过期（A1 spec §10.1）。外部附件的 DDL 行号引用指 `基于 GEDCOM 7.0 的 PostgreSQL 家谱数据模型 v1.0.md`。

---

## 1. 意图与理由

现状把「关系」编码进 `node` 一列一列：`parent_id`（父）、`spouse_of_id`（配偶）、`role`（`blood`/`spouse`）、`path`（`ltree` 父系路径）。[ADR 0003](../../decisions/0003-tree-storage-ltree.md) 已把它标为单向门，并逐条列出表达不了的情形：过继、兼祧、入赘、女儿入谱后子女成支。这不是"以后可能用到"，而是第一个客户就会提出来的常态。

桌上同时有三份材料：现仓库（`organization → project → lineage → node`）、A1 spec（`person`/`family`/`family_child`/`person_tree`，已定稿未实施）、外部附件 v1.0（40 张表，GEDCOM 7.0 全量映射 + 中文宗族层 + 出版层）。任意两份直接拼接都会留下结构性矛盾——评审 §7 已逐条列出 X1–X9。所以先出一份**以目标为准**的蓝图：它回答"这个系统最终该有哪些表、每层边界在哪、哪些是刻意不做的"，再分段落地。

**这份蓝图买到的**：过继 / 兼祧 / 一支两祧 / 入赘 / 联宗可表达；GEDCOM 7.0 可往返；史料与证据有位置；中文宗族的位次（排行、字辈、承嗣）是一等公民；九层依赖单向，可以按层交付、按层回滚。

**买不到的**：不做断言 / 证据优先模型（§5 方案三已排除），因此"同一事实两个来源冲突"只能**记录**、不能按置信度自动裁决；不做跨 project 的人物身份合并。

## 2. 已定决策（本次对话已确认，不再讨论）

1. 出**全域蓝图**，覆盖史料、媒体、GEDCOM 适配、谱书与校验，再分段落地。
2. 画法采**方案一「目标优先，A1 降为阶段一快照」**：蓝图以目标为准，逐条列出 A1 要改的地方（§20），A1 spec 落地时按修订版执行。
3. 先不写代码。

## 3. 目标 / 非目标 / 反目标

**目标**（可验证）

- 九层表结构齐备，依赖方向单向（§6），每层单独可交付。
- 中文宗族四个难例在结构上可表达且各有测试：兼祧（一人两房）、一支两祧、入赘、过继后归宗。
- GEDCOM 7.0 导入后导出，标准标签零丢失；非标准内容进 `gedcom_extension` 且可回放。
- 现有 `node` 数据无损迁移：人数、父子、配偶、排行、软删状态一条不少（§19）。
- 每张表的租户列不可被 UPDATE 搬走（§7.5）。

**非目标**

- 不做断言 / 证据优先模型（§5 方案三）。
- 不做通用全行审计日志（`change_log`）；理由见 §16.3 与 [ADR 0004](../../decisions/0004-soft-delete-forever.md)。
- 不做后台任务 / 队列 / 定时器（[ADR 0005](../../decisions/0005-zero-background-jobs.md)）：GEDCOM 大文件、缩略图流水线、PDF 渲染都不进一期。
- 不做硬删 / purge 通道（ADR 0004）。
- 不做跨 project 的人物身份合并：同一个人在两部谱里就是两条记录，用 `external_id` 与合并日志表达关联。
- 不做多语言 UI、不做 DNA、不做地图 GIS。
- 不改认证、成员、邀请、公开 ID 机制。

**反目标**（技术上成功也算失败）

- 表数量膨胀到 F6 与 400 行上限无法维护（§7.11 给出拆分与上限）。
- 用户看不到"这一支为什么接在这里"：位次与承嗣必须可见、可解释。
- 需要 DBA 手工 SQL 才能修数据。
- 为了 GEDCOM 保真牺牲中文表达，或反过来。

## 4. 约束（不可协商）

| 约束 | 出处 | 对蓝图的影响 |
|---|---|---|
| 组织隔离三层：应用层 `WHERE organization_id` + RLS + 复合外键 | [ADR 0006](../../decisions/0006-rls-isolation.md)、AGENTS.md §5.4 | 所有表以 `organization_id` 为根，禁止只按子资源 ID 查询 |
| `app_rw` **无 DELETE 授权** | `lib/db/migrations/0001_auth_rls.sql:406` | 表间不依赖 `ON DELETE CASCADE`；删除一律软删 |
| 软删永存，无回收站 | [ADR 0004](../../decisions/0004-soft-delete-forever.md) | 唯一约束一律部分索引 `WHERE deleted_at IS NULL` |
| 零后台任务 / 零常驻进程 | [ADR 0005](../../decisions/0005-zero-background-jobs.md)、ADR-23 | GEDCOM 导入同步完成并设上限（§14.4）；渲染留到 M3 |
| 检索边界：人丁搜索在客户端，`pg_trgm` 只给谱文 | [ADR 0011](../../decisions/0011-search-boundary-node-client-article-trgm.md) | 姓名**不建** trgm 索引；姓名列表随首屏一次载入 |
| 主键 `uuidv7()`；公开 ID 20 位仅用于 URL | AGENTS.md §5.5、ADR-20 | 所有新表用 `uuidPk()` 助手 |
| 单文件 ≤400 行（F6，豁免只许缩）；只在 `lib/config.ts` 读 `process.env`（F7） | `scripts/check-file-size.mjs` | `lib/db/schema.ts` 必须先拆成目录（§7.11） |
| 表名单数、列名 `organization_id`、`uk_`/`idx_`/`ck_`/`fk_` 前缀 | `docs/data-model.md` §1.1 | 命名照抄现有 11 张表 |
| 迁移只做 DDL，回填进 `data/` 脚本；迁移与业务代码分开提交 | AGENTS.md §7 规则 8–9 | 每期拆成"迁移 PR"与"读写切换 PR" |
| `docs:check --strict`、`pnpm check && typecheck && test` | AGENTS.md §3 | 文档链接与锚点必须有效 |

## 5. 选定的画法与放弃的

**方案一（选定）：目标优先，A1 降为阶段一快照。** 蓝图按领域重画九层，A1 的四张表不再当公理，而是"第一阶段的实现快照"，逐条列出要改的地方（§20）。

- 买到：地基阶段就修掉兼祧、跨谱、位次三处结构性缺陷；后面五层不必替地基还债。
- 代价：要重开一份已定稿的 spec；A2.1 计划里的 `event`/`person_name` 设计需按本文重排（计划本身不必重写，任务边界会变）。

**方案二（放弃）：A1 不动，分层包裹。** 蓝图只规定层间公约，兼祧用旁挂位次表解决。

- 为什么不够：兼祧不是可选特性而是中文宗族的核心语义。降格成"旁挂例外"后，事件归属、史料挂载、谱书排版、GEDCOM 导出每一层都要为它绕一次；而 A1 尚未写一行代码，此刻修改的成本最低。

**方案三（放弃）：断言 / 证据优先。** 每个事实都是 `assertion(subject, property, value, confidence)` + 证据链接，`person` 上只留已裁决结论。

- 为什么不够：GEDCOM 7 本身就是这个模型，保真度最高、冲突有地方放；但现有检查器、世系表、谱系画布、搜索全按扁平列读，得先重建裁决层与投影层，查询与写路径复杂度上一个量级。且它不解决中文位次，位次表仍要单独建。等有了"多来源冲突必须自动裁决"的真实需求再回来（§24 重估触发）。

**排除：对附件 v1.0 做减法。** 它缺 `project` 层、缺公开 ID、缺 `article`/`folder`/`book_catalog`，而它 40 张表里有两处结构性主张（`person` 全局 + `lineage_person` 会员制、`genealogy` 即租户）与本仓库不可调和。减法工作量接近重写，还会被它的表结构惯性绑架。它的价值是**素材**：事件层、排他弧、证据链接、日期四件套直接吸收（评审 §3 G1–G8）。

## 6. 九层与依赖方向

```text
身份层   organization ── organization_member / invite（认证域，已有）
             └─ project ── lineage ── lineage_branch

事实层   person ── person_name
           ├─ person_association（人与人：教父/义子/门生）
           └─ family ── family_partner
                  └─ family_child（亲子边）

位次层   person_placement ── placement_tree（ltree 渲染缓存）
                └─ generation_poem / succession

时间层   place ── place_name ；  event ── event_participant ；  era

证据层   source ── citation ── evidence_link（排他弧）
         repository ── source_repository ；  submitter

媒体层   media ── media_file ；  media_link（排他弧）

适配层   gedcom_file ── gedcom_record ── gedcom_map ；  gedcom_extension ；  external_id

呈现层   note ── note_link ；  folder ── article ；  book ── book_catalog ── book_snapshot

治理层   validation_issue ；  person_merge_log ；  activity_logs（已有）
```

**依赖规则（单向，评审时逐条检查）**

1. 事实层只能引用身份层；位次层只能引用事实层 + 身份层；时间层引用事实层 + 位次层；证据层、媒体层、适配层可以引用以上任意层；呈现层与治理层可以**只读**引用全部。
2. **下层不得持有上层的 ID 列。** 具体后果：`family_partner` 不存 `marriage_event_id`（婚配事件用 `event` 的主体列表达）；`person` 不存 `birth_event_id`（生卒用 `event` 查）。
3. **事实层不得引用证据层。** 事实的"当前值"存列，证据存链接表——这是方案三被排除后必须接受的取舍，代价写在 §12.4。
4. 跨层派生只允许"缓存 + 可重建"：`placement_tree.path`、`book_snapshot.payload`、`person_merge_log.before_data` 都是缓存，必须能由下层重建，且提供重建脚本。

## 7. 全局公约

**7.1 表与键**

- 表名单数（`person` 不是 `persons`），TS 导出名复数（`persons`），照现有 11 张表。
- 每张组织级表：`id uuid primary key default uuidv7()` + `organization_id uuid not null`。
- **键的粒度按层定**（这条是结构性的，不是风格）：
  - 身份层（`project`/`lineage`/`folder`/`article`/`book`）：`unique (organization_id, id)`，外键两列。
  - **事实层与位次层**（`person`/`person_name`/`family`/`family_partner`/`family_child`/`person_placement`）：`unique (organization_id, project_id, id)`，外键三列。理由：`person.project_id` 是归属不变量（§9.1），若只用两列键，`family_child(organization_id, family_id, person_id)` 可以把 **project A 的人接到 project B 的 family** 上——同组织内的跨项目串数据，RLS 挡不住。
  - 证据层 / 媒体层 / 适配层 / 治理层引用事实层时，同样带 `project_id` 三列外键。
- 跨表引用一律复合外键，并显式 `ON DELETE RESTRICT`（默认），不用 CASCADE（`app_rw` 无 DELETE 权限，级联永远不会触发）。
- 子资源再带一层父键时，用四列复合外键（照 `folder` 的 `fk_folder_parent_same_project`、`book_catalog` 的 `fk_catalog_parent_same_book`）。
- **唯一一张不属任何租户的表：`era`**（§11.3 的年号表）。它由迁移 seed、`app_rw` 只授 `SELECT`、无 RLS——年号是公共知识，复制到每个组织里只会制造不一致。

**7.2 软删（全部软删，没有例外）**

`app_rw` 没有 DELETE 授权（`lib/db/migrations/0001_auth_rls.sql:406` 只授 `SELECT, INSERT, UPDATE`），因此**所有业务表一律软删**：

- 通用列：`created_at timestamptz not null default now()`、`created_by uuid not null`、`updated_at timestamptz`、`deleted_at timestamptz`。
- 关系边（`family_child`、`family_partner`、`person_placement`、`evidence_link`、`media_link`、`note_link`、`gedcom_map`、`person_association`、`generation_poem`）也是软删。"解除关系"= 置 `deleted_at` + 建正确的新边，UI 上的"删除这一支/解除父子"都走这条路径。
- 唯一允许物理 DELETE 的表是 `placement_tree`（纯渲染缓存，整树重算要清空重插），走 ADR 0014 的最小授权，**只授这一张表**。
- `book_snapshot` 只插入、不更新、不删除（不可变快照，§15.1）。
- **为什么不做"关系边硬删"**：`app_rw` 无法 DELETE，加 DELETE 授权等于在 RLS 上开一个新口子，且被 RESTRICT 外键挡住（`event`/`evidence_link`/`note_link`/`placement_tree` 都会引用位次）。软删让"改错关系"可回退、可解释，与 [ADR 0004](../../decisions/0004-soft-delete-forever.md) 一致。

**7.3 唯一性与软删**

**所有**唯一约束都写成部分唯一索引（`WHERE deleted_at IS NULL`），照 `uk_project_ref`、`uk_lineage_name`。禁止用 `UNIQUE` 直接压在可软删行上——否则删掉的记录会挡住重建。`era`（无软删）与 `book_snapshot`（不可变）除外。

**7.4 RLS 模板**

每张组织级表三条 policy（照 `lib/db/migrations/0001_auth_rls.sql` 现有形态）：

```sql
alter table <t> enable row level security;
alter table <t> force row level security;
create policy <t>_select on <t> for select to app_rw
  using (auth.has_org_role(organization_id, array['owner','admin','editor','viewer']));
create policy <t>_insert on <t> for insert to app_rw
  with check (auth.has_org_role(organization_id, array['owner','admin','editor']));
create policy <t>_update on <t> for update to app_rw
  using (auth.has_org_role(organization_id, array['owner','admin','editor']))
  with check (auth.has_org_role(organization_id, array['owner','admin','editor']));
```

- `ENABLE` + `FORCE` 两个都要（附件只写了 `ENABLE`，见评审 P1）。
- 不建 DELETE policy，也不授 DELETE 权限。唯一例外是 `placement_tree`（整树重算需要清空重插），它走 [ADR 0014](../../decisions/README.md) 记录的最小授权，**且只授这一张表**。
- 每张表必须有 RLS 集成测试：跨组织读、跨组织写、viewer 写，三条路径各一个用例。

**7.5 租户列不可变（P0，先于任何新表）**

`withOrg` 事务里 `app_rw` 有 UPDATE 权限，RLS 的 `WITH CHECK` 只看新值——**同时可写两个组织的用户能把行搬走**。本仓库当前就中招（`project`、`lineage`、`node` 全部可被 `UPDATE ... SET organization_id`）。修法：`BEFORE UPDATE` 触发器 `app.forbid_tenant_move()`，`organization_id`（以及 `project_id`、`lineage_id` 这类归属列）变更即 `RAISE EXCEPTION`。列入 P0，先于一切新表。

**7.6 枚举**

一律 `varchar` + `CHECK (col IN (...))`，不用 PostgreSQL `ENUM` 类型（值变更要 `ALTER TYPE`，Drizzle 支持差、回滚难）。TS 侧用 `$type<Union>()`，枚举值定义在 `lib/genealogy/constants.ts`，与 CHECK 一一对应，由集成测试比对（照 `tests/integration/constraints.test.ts` 现有做法）。

**7.7 jsonb 纪律**

- 只放三类：**原文**（`date_original`、`gedcom` 原始行）、**结构未定**（`article.content` 的 ProseMirror JSON、`book.cover_spec`）、**不可变快照**（`book_snapshot.payload`、`person_merge_log.before_data`）。
- 不进 `WHERE`、不进 `ORDER BY`、不进唯一约束。需要过滤或排序的字段必须提成列（`date_cn` 里的年号与年要同时提成 `date_start`/`date_end` 就是这个道理）。
- 唯一例外：`article.plain_text` 已经是提列后的结果，`pg_trgm` 索引建在它上面（ADR 0011）。

**7.8 索引纪律**

- 每张表的索引先写"查询场景清单"，再定索引，不许凭直觉加。清单写进实现计划，评审时对照。
- 复合索引一律 `organization_id` 打头（`idx_<table>_organization_*`）。附件在 `person_name.search_text` 上违反了它自己写的这条规则（评审 P1），不照抄。
- 每条复合外键在**子侧**必须有索引，否则删父行要全表扫（附件约 12 条缺，评审 P1）。
- 低基数列（`living_status`、`sex`）不单独建索引。
- 唯一索引优先表达不变量；性能索引单独命名并注明服务哪个查询。

**7.9 并发**

[ADR 0002](../../decisions/0002-no-edit-lock.md) 决定不做编辑锁、接受 last-write-wins，本蓝图不改这条。但**结构不变量**必须防并发：`family_partner` / `family_child` 的"同一 family 至少一个血亲侧"、"一个接入点只能一个人"这类检查，写入前先 `pg_advisory_xact_lock(hashtextextended(organization_id::text || family_id::text, 0))`，再检查再写。附件用"先查后插"的触发器，两个并发事务能同时通过（评审 P1）。

**7.10 迁移与 DDL 纪律**

- 全部 DDL 幂等：`CREATE TABLE IF NOT EXISTS`、`DROP POLICY IF EXISTS` 后 `CREATE POLICY`、`CREATE OR REPLACE FUNCTION`。附件有 5 处 `DO` 块不幂等（评审 P2）。
- 回填不写进迁移，进 `data/` 下的可重复脚本（AGENTS.md §7 规则 9）。
- 手写迁移（RLS、触发器、排他弧 CHECK、`UNIQUE NULLS NOT DISTINCT`）追加 `lib/db/migrations/meta/_journal.json` 条目，不生成 snapshot（照 `0013`、`0014` 的做法）。

**7.11 模块与文件**

- `lib/db/schema.ts`（688 行，卡在 F6 豁免上限）**第一步就拆**成 `lib/db/schema/<domain>.ts`：`auth.ts`、`org.ts`、`project.ts`、`person.ts`、`family.ts`、`placement.ts`、`event.ts`、`evidence.ts`、`media.ts`、`gedcom.ts`、`book.ts`、`governance.ts`，每个 ≤400 行，`lib/db/schema/index.ts` 汇总再导出（`drizzle.config.ts` 的 `schema` 改成目录）。
- 查询按域拆：`lib/db/queries/persons.ts`、`families.ts`、`placements.ts`、`events.ts`、`evidence.ts`、`gedcom.ts`，每个 ≤400 行。
- 领域常量与枚举：`lib/genealogy/constants.ts`（值）+ `lib/genealogy/schemas.ts`（Zod）。
- 新增约 30 张表分 9 期落地，**每期 ≤6 张新表**，保证单期可评审、可回滚。

**7.12 时间与日期**

`timestamptz` 存时刻（`created_at` 等）；历史日期不存 `date` 而存 `date_start`/`date_end` 区间 + 精度（§11.4），因为"康熙三十八年"不是一个 `date`。

## 8. 身份层（organization / project / lineage / lineage_branch）

现状 `organization`（`lib/db/schema.ts:57`）、`project`（`:215`）、`lineage`（`:290`）基本可用，只做三处调整。

**8.1 层级重新说清**

- `organization` = 租户，RLS 根。一次订阅、一组成员、一套角色（`owner`/`admin`/`editor`/`viewer`）。
- `project` = 一个修谱项目，对应一部谱书。20 位 `ref` 是 URL 第二段。**外部附件的 `genealogy` 就是它**，附件 `L3` 写"产品文案称项目，实现层对应租户表 organization"在本仓库是错的（评审 §7 X1）。
- `lineage` = 一部谱系（一个 GEDCOM 文件）。现有 `uk_lineage_name` 是 `(organization_id, project_id, name)`，保持。
- `lineage_branch` = 房支，新增。**为什么要有**：派语（字辈）按房不同、谱书目录按房分卷、兼祧按房判定、位次排序按房。现有 `lineage.generation_words` 只有一个数组，表达不了"长房用这套、二房用那套"。

**8.2 改动清单**

| 表 | 改动 | 理由 |
|---|---|---|
| `project` | 加 `allow_consanguineous_marriage boolean not null default false`（P1，与 `family_partner` 触发器同批）、`default_calendar text not null default 'gregorian'`（P4，与 `era` 同批） | 族内婚（堂兄妹）在旧谱里存在，A1 的硬规则会把它挡在门外；默认仍拒绝，谱系级可放开 |
| `lineage` | `generation_words jsonb` 迁到 `generation_poem`；`node_count` 改名 `person_count`，语义重定义为 **`count(*) from person_placement where lineage_id = ? and deleted_at is null`（入谱人数，含配偶位次）** | `node` 退役后 `node_count` 是误导名；配偶也入谱，必须计数，否则画布与列表的人数对不上（现有 `lib/lineage/node-services.ts:292` 就按 +2 计配偶） |
| `lineage_branch` | 新建 | 见上 |

**8.3 `lineage_branch`**

`id`、`organization_id`、`project_id`、`lineage_id`、`parent_branch_id`（自引用，三列复合外键保证同谱）、`name`、`founder_placement_id`（**可空，P0 期先不加，等位次层落地后补**，避免层间反向依赖）、`sort`、`notes`、审计列。

唯一：`UNIQUE (organization_id, lineage_id, name) WHERE deleted_at IS NULL`。

**8.4 `generation_poem`**

`id`、`organization_id`、`project_id`、`lineage_id`、`branch_id`（可空 = 全谱通用）、`name`、`words text[] not null`、`notes jsonb`（按位置的改字/避讳说明）、`sort`、审计列。

**为什么不建 `generation_poem_item` 表**（附件有）：字辈是 20–40 个字的定长序列，只按位置取用，不需要独立更新行。一张表 + 一个数组，少一张表、少一次 join，改字说明放 `notes jsonb` 足够。等出现"某个字辈字要独立挂史料"的真实需求再拆（§24）。

## 9. 事实层（person / person_name / family / family_partner / family_child）

这是全蓝图的承重层，也是与 A1 spec 分歧最大的一层。

**9.1 `person` 归 `project`，不归 `lineage`（推翻 A1 §2 决策 2）**

```text
person(id, organization_id, project_id not null, sex, living_status, living_status_locked,
       privacy_level, name_status, merged_into_id, sort_key, legacy_node_id, 审计列)
```

- **理由一（联宗）**：同一个 project 下常有多个 `lineage`（支谱合修、外迁支、联宗谱）。人若归谱系，跨谱出现只能复制成两条记录，之后合并极难。
- **理由二（兼祧跨房）**：兼祧是"同一人占据两个父系位置"。位次若只能挂在 `person` 上（A1 的 `person_tree(person_id PK)`），一人只能有一个世代、一条路径——而承嗣给低两辈的叔祖，两个位置的世代本来就不同。
- **理由三（代价可控）**：`organization_id` 仍是根，RLS 不变；查询多一次 join（`lineage_person` 类表），画布本来就是全量载入（ADR 0011）。
- **代价（诚实写）**：A1 spec 与 A2.1 计划里凡以 `person.lineage_id` 为前提的段落都要改；`node → person` 迁移要先按 lineage 建位次，再合并同 project 内的重复人。**合并是可选的**：P1 迁移允许"同一个人在不同 lineage 各有一条 person"，位次层建好后再提供合并工具（`person_merge_log`）。

`person` 字段：`sex`（`male|female|other|unknown`，A1 只放开数据库约束、UI 仍男/女，照 A1 §2 决策 4）、`living_status`（`living|deceased|unknown`）、`privacy_level`（§17）、`name_status`（`known|unknown|partial`——**失考可表达**，附件做不到，因为它的 `full_name NOT NULL`）、`merged_into_id`（自引用，`ON DELETE SET NULL`）、`sort_key text`（可空，人工指定的列表排序键；不填则按主名排序。存在的理由：旧谱的"房-支-行"顺序无法从关系推导，且不能复用 `person_placement.sort`——那是谱内位次顺序，跨谱系不通用）。

**9.2 姓名全部进 `person_name`，`person` 不存姓名**

```text
person_name(id, organization_id, project_id, person_id, name_type, custom_type, full_name, surname,
            given_name, name_prefix, name_suffix, surname_prefix, nickname, pinyin, romanized,
            language, sort_order, 审计列)
person.primary_name_id  → person_name(id)  [可空；复合外键 person(organization_id, id, primary_name_id)
                                            → person_name(organization_id, person_id, id)，保证主名属于本人]
```

- **为什么不在 `person` 上留 `surname`/`full_name`**：中文宗族一个人有谱名、讳、字、号、乳名、学名、官名、法名，附件列了 11 种 `name_type`。单一 `full_name` 必然不够；而"`person.full_name` + `person_name`"两处真源会长期不一致。
- **主名只有一个真源**：`person.primary_name_id` 单向指定，`person_name` 上不放 `is_primary` 布尔（附件放了布尔，等于两处真源，且部分唯一索引不可 `DEFERRABLE`，换主名会撞约束——评审 P1）。
- **读路径代价**：列表、画布、检查器都要 join `person_name`。可接受（每页 ≤ 数百行），且避免一致性风险。
- `full_name` 可空 + `person.name_status` 表达"名讳失考"；UI 显示"失考"而不是空字符串。
- 姓名**不建 trgm 索引**（ADR 0011）：人丁搜索在客户端做，服务端只保证列表查询走 `(organization_id, project_id)`。

**9.3 `family` + `family_partner`（取代 A1 的 `husband_id`/`wife_id`）**

```text
family(id, organization_id, project_id, union_type, sort, notes, 审计列)
family_partner(id, organization_id, project_id, family_id, person_id, role, partner_order, status, 审计列)
family_child(id, organization_id, project_id, family_id, person_id, parentage_type, is_primary, sort, 审计列)
```

- **`family` 不带 `lineage_id`**：婚配关系是 project 级的。带 `lineage_id` 会立刻自相矛盾——联宗、跨支婚姻（§9.1 里"person 归 project"的理由）中两个配偶的位次分属不同 `lineage`，任何取值都是错的。要知道"这桩婚事属于哪一房"，从 partner 的位次推（`person_placement`），不从 `family` 存。
- 同理，`person_placement.family_child_id` 指向的 `family_child` 可以属于另一个 `lineage`（跨支过继），**不做结构约束**，由检查器报 `info: cross_lineage_succession` 提示复核。

- **为什么不用两列**：一夫多妻 / 继室 / 童养媳 / 未知性别 / 同性伴侣，两列 `husband_id`/`wife_id` 全表达不了；且"谁是血亲侧"是**婚配关系**的属性，不是人的属性（A1 把它放 `person.role`，入赘者的子女是血亲、入赘者本人是配偶，同一个人在不同 family 里角色不同，person 级存储会自相矛盾）。
- `family_partner.role`：`blood|spouse`（本族血亲侧 / 姻亲侧）。
- `family_partner.status`：`current|divorced|widowed|separated|unknown`（对应 GEDCOM `FAMS.STAT`，附件缺这一列，评审 §7 M2）。
- `family_partner.partner_order`：先后次序，一夫多妻的"元配/继配/侧室"由此表达。
- 不变量（触发器 + advisory lock，§7.9）：当 `project.allow_consanguineous_marriage = false`（默认）时，**每个 `family` 至多一个 `role='blood'` 的 partner**；置 `true` 时放开，用于族内婚（堂兄妹婚）真实存在的旧谱。A1 的"恰好一个"在旧谱里太硬（评审 §7 C5）。
- **"至少一个"无法在 DDL 里强制**（先插 spouse 后插 blood 是合法中间态），由检查器（`validation_issue`，P9）报 `error: family_without_blood_partner`。触发器只管上界——这一点必须写在实现注释里，否则后人会以为漏了约束。
- `family_child.parentage_type`：`birth|adoptive|foster|step|traditional|unknown`（A1 正确，照抄）。`is_primary` 标记"主要归属"，用于"过继后归宗"的渲染选择。
- **兼祧在这里天然可表达**：同一个人可以在多个 `family` 下各有一条 `family_child`（A1 的 `UNIQUE (organization_id, family_id, person_id)` 已允许），区别只在于**位次层**（§10）要给出两个位置。

**9.4 删除与软删**

全部软删（§7.2 无例外）。"解除关系"= 置 `deleted_at` + 建正确的新边，不是物理删除——`app_rw` 没有 DELETE 权限，硬删在这个仓库里不是一个可选项。删除门槛照 A1 §2 决策 5：有存活直接子女则拒绝删除 `person`。

**9.5 `person_association`（GEDCOM `ASSO`，附件完全缺失）**

```text
person_association(id, organization_id, person_id, target_person_id, role, notes, 审计列)
```

- `role`：`CHIL|CLERGY|FATH|FRIEND|GODP|HUSB|MOTH|MULTIPLE|OFFICIATOR|PARENT|SPOU|WITN|OTHER`（GEDCOM 7 `ROLE` 枚举）。
- 表达"非婚配、非亲子"的人与人关系：教父、义父、门生、干亲、证婚人、族中代笔。附件把这些塞进 `event_participant`，但 `ASSO` 是**持久关系**不是事件参与（评审 §7 M1）。
- 唯一：`UNIQUE (organization_id, person_id, target_person_id, role) WHERE deleted_at IS NULL`（软删，§7.2）。

## 10. 位次层（中文宗族的一等公民）

**10.1 为什么必须独立成层**

关系（谁是谁的孩子、谁和谁结婚）是 GEDCOM 的形状，全世界通用；位次（他在这一支里排第几、用哪个字辈、承了谁的祧、兼几房）是中文宗族特有的。附件把两者压进一张 `lineage_person` 并加 `UNIQUE (lineage_id, person_id)`——一个人在一个谱系只能有一个位置，**兼祧结构上不可能**（评审 §7 C1，Critical）。A1 把位次压在 `person` 上（`person_tree` 主键是 `person_id`），一人只能有一个世代、一条路径。

本蓝图把位次提成一等公民：

```text
person_placement(id, organization_id, project_id, lineage_id, branch_id,
                 person_id, family_child_id, placement_kind, generation, generation_poem_position,
                 birth_order, birth_order_scope, succession_type, succession_from_placement_id,
                 is_primary, sort, notes, 审计列)
placement_tree(placement_id PK, organization_id, lineage_id, path ltree, depth generated)
```

`placement_kind`：`blood`（血亲位次，`family_child_id` 非空或为始祖）/ `spouse`（配偶位次，`family_child_id` 为空，`generation` 与 `sort` 跟随其配偶）。**配偶也有位次**——否则画布（按 `person_placement WHERE lineage_id` 查）、客户端搜索（ADR 0011 整谱载入）、检查器编辑路径三处都要为"配偶"写一条并行的特殊分支，而现有 `node_count` 是把配偶算进去的。

**10.2 关键不变量**

- `UNIQUE (organization_id, lineage_id, family_child_id) WHERE family_child_id IS NOT NULL AND deleted_at IS NULL` —— **一个接入点只能站一个人**。这是"两兄弟不能同时接在同一个父位上"的结构保证。
- `UNIQUE (organization_id, lineage_id, person_id) WHERE is_primary AND deleted_at IS NULL` —— 一人在一谱只有一个主位次；兼祧的第二个位置 `is_primary = false`。
- `CHECK (placement_kind = 'blood' OR family_child_id IS NULL)` —— 配偶位次不接父子边。
- `person_placement.family_child_id` 用四列复合外键 `(organization_id, project_id, family_child_id, person_id) → family_child(organization_id, project_id, id, person_id)`，保证"位次上的人就是他接的那个孩子"，且不会跨 project 串数据（附件 `L1144` 的同类技巧，本文加上 `project_id`）。
- 根位次（始祖）：`placement_kind='blood'`、`family_child_id IS NULL`、`is_primary = true`。
- 配偶位次：`placement_kind='spouse'`、`family_child_id IS NULL`，`generation`/`sort` 由写入路径按配偶的位次推导（同事务维护，不靠触发器猜）。

**10.3 兼祧 / 一支两祧**

- 兼祧：`person` P 有两条 `family_child`（生父家、嗣父家），两条 `person_placement`（生父房 `is_primary=true`、嗣父房 `is_primary=false`），嗣父房那条 `succession_type='dual_inheritance'`、`succession_from_placement_id` 指向"被承嗣的那个位置"。
- 一支两祧（同一个人承两房、两房都要他的后代）：同一 `person` 两条位次都在 `is_primary=false`？不行——`is_primary` 唯一。改为：`person_placement.is_primary` 表示"显示时作为主归属"，一支两祧时取其一为主，另一条 `succession_type='dual_inheritance'` 且 `notes` 说明。**后代归属**由 `family_child` 决定，不由位次决定，所以两房的香火各自由其子女承接，不冲突。
- `succession_type` 枚举：`birth`（本生）、`adopted_in`（入继/过继而来）、`adopted_out`（出继）、`dual_inheritance`（兼祧）、`uxorilocal`（入赘）、`returned`（归宗）、`unknown`。附件的 4 个值不够（评审 §7 C7）。

**10.4 排行与字辈位次**

- `birth_order smallint` + `birth_order_scope`（`father|family|lineage`）：附件没有排行（`sort_order` 是显示顺序，评审 §7 C2），旧谱里"行三""行五"是硬信息。
- `generation_poem_position smallint`：这个人用派语的第几个字。附件只存了派语，不存"他用了哪个字"（评审 §7 C4）。
- 校验规则（治理层）：`person_name.full_name` 的第二个字（或指定位置）应等于 `generation_poem.words[position]`，不一致报 `info` 级 `validation_issue`（旧谱大量不一致，不能报 `error`）。

**10.5 `placement_tree`**

- 只存渲染需要的 `ltree` 路径与 `depth`，`generation` 在 `person_placement` 上（手填值可能与派生层级不一致，允许不一致，检查器报 warning——照 A1 的 `ck_node_generation_lte_level` 精神）。
- 主键是 `placement_id`，因此一人多位置天然支持。
- **维护方式：增量、同事务。** 写入路径（`lib/db/queries/placements.ts` 的 create/move/delete 助手）在**同一个事务里**更新 `placement_tree`：新增位次 = 插入一行路径；移动 = 删子树 + 重插（`ltree` 子树移动用 `path` 前缀替换）；软删位次 = 删对应行。**不靠触发器、不靠定时任务**（ADR 0005 无后台任务）。
- 子树移动需要 DELETE 权限——这是全库唯一的 DELETE 例外，走 ADR 0014，**范围限死 `placement_tree`**。
- 重建脚本：`data/rebuild-placement-tree.ts`，可重复执行、幂等，用于修复而非日常路径（P2 验收：先人为破坏，再重建，结果与增量维护一致）。
- 单次移动的代价：一个子树的行数级 DELETE + INSERT，修谱场景下一次移动几十行，可接受；若实测超时，退化为"标记待重建 + 下次读时懒重建"，那时再决策。

**10.6 与画布/世系表的关系（行身份从"人"变成"位次"）**

现有画布按 `lineage` 渲染、按 `generation` 分列、按 `sort` 排序、`spouse_of_id` 挂配偶列。迁移后：查 `person_placement WHERE lineage_id = ? AND deleted_at IS NULL` join `person`、`person_name`、`family_partner`（配偶列）、`placement_tree`（父子连线）。

**`NodeView.id` 必须是 `placement_id`，并新增 `personId`。** 这条不能含糊：

- `id`/`parentId`/`role`/`sort`/`generation` 是**位次**属性，`name`/`sex`/生卒是**人**属性。若 `id` 仍表示"人"，兼祧者（同谱两个位次）在画布上只能出现一次，§3 的"位次与承嗣必须可见"直接失败。
- 因此兼祧者在画布上是**两张卡片**（两房各一张，不同世代、同名）。这是正确的领域语义，不是重复渲染。
- 前端适配点（P2 必做，不是可选项）：所有 Action 的入参从"节点 id"改成"位次 id"，需要改人的属性时先 `placement → person`；`components/lineage/types.ts` 的 `NodeView` 加 `personId`；拖拽/移动按位次 id 处理。
- 字段名保持不变（A1 §14 的遗留要求），但**行的语义变了**，所以"前端组件不用改"这句话只在字段名层面成立，在行为层面要改。这是本文对 §24 承诺的修正。

## 11. 时间与事件层（event / event_participant / place / place_name / era）

**11.1 `event` 的主体三选一（修正附件与 A2.1 计划）**

```text
event(id, organization_id, project_id,
      person_id, family_id, placement_id,          -- 恰好一个非空
      subject_type generated always as (...),      -- 'person'|'family'|'placement'，供索引与 UI 分派
      event_kind, event_type, custom_type, gedcom_tag,
      title, value, description,
      date_original, date_start, date_end, date_precision, date_qualifier, calendar, date_cn,
      age_text, age_years, age_basis, place_id, place_original, 审计列)
CHECK (num_nonnulls(person_id, family_id, placement_id) = 1)
```

- **为什么三选一**：附件用 `event_scope` + `family_id`，允许"个人事件却带 `family_id`"或"零主体"（`L477` 允许 `family_id` 为空，`uq_event_principal` 只限制上界）——事件可以没有任何主体（评审 P1）。A2.1 计划里的二选一（`person|family`）漏了第三类：**入继、出继、归宗、迁籍是位次事件**，它们有日期、有证据、要进时间线，塞进 `person_placement` 的字段会失去史料链接能力。
- `subject_type` 用生成列，让 `idx_event_subject (organization_id, subject_type, person_id, date_start)` 这类索引可建，也让 UI 分派不用写三份判断。
- `event_type` 用**开放枚举**：标准 GEDCOM 7 标签 + 中文宗族事件（`succession`、`ancestral_hall`、`genealogy_compiled`、`name_change`、`posthumous_title`）。附件用 26 值闭集，把 16 个标准标签逼进 `custom`（评审 §7 M1）。闭集由 `lib/genealogy/constants.ts` 维护，加值 = 一次迁移。
- 删除 `event_participant` 的 `principal` 角色：主体已由 `person_id`/`family_id`/`placement_id` 表达，`principal` 是能说谎的重复表达。

```text
event_participant(id, organization_id, event_id, person_id, role, custom_role, sort)
role: witness|officiant|godparent|relative|neighbor|scribe|matchmaker|other
UNIQUE (organization_id, event_id, person_id, role)
```

- 附件在这里用自造的 `principal|witness|godparent|officiant|relative|neighbor|other` 枚举，与 GEDCOM `ASSO.ROLE` 的 13 个值毫无关系（评审 §7 M1）；真正的 `ASSO` 关系由 §9.5 的 `person_association` 承担，`event_participant` 只管"这次事件里谁在场、干什么"。
- 主体本人**不进** `event_participant`（附件 `L515` 有这条文字规则但没有任何约束，靠人记）。

**11.2 日期语义（把"before 1691 有两种合法编码"这个洞关掉）**

七列：`date_original`（原文，必填）、`date_start`、`date_end`（`date` 类型）、`date_precision`、`date_qualifier`、`calendar`、`date_cn`（农历原文结构）。

| `date_qualifier` | `date_start` | `date_end` | 语义 |
|---|:--:|:--:|---|
| `exact` / `about` / `estimated` / `calculated` | 必填 | 必填 | 单点或区间，`start <= end`；精度由 `date_precision` 表达 |
| `before` | 必须为空 | 必填 | "不晚于"：`end` 是上界 |
| `after` | 必填 | 必须为空 | "不早于"：`start` 是下界 |
| `between` / `period` | 必填 | 必填 | 明确区间 |
| `unknown` | 必须为空 | 必须为空 | 只有原文 |

五条 CHECK 各自成文，附件的 `date_qualifier` 完全没有约束（评审 P1）。`date_precision`（`day|month|year|decade|century`）只管**展示粒度**，不参与边界推导——两件事分开，才不会出现"精确到年但 `date_end` 为空"的歧义。

**11.3 农历：存原文，换算成区间**

- `date_cn jsonb`：`{ era: 'kangxi', year: 38, month: 3, leap: false, day: 12, ganzhi: '己卯', shichen: '辰时', raw: '康熙三十八年三月十二日辰时' }`。
- `era` 表：`code`（`kangxi`）、`name`（`康熙`）、`dynasty`、`start_date`、`end_date`、`notes`。用于把年号 + 年 解析成公历年份区间。**它没有 `organization_id`**——年号是公共知识，由迁移 seed，`app_rw` 只授 `SELECT`，无 RLS（§7.1 的唯一例外）。
- **换算在应用层**（`lib/genealogy/date.ts`），结果写进 `date_start`/`date_end` 的**区间**，并把 `date_precision` 设为 `year` 或更粗。理由：农历↔公历不是单值映射（闰月、年末跨年、干支 60 年循环无年号则不可解），强行存单点会制造假精度（评审 §7 C8）。
- **不做**：自动推断缺失年号、跨朝代干支消歧、闰月精确换算到日。这些留给将来的日期解析器，蓝图只保证**原文不丢、区间可表达**。

**11.4 `place` / `place_name`**

- `place(id, organization_id, project_id, parent_place_id, name, place_type, latitude, longitude, description, 审计列)`，`place_type`：`country|province|prefecture|county|town|village|hamlet|other`。自引用用三列复合外键保证同 project。
- `place_name(id, organization_id, place_id, name, name_type, language, period_text, valid_from, valid_to, sort_order, 审计列)`：`name_type`：`current|historical|alias`。**必须有 `UNIQUE (organization_id, id)`**（附件缺，评审 §7 X5）。
- **`place_jurisdiction` 数组**：GEDCOM 的 `PLAC.FORM` 是"省/市/县"的层级顺序声明，不同文件顺序不同。蓝图在 `place_name` 上加 `jurisdiction_path text[]`（从粗到细的地名数组），导出时按 `gedcom_file.place_form` 重排。附件缺这个（评审 §7 M5），导致跨文件导入后地名层级会错位。
- 历史地名与现地名分离：`place.name` 是当前名，`place_name` 存历史名与别名。**不在 `place` 上放 `valid_from/valid_to`**——那是名字的属性，不是地点的属性。

## 12. 证据层（source / citation / evidence_link / repository / submitter）

**12.1 结构**

```text
source(id, organization_id, project_id, title, author, source_type, publication_info,
       external_url, description, 审计列)
citation(id, organization_id, project_id, source_id, page, volume, section,
         citation_text, data_text, quality smallint 0..3, researcher_confidence, 审计列)
evidence_link(id, organization_id, citation_id, evidence_role,
              person_id, person_name_id, family_id, family_partner_id, family_child_id,
              placement_id, event_id, place_id)      -- 恰好一个目标非空
repository(id, organization_id, project_id, name, address_text, phone, email, website, 审计列)
source_repository(source_id, repository_id, call_number, media_type)   -- 联合主键
submitter(id, organization_id, project_id, name, email, phone, address_text, language, 审计列)
```

- `evidence_link` 是**排他弧**：`CHECK (num_nonnulls(...) = 1)` + `UNIQUE NULLS NOT DISTINCT (organization_id, citation_id, evidence_role, 八个目标列)`。附件用 9 列唯一 + 9 个部分索引，每行索引开销约 150B（评审 P1）；本文改成 `COALESCE` 表达式唯一索引 `(organization_id, citation_id, evidence_role, coalesce(person_id, person_name_id, ..., place_id))`，索引项从 9 列降到 4 列。
- `evidence_role`：`supports|contradicts|mentions|uncertain`。**`contradicts` 是这套设计的价值所在**：不自动改事实，而是让检查器能问"这条生卒年有反对证据吗"。
- `quality`（GEDCOM `QUAY` 0–3）与 `researcher_confidence`（`low|medium|high`）都保留，是两个不同维度：来源质量 vs 研究者判断。

**12.2 结构化地址**

`repository` / `submitter` 上的 `address_text` 是扁平文本（附件也是扁平的，评审 §7 M3）。蓝图加 `address jsonb`：`{line1, line2, city, state, postal, country}`，导出时拼成 GEDCOM `ADDR` 子结构（`ADR1`/`ADR2`/`CITY`/`STAE`/`POST`/`CTRY`），导入时拆回来。`address_text` 保留为原文。

**12.3 不建的表**

- 不建 `citation_data`（附件的 `citation.data_text` 够用）。
- 不建 `source_repository` 之外的关联表。
- `submitter` 保留但**不用它做权限**：附件的 `SUBM` 是 GEDCOM 概念（谁提交了这个文件），不是系统用户。导出时从 `gedcom_file.submitter_id` 取，不从当前登录用户取（附件导出用当前用户，评审 §7 M7）。

**12.4 方案三被排除的代价（必须写清楚）**

事实存列 + 证据存链接，意味着：

- 同一事实的两个矛盾来源**都能记录**，但系统不会自动裁决，也不会给出"置信度排序后的值"。用户看到的是列上的当前值 + 若干条证据链接。
- 想换当前值必须人工改列，并留下 `evidence_role='contradicts'` 的记录。
- 冲突可视化靠治理层的 `validation_issue`（`issue_code='evidence_contradiction'`）与检查器面板。

这是有意的取舍：换来了查询与写路径简单、UI 不用重建（§5 方案三的反面）。

## 13. 媒体层（media / media_file / media_link）

```text
media(id, organization_id, project_id, title, media_type, description, 审计列)
media_file(id, organization_id, media_id, storage_key, mime_type, byte_size, sha256,
           width, height, duration_ms, is_original, sort, 审计列)
media_link(id, organization_id, media_id, media_role,
           person_id, person_name_id, family_id, event_id, place_id,
           source_id, citation_id, placement_id)      -- 排他弧
```

- `media` = 逻辑资产（一张照片、一份扫描件），`media_file` = 物理文件（原图 + 可能的多版本）。分开的理由：同一张照片可能有原片与压缩片，GEDCOM 的 `OBJE.FILE` 允许多个文件。
- `media_link` 排他弧 8 目标，同 §12.1 的 `COALESCE` 唯一索引策略。
- **存储契约不绑厂商**：`storage_key` 是相对路径（`org/<org_id>/project/<project_id>/<sha256 前两位>/<sha256>`），由 `lib/storage/` 适配（本地 `/public/uploads` 或对象存储）。选型另写 ADR 0021（[ADR 0009](../../decisions/0009-dependency-and-runtime-stance.md) 要求依赖只减不增，Supabase Storage 这类新依赖必须单独决策）。
- **无缩略图流水线**（ADR 0005）：列表用 Next `<Image>` 按需转码；`media_file` 允许存一张 `is_original=false` 的预生成缩略图，但生成发生在**上传请求内**（同步、单文件、有体积上限）。
- `sha256 char(64)` 而非 `bytea`（附件用 `char(64)` 是对的，但要 `CHECK (sha256 ~ '^[0-9a-f]{64}$')` 防空白填充，评审 P2）。

## 14. GEDCOM 适配层（gedcom_file / gedcom_record / gedcom_map / gedcom_extension / external_id）

**14.1 结构**

```text
gedcom_file(id, organization_id, project_id, direction, gedcom_version, charset,
            raw_storage_key, sha256, byte_size, record_count, status,
            place_form text[], submitter_id, loss_report jsonb, 审计列)
gedcom_record(id, organization_id, gedcom_file_id, line_no, level, xref_id, tag, value, raw_line)
gedcom_map(id, organization_id, gedcom_record_id, entity_type, entity_id)
gedcom_extension(id, organization_id, gedcom_file_id, gedcom_tag, payload jsonb, note)
external_id(id, organization_id, project_id, entity_type, entity_id, scheme, external_value)
```

- `gedcom_record` 保存**每一行的原文**（含 `raw_line`），这是保真等级 L0 的基础：任何"我们没映射的标签"都能从原文回放，不丢。
- `gedcom_map` 记录"这条原始行映射到了哪个业务实体"，多对多（一行可映射多个实体，一个实体可由多行拼成）。
- `gedcom_extension` 收**无法映射到列但语义已知**的标签（`_CUSTOM` 一类）。
- `external_id`：`scheme` 枚举 `gedcom|gramps|familysearch|other`，`UNIQUE (organization_id, scheme, external_value) WHERE deleted_at IS NULL`。这是"同一人在两部谱/两个系统里"的唯一关联手段（§3 非目标）。

**14.2 保真等级（附件声称"保真等级见第 6 章"，但第 6 章不存在）**

| 等级 | 含义 | 由什么保证 |
|---|---|---|
| L0 原文可回放 | 导入文件的每一行都能原样导出 | `gedcom_record.raw_line` + `gedcom_file.raw_storage_key` |
| L1 标准标签全映射 | GEDCOM 7 标准结构（INDI/FAM/EVEN/PLAC/SOUR/OBJE/NOTE/ASSO/ADDR/REFN/CHAN）全部有列或表 | §9–§13 + `person_association`（见 14.3） |
| L2 有损并申报 | 无法表达的语义进 `gedcom_file.loss_report jsonb`，导出时声明 | 导出前对比 `gedcom_map` 覆盖率 |

**14.3 必须补的三处（评审 §7 M1–M3）**

- **`person_association`**（GEDCOM `ASSO` + `ROLE`）：`person_id`、`target_person_id`、`role`（`CHIL|CLERGY|FATH|FRIEND|GODP|HUSB|MOTH|MULTIPLE|OFFICIATOR|PARENT|SPOU|WITN|OTHER`）、`notes`。附件把 `ASSO` 丢了，用自造的角色枚举塞进 `event_participant`——教父、证婚人之外的"干亲、门生、义子"关系无处可放。
- **`ALIA`**：别名指向"可能是同一个人"的另一个个体。用 `external_id` + `person_merge_log` 表达（不建 `alia` 表）：`ALIA` 导入为 `external_id(scheme='gedcom', external_value=xref)` 加一条 `validation_issue(issue_code='possible_duplicate')`。
- **`REFN`**：外部参考号，进 `external_id(scheme='gedcom_refn')`。
- `CHAN`（变更时间）：导入时写进 `updated_at` 并在 `gedcom_extension` 留原文；**不建 `chan` 表**。

**14.4 同步导入的上限（ADR 0005 的直接后果）**

没有后台任务，导入必须在请求内完成。Vercel 函数时长上限（默认 60s，Pro 300s）决定了单文件规模上限：

- 同步导入上限按**个体数**计，不按行数：**2000 个 `INDI`**（约 2 万行 `gedcom_record`），超过直接拒绝并提示按支谱拆分。**2000 是待实测的初值**，P8 用真实文件跑出数字后写进 ADR 0020；本条只定"按个体计"这个单位，因为用户理解的上限是"能导多少人"，不是"多少行"。
- 导入过程分三段：解析（纯内存）→ 写 `gedcom_record`（批量 COPY/多值 INSERT）→ 映射到业务表（分批事务，每批 ≤500 条）。
- 失败处理：`gedcom_file.status = 'failed'` + `loss_report` 记原因，已写入的记录保留（软删），用户可以重试。**不做部分成功静默**。

**14.5 导出**

导出 = 从业务表重建 + 未映射内容从 `gedcom_record` 回放：

1. 按 `gedcom_file.direction='import'` 找来源文件，`gedcom_map` 反查每行对应的实体当前值。
2. 有映射且实体仍存在 → 用当前值重建该行（**导出的是当前数据，不是原始文件**）。
3. 有映射但实体已删 → 丢弃并计入 `loss_report`。
4. 无映射 → 从 `raw_line` 原样回放。
5. `place_form` 决定 `PLAC` 的层级顺序；`submitter_id` 决定 `SUBM`。

**"导出的是当前数据"这个语义必须写进 UI**：附件把 `raw_text` 存下来却没有 staleness 标记，用户改了数据再导出会得到旧内容而不自知（评审 §7 M8）。本文用 `gedcom_map` 的实体指向天然解决——只要映射还在，导出就是当前值。

## 15. 呈现层（note / article / book / book_catalog / book_snapshot）

**15.1 保留现有三表，不引入附件的 edition / section / content 三件套**

现状：`article`（`content jsonb` = ProseMirror、`plain_text`、`folder_id`、`kind`）、`book`（`cover_spec`、`volume_no`、`author`）、`book_catalog`（树 + `section 1|2|3` + `article_id`/`lineage_id` 二选一）。

附件的 `genealogy_book` / `book_edition` / `book_section` / `book_content` 四层解决的是"一本书多版、每版多节、每节多段"。本仓库的 `book_catalog` 树 + `article` 正文已经覆盖"目录 + 内容"，**多版**用一张快照表解决，不需要四层：

```text
book_snapshot(id, organization_id, project_id, book_id, label, payload jsonb not null,
              content_sha256 char(64), created_at, created_by)
```

- `payload` 是渲染所需的完整快照（目录树 + 正文 + 封面规格），**不可变**（无 `updated_at`，无 `deleted_at`，只插入）。
- 生成快照是同步的（一本书的 payload 是几百 KB 级），不需要后台任务。
- 附件的 `publication_snapshot` + `book_edition` + `book_section` + `book_content` 四张表换成一张，代价是"不能只改某一版的一节"——这个能力一期不需要（§3 非目标）。

**15.2 `note` / `note_link`**

```text
note(id, organization_id, project_id, title, body, note_type, 审计列)
note_link(id, organization_id, note_id, note_role,
          person_id, person_name_id, family_id, family_child_id, family_partner_id,
          placement_id, event_id, place_id, source_id, citation_id, media_id)   -- 排他弧
```

附件的 `note_link` 只有 7 个目标，漏了 `person_name_id`、`family_child_id`、`family_partner_id`（GEDCOM 的 `NOTE` 可以挂在 `NAME`、`FAMC`、`FAMS` 上，评审 §7 M6）。本文补齐到 11 个目标——排他弧的成本是索引，用 `COALESCE` 表达式唯一索引控制（§12.1）。

**15.3 `render_job` 不进一期**

附件的 `render_job`（PDF 渲染队列）与 [ADR 0005](../../decisions/0005-zero-background-jobs.md)、ADR-16（渲染管线 M3 独立进程）直接冲突。蓝图不建这张表；打印走现有 `print` 视图 + 浏览器打印（已实现）。M3 做排版时再按 ADR-23 的破例条件重新决策。

## 16. 治理层（validation_issue / person_merge_log / activity_logs）

**16.1 `validation_issue`**

```text
validation_issue(id, organization_id, project_id, issue_code, severity, status,
                 subject_type, subject_id, message, related jsonb,
                 detected_at, resolved_at, resolved_by)
UNIQUE (organization_id, issue_code, subject_type, subject_id) WHERE status = 'open'
```

- `issue_code` 是**稳定标识符**（`missing_birth_date`、`generation_poem_mismatch`、`evidence_contradiction`、`possible_duplicate`、`orphan_placement`…），定义在 `lib/validation/rules.ts`，与规则实现一一对应。附件用自由文本 `message` 做键，同一问题每跑一次插一行（评审 P1），本文用 `issue_code` 去重。
- `subject_type` + `subject_id` 是**弱引用**（无外键）：一条问题可能指向已被软删的实体，硬外键会让清理失败。这是有意的例外，写入文档并加索引 `(organization_id, subject_type, subject_id)`。
- 校验在**请求内**跑：打开检查器跑全谱规则，保存后跑局部规则。无后台任务（ADR 0005）。
- `severity`：`error`（数据不可用）/`warning`（可疑）/`info`（提示）。字辈不一致只能是 `info`——旧谱大量不一致。

**16.2 `person_merge_log`**

`id`、`organization_id`、`project_id`、`kept_person_id`、`merged_person_id`、`before_data jsonb`、`merged_at`、`merged_by`、`notes`。

- 外键**必须** `ON DELETE SET NULL` 或允许软删实体：附件用无 `ON DELETE` 的外键，导致清理一个谱系时被历史合并记录挡住（评审 P1）。
- `before_data` 保存被合并方的完整快照（`to_jsonb`），合并可解释、可人工回溯。

**16.3 不建 `change_log`（明确拒绝）**

附件在 9 张表上挂 `app.log_change()` 触发器，写整行 `before_data`/`after_data` 进未分区的 `change_log`，并声称"按月分区"但没有任何分区 DDL，且 `PRIMARY KEY (id)` 让范围分区无法建立（评审 P1、P2）。

本仓库拒绝这条路线，理由三条：

1. **与 ADR 0004 冲突**：软删永存的目的是"不丢用户数据"，而全行审计的代价是**双倍存储 + 双倍写放大**，换来的能力（逐字段回溯）一期没有消费方。
2. **放大不可控**：一行 `person` 的全量 JSON 约 1–2 KB，9 张表 × 每次编辑 × 2 份 = 修谱期的写放大在最坏情况下超过业务数据本身。
3. **有更便宜的替代**：领域内历史表（`person_merge_log`、`book_snapshot`）+ 列级 `created_by`/`updated_at` 已能回答"谁改的、什么时候"，而"改成什么"在谱书场景里靠快照解决。

**重估触发**：出现"必须逐字段回溯某次编辑"的真实客户需求，或需要审计合规（§23）。

**16.4 `activity_logs` 不变**

现有 `activity_logs`（`lib/db/schema.ts:542`）是**产品动态流**，不是审计日志，注释里已写明。保持不动。

## 17. 隐私与在世者（补上附件缺失的第 6 章）

附件 `L90` 与 `L1052` 两处写"见第 6 章""保真等级见第 6 章"，但全文只有 §1–§5——**第 6 章不存在**。而隐私规则恰恰是家谱产品最容易出事的地方（在世者的生卒、住址、照片）。本节补上，细节交 ADR 0018。

**17.1 在世判定**

`person.living_status`：`living|deceased|unknown`，加 `living_status_locked boolean`（人工锁定，不再被推断覆盖）。

推断规则（`lib/genealogy/living.ts`，纯函数、可测）：

1. 有 `event_type='death'` 或 `burial` → `deceased`。
2. 有 `birth` 事件且 `date_start` 早于"当前年 − 110" → `deceased`（推定）。
3. 无生卒信息，但存在已故子女 → `deceased`（推定）。
4. 其余 → `unknown`。**`unknown` 按 `living` 处理**（保守优先）。

**17.2 `privacy_level` 与脱敏矩阵**

`privacy_level`：`public|restricted|private`。默认由 `living_status` 推导（`living`→`private`，`deceased`→`public`），可人工覆盖。

| 字段组 | `public` | `restricted` | `private` |
|---|---|---|---|
| 姓名、世代、位次 | 全文 | 全文 | 全文（谱内必须有） |
| 生卒日期 | 精确 | 仅年份 | 隐藏 |
| 事件地点 | 精确 | 到县 | 隐藏 |
| 传记、notes | 全文 | 全文 | 隐藏 |
| 媒体文件 | 可看 | 可看 | 仅缩略占位 |

**矩阵只作用于"对外视图"**：分享链接、打印视图、`book_snapshot`、将来的公开页。**组织内成员在编辑器里一律看到全量**（任何角色）——否则 owner 改不了在世亲属的生卒日期，编辑功能直接失效。这条边界必须写死，否则实现时会在"哪个 DTO 脱敏"上反复。

- `restricted` 用于"已故但家属要求模糊化"（名人、近代人物）。
- 脱敏在 **DTO 层**（`lib/genealogy/dto/`）统一执行，不在每个查询里手写；RLS 只管租户，不管行内脱敏。对外视图用 `dto/redacted/*`，编辑器用 `dto/edit/*`，两套入口不混用。
- **成员角色不影响脱敏**：`viewer` 与 `owner` 在对外视图上看到同一份结果。理由：谱内成员天然是族人，再按角色分级会让"谁能看奶奶的照片"变成产品决策而不是隐私决策。

**17.3 导出与分享的边界**

- **GEDCOM 导出默认包含全部行（含 `private`）**，与 §3 / §14.2 的"标准标签零丢失"一致：如果导出会静默丢掉所有在世者（§17.1 默认 `unknown → private`），那么"导入一个真实文件再导出"的往返验收就永远不可能通过。
- 隐私由**谁能导出**控制，不由**导出内容裁剪**控制：导出动作需要 `editor` 以上权限 + 二次确认（提示"本次导出含 N 位在世者"）+ 写 `activity_logs`。
- 对外分享（将来的公开页/分享链接）才裁剪 `private` 行，并在分享产物上标注"N 位在世者已隐去"。
- 打印视图与 `book_snapshot`：按**当前操作者的可见集**生成（成员 = 全量）；`book_snapshot.payload` 一旦生成即固化，**不随后续隐私变更回溯**——这是快照语义的必然代价，必须在 UI 上写明。

**17.4 待定（进 ADR 0018）**

在世者的**阈值年龄**（110 岁是行业惯例，需确认）、`restricted` 的判定人（组织 owner 还是谱系创建者）、删除权与软删永存的张力（ADR 0004 的 D-6 仍未决策）。

## 18. 跨层不变量清单（评审时逐条勾）

1. 每张组织级表都有 `organization_id` + 复合键（身份层两列，事实/位次/证据/媒体/适配/治理层带 `project_id` 三列，§7.1）+ 复合外键 + `ENABLE`/`FORCE RLS` + 三条 policy。唯一例外：`era`（无租户，只读）。
2. 没有任何表暴露可 UPDATE 的 `organization_id`/`project_id`/`lineage_id`（§7.5 触发器）。
3. 每条复合外键在子侧都有索引。
4. **所有**表的唯一约束都是部分索引（`WHERE deleted_at IS NULL`），`era` 与 `book_snapshot` 除外（§7.2）。
5. 除 `placement_tree` 外，没有任何表被授予 DELETE（§7.2）。
5. 所有 `CHECK` 枚举值与 `lib/genealogy/constants.ts` 一致（集成测试比对）。
6. 所有排他弧都有 `num_nonnulls(...) = 1` + 表达式唯一索引。
7. 事实层表里没有任何证据层/时间层的 ID 列（§6 规则 2）。
8. 所有派生缓存（`placement_tree`、`book_snapshot`、`before_data`）都有重建脚本。
9. 所有 DDL 幂等；所有迁移只做 DDL。
10. 每张新表至少三条 RLS 集成测试（跨组织读、跨组织写、viewer 写）。

## 19. 迁移与并存（`node` → 新模型）

**19.1 映射**

| `node` 现状 | 迁到 | 说明 |
|---|---|---|
| `role='blood'` 行 | `person` + `person_placement` | 一人一条 `person`，一条位次（`generation` 取 `node.generation`） |
| `role='spouse'` 行（`spouse_of_id` 指向血亲） | `person` + `family` + `family_partner` + `person_placement(placement_kind='spouse')` | 与配偶组成一个 `family`，该人 `family_partner.role='spouse'`；**同时建一条配偶位次**（`generation`/`sort` 跟随配偶），否则配偶会从画布、客户端搜索、检查器里消失（§10.1） |
| `parent_id` | `family_child` + `family` | 见 19.2 的母亲归属问题 |
| `name`/`surname`/`full_name`/`courtesy`/`name_prefix` | `person_name`（主名 + `courtesy` 一条） | `full_name` 进 `person_name.full_name`，`person.primary_name_id` 指向它 |
| `birth_text`/`birth_year` | `event(event_type='birth')` | 原文进 `date_original`，年份进 `date_start`/`date_end`（精度 `year`） |
| `death_text`/`death_year` | `event(event_type='death')` | 同上 |
| `burial_place` | `event(event_type='burial').place_original` | 先存原文，P3 后再归一成 `place_id` |
| `biography` | `note(note_type='biography')` | P9 才建 `note`，**P1 不迁**：`node.biography` 继续是唯一真源，P9 建表时一次性迁入，避免留一个用完就删的过渡列 |
| `sort` | `person_placement.sort` | 保持现有显示顺序 |
| `path`/`depth` | `placement_tree.path`/`depth` | 重建而非复制（路径格式可能变） |
| `generation` | `person_placement.generation` | 手填值，允许与 `placement_tree.depth` 不一致 |
| `deleted_at` | `person.deleted_at` | 软删状态全等 |
| （新增列） | `person.legacy_node_id` | 回填与对账锚点，`UNIQUE (organization_id, project_id, legacy_node_id) WHERE deleted_at IS NULL`，P10 随 `node` 一起删（§19.3） |

**19.2 已知信息损失（必须申报）**

`node` 不记录母亲。迁移规则：

- 血亲节点只有一个配偶 → 其子女挂到 `family(父, 该配偶)`。
- 血亲节点有多个配偶 → 子女挂到 `family(父, null)`，检查器报 `info: unknown_mother`，让用户补。
- 无配偶 → `family(父, null)`。

`loss_report` 写入 `data/migrate-node-to-person.ts` 的输出，数字进验收标准。

**19.3 双读与切换（每期都走同一套）**

每期的切换是**逐列组冻结 `node`**，不是"全表最后一次性冻结"：

1. **迁移 PR**：建表 + 建 RLS + 建触发器（只 DDL）。
2. **回填 PR**：`data/backfill-*.ts` 幂等，只处理"`node` 里有行、新表里还没有对应行"的存量数据（用 `person.legacy_node_id` 判定），不动 `node`。
3. **对账 PR**：`data/reconcile-*.ts` 输出差异报告；差异必须为 0 才进下一步。
4. **读切换 PR**：查询改读新表，`node` 仍在，出问题一个 commit 回退。
5. **写切换 PR**：写路径改新表，**`node` 的对应列组变只读**（P1：姓名/关系；P2：路径/世代/排序；P3：生卒/葬地）。此后 `node` 不再收到这部分新数据。
6. **退役 PR**（仅 P10）：删旧表代码与表。

**冻结之后的语义必须写清**：P1 写切换后新建的人**在 `node` 里没有行**。因此：

- 后续各期的回填只处理存量行（`legacy_node_id IS NOT NULL` 且新表缺行），新数据由新写路径直接写新表——这正是"逐列组冻结"能成立的原因。
- `person.legacy_node_id`（`uuid`，可空，`UNIQUE (organization_id, project_id, legacy_node_id)`）是回填与对账的锚点，P10 随 `node` 一起删。

**19.4 回滚点**

- 读切换后、写切换前：回滚 = 恢复读路径（一个 commit）。
- 写切换之后：回滚 = 恢复读路径 **+ 跑 `data/rollback-node-from-new.ts` 把新表数据反向写回 `node`**（只回填该期列组）。这个脚本是写切换 PR 的交付物之一，不是事后补的。
- **回滚窗口**：到下一期写切换为止。因为下一期起新表成为后续期的事实来源，`node` 的对应列组已经过期；跨期回滚要按逆序逐期回退，不支持跳期。
- P10 退役 `node` 之前，必须有 `data/export-node-snapshot.ts` 产出的全量 JSON 备份，存进对象存储并记录在 `docs/guides/runbooks.md`。

## 20. A1 spec 修订清单（A1 落地时按修订版执行）

| # | A1 原决策 | 修订 | 理由 |
|---|---|---|---|
| 1 | `person.lineage_id NOT NULL`（§2 决策 2） | `person.project_id NOT NULL`，谱系归属改为 `person_placement` | 联宗、跨谱引用、兼祧跨房（§9.1） |
| 2 | `person_tree(person_id PK, path, depth, generation)` | `placement_tree(placement_id PK, …)`，世代移到 `person_placement` | 一人可有多位次、多世代（§10.1） |
| 3 | `person.role blood|spouse` | 移到 `family_partner.role` | 角色是婚配关系的属性，不是人的属性（§9.3） |
| 4 | `family.husband_id` / `wife_id` | `family_partner` 表 + `role`/`partner_order`/`status` | 一夫多妻、继室、童养媳、未知性别（§9.3） |
| 5 | "每个 family 恰好一个 blood 侧" | "至少一个；`allow_consanguineous_marriage=false` 时恰好一个" | 族内婚在旧谱里存在（§8.2、§9.3） |
| 6 | `person.surname/name/full_name NOT NULL` | 姓名全部进 `person_name`，`person.primary_name_id` 单向指定 | 中文多名字场景 + 失考可表达（§9.2） |
| 7 | 生卒扁平列留在 `person` | 迁到 `event`（P1 同期最小版：birth/death/burial） | 事件层是 A2 的核心，扁平列是临时形态（§11） |
| 8 | `family_child` 定义 | **不变，照抄** | A1 这一层是对的 |

A2.1 计划（`2026-10-29-a2-lifespan-layer.md`）的任务边界相应调整：Task 2 的 `person_name` 前置到 P1，Task 4 的 `event` 主体从二选一改为三选一，日期 CHECK 矩阵采用 §11.2。

## 21. 分段落地

| 期 | 主题 | 新增表 | 迁移内容 | 验收 |
|---|---|---|---|---|
| **P0** | 地基 | 0 | `lib/db/schema.ts` 拆目录；`app.forbid_tenant_move()` 触发器；RLS 模板核对；`placement_tree` DELETE 授权 ADR 0014 | 拆目录后 `pnpm arch:check` 通过；跨组织搬行被拒（集成测试） |
| **P1** | 事实层 + 事件最小 | `person`、`person_name`、`family`、`family_partner`、`family_child`、`event`（6） | `node` 姓名 + 关系 + 软删 + 生卒葬（生卒葬进 `event`；`event.place_id` 列在 P3 才加，避免与 P3 的 `place` 表顺序冲突） | 人数、父子、配偶、生卒原文、软删全等；`loss_report` 只有已知的母亲缺失 |
| **P2** | 位次层 | `person_placement`、`placement_tree`、`lineage_branch`（3） | `node` 的树、世代、排序、配偶位次（`placement_kind`） | `placement_tree` 增量维护与重建结果一致；画布/世系表读新表照常；兼祧两张卡片 |
| **P3** | 地点层 | `place`、`event.place_id` 回填（1） | `node.burial_place` 原文归一成 `place` | 地名归一后原文不丢；`place_id` 可空 |
| **P4** | 时间层全量 | `place_name`、`era`、`event_participant`（3） | — | 农历原文 + 区间换算可测；证人/主婚可录 |
| **P5** | 证据层 | `source`、`citation`、`evidence_link`、`repository`、`source_repository`、`submitter`（6） | — | 一条生卒可挂 3 条来源；`contradicts` 能被检查器报出 |
| **P6** | 宗族增强 | `generation_poem`、`person_association`（2） | `lineage.generation_words` 迁入 | 按房派语 + 字辈位次校验 |
| **P7** | 媒体层 | `media`、`media_file`、`media_link`（3） | — | 上传/删除/权限三条路径；无后台任务 |
| **P8** | GEDCOM 适配 | `gedcom_file`、`gedcom_record`、`gedcom_map`、`gedcom_extension`、`external_id`（5） | — | 导入→导出往返，标准标签零丢失（含在世者）；同步导入的**个体数**上限有实测数字 |
| **P9** | 呈现与治理 | `note`、`note_link`、`book_snapshot`、`validation_issue`、`person_merge_log`（5） | `person.legacy_biography` → `note` | 快照不可变；问题去重键生效 |
| **P10** | 退役 `node` | 删 1 | 含 `lineage.node_count` → `person_count` 改名 | 全量 JSON 备份完成；`node` 相关代码零引用 |

合计新增 34 张表，终态约 44 张（现有 10 张保留）。每期 ≤6 张新表，单期可评审、可回滚。

**期与期的依赖**：P0 硬前置（不拆 schema 加不了表）；P1 → P2 → P3 严格顺序；P4–P9 之间除 P5 依赖 P3（事件要挂来源）外可以并行；P10 必须最后。

## 22. 需要新增的 ADR

| ADR | 主题 | 为什么值得单独写 |
|---|---|---|
| 0014 | 位次层与兼祧：`person_placement` + `placement_tree`，及全库唯一的 DELETE 授权 | 推翻 ADR 0003 的严格父系；DELETE 例外是安全边界上的破口，必须写清范围 |
| 0015 | 事件主体三选一 + 日期边界语义（`date_qualifier` 矩阵） | "before 1691 有两种合法编码"这类歧义会长期污染数据，需要一张表钉死 |
| 0016 | 租户列不可变（`app.forbid_tenant_move()`） | 本仓库现存的真实越权路径（§7.5），必须留档 |
| 0017 | 会话身份信任边界：`app.user_id` / `app.purge` 这类 GUC 的可信度 | 附件用可写占位 GUC 做 RLS 身份，任何连接都能伪造（评审 P0） |
| 0018 | 在世者隐私：判定阈值、脱敏矩阵、导出边界 | 补上附件缺失的第 6 章；与 ADR 0004（软删永存）有张力 |
| 0019 | 审计取舍：不建 `change_log`，用领域历史表替代 | 明确拒绝一个看起来"更安全"的方案，需写清代价与重估触发 |
| 0020 | GEDCOM 保真等级与同步导入上限 | ADR 0005 的直接后果；上限按**个体数**计，初值 2000 需实测背书 |
| 0021 | 媒体存储契约（`storage_key` 约定 + 适配层） | ADR 0009 要求依赖只减不增，引入对象存储必须单独决策 |
| 0022 | 证据层取舍：为什么不做断言模型 | 方案三被排除，但会被反复提起，需要留档理由与重估触发 |

## 23. 留给 builder 的（这份文档刻意不决定）

- **具体 DDL**：列类型长度、`DEFAULT`、约束名、`ON DELETE` 行为。本蓝图给形状，DDL 由实现计划产出。
- **索引清单**：本文只给规则（§7.8）与例外（`COALESCE` 表达式索引），具体每张表建哪些索引由实现计划按查询场景列。
- **触发器实现**：`app.forbid_tenant_move()`、family 血亲侧检查、字辈校验的具体 PL/pgSQL。
- **迁移脚本与对账脚本**的具体形态（`data/` 下的文件切分、批次大小、进度输出）。
- **DTO 投影层**：`lib/genealogy/dto/` 的模块划分与字段命名（A1 §14 遗留问题，继续沿用现有 `NodeView` 字段名）。
- **UI 改动**：检查器如何呈现位次/承嗣/证据面板、谱书快照的生成入口。本文只要求"前端组件不改数据结构"。
- **每期 PR 的切分**（迁移 / 回填 / 对账 / 读切换 / 写切换 / 退役六段式，§19.3）。
- **测试清单**：每期的集成测试用例名与断言。
- **`event_type` 与 `issue_code` 的完整枚举值**（本文给命名空间与判定标准）。

## 24. 风险与重估触发

| 风险 | 影响 | 缓解 |
|---|---|---|
| 34 张新表跨 11 期，中途停滞会留下半成品 | 高 | 每期独立可交付、可回滚；P0–P3 是"能画出谱"的最小闭环，先保这条线 |
| 位次层让检查器与画布的交互复杂度上升，且兼祧者在画布上出现两张卡片 | 中 | `NodeView` 字段名不变，但**行身份改成位次**（§10.6），所有 Action 入参要从"人"改成"位次"，这是 P2 的显式工作量，不能当成零成本 |
| GEDCOM 同步导入的个体数上限被真实文件突破 | 中 | 先实测；破例条件按 ADR-23（用户等得起、产线等不起）写进 ADR 0020 |
| 证据层上线后用户期待"自动裁决冲突" | 中 | §12.4 的代价写进 ADR 0022 与产品文案：系统只记录、不裁决 |
| 隐私脱敏与"谱内全可见"的产品直觉冲突 | 中 | ADR 0018 明确角色不影响脱敏，并用真实用户场景验证 |
| 跨 project 同一人仍不可表达 | 低 | `external_id` + 合并日志是当前答案；若出现"一人多谱必须合并"的需求，重估 §3 非目标 |

**重估触发条件**（出现即重开本文）：

1. 需要"多来源冲突自动裁决"→ 重估方案三（断言模型）。
2. 需要跨 project 的人物身份 → 重估 §9.1 的 `person.project_id`。
3. 需要后台任务（大文件导入、渲染流水线）→ 重估 ADR 0005 与 §14.4 上限。
4. 需要逐字段审计 → 重估 §16.3。
5. `lineage` 与 `lineage_branch` 的区分在真实客户数据里不成立 → 合并两层。

---

## 附：与三份材料的关系

| 材料 | 采了什么 | 拒了什么 |
|---|---|---|
| 现仓库 | 三层隔离、软删、公开 ID、`withOrg`、11 张表的命名与约束风格、`article`/`book`/`book_catalog` 现状 | `node` 单树（ADR 0003 被本文取代） |
| A1 spec | `family` + `family_child` 的边模型、`parentage_type` 枚举、迁移六段式、DTO 兼容要求 | `person.lineage_id`、`person.role`、`person_tree` 挂 `person`、`husband_id`/`wife_id`（§20） |
| 附件 v1.0 | `event`/`event_participant`、日期四件套 + `date_cn`、排他弧 + `NULLS NOT DISTINCT`、`evidence_link` 的 `evidence_role`、`person_name` 的 `name_type`、`place_name` 的历史名、`gedcom_record` 原文回放 | `genealogy` 即租户、`person` 全局 + `lineage_person` 的 `UNIQUE (lineage_id, person_id)`、`change_log`、`render_job`、`purge` 旁路、`app_user` 的 GUC 身份、`ENABLE` 不 `FORCE`、26 值 `event_type` 闭集、`book_edition`/`book_section`/`book_content` 四层 |


