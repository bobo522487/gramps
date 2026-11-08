# 数据模型（Data Model）

> **回答什么问题**：全局有哪些实体、怎么分层、哪些不变量由数据库保证、刻意不建模什么。
> **读者**：开发 · 技术负责人 · AI Agent　**长度上限**：5 页
> **不写什么**：接口与 DTO（`docs/interfaces.md`、`docs/contracts/`）、系统分层与部署形态（`docs/architecture.md`）、术语定义（`docs/glossary.md`）、可度量阈值（`docs/nfr.md`）、排障步骤（`docs/runbooks/`）、决策理由（`docs/adr/`）、进度与编排（`docs/roadmap.md`）。

本文是**目标架构的数据模型规格**：写实体边界、不变量与取舍，**代码按本文重构，本文是验收基准**。逐列 DDL 在重构完成后落到 `lib/db/schema/` 与 `lib/db/migrations/`，迁移清单唯一在 `lib/db/migrations/meta/_journal.json`，本文不复制第二份表结构。**重构完成前，现有代码与目标态的差异集中在 §8**——那是待消掉的迁移清单，不是另一套真相；重构完成后该节整体删除，不留双写。

---

## 1. 一页结论

> **[目标]** §1–§7 每节均标 [目标]，是目标态规格，代码按本文重构；以本文为准，不用现状反推规格（`CONTRIBUTING.md` §2）。§8 单独标注 [现状]。

| # | 判断 | 理由 |
| --- | --- | --- |
| 1 | **事实、谱系、谱文、谱书四类东西分开建表** | 身份是世界里的，谱系是编出来的树，谱文是写出来的字，谱书是排出来的目录。混在一起必然出现「一个字段两种含义」 |
| 2 | **`book_catalog` 是唯一装订层；库内书是动态引用，不是快照** | 书不拥有内容，书拥有位置。位置可有多个，内容只有一份；内容一变，所有引用它的书同时变。历史原貌只在库外导出物，其元数据由 `book_export` 登记 |
| 3 | **两棵树用物化路径 `ltree`，闭包由生成列 + 自引用复合 FK 保证** | 父、深度、祖先、兄弟序都在 `path` 一列；`parent_path` 派生父路径、FK 指向本表已有的 UNIQUE，于是「父行必须存在 / 不能只删中间行」由 DDL 兑现 |
| 4 | **拒绝 `target_type + target_id` 多态关联** | 悬空 ID、无删除保护、无类型检查。宁可多两个可空外键列 + 一条 CHECK |
| 5 | **项目内表用 `(project_id, id)` 复合主键，并冗余 `organization_id`** | 复合 FK 阻断跨项目引用；`project.id` 全局唯一另加 UNIQUE，关闭「两组织同 id 项目 + RI 绕过 RLS」这类跨租户引用。`organization_id` 是唯一允许的冗余列，由指向 `project` 的复合 FK 钉死 |
| 6 | **产品是成书工具，不是考据系统** | 不建断言 / 出处 / 引文定位，也不保留「没有出处的可信度」与「没有键的备注」 |
| 7 | **`auth.*` 不参与隔离，业务侧只引用 `auth.user(id)`** | 认证身份是全局的，组织成员关系是本系统的。两套成员模型就是两个真相 |
| 8 | **RLS 谓词一次求值，且不破坏索引有序扫** | `organization_id = ANY (coalesce((SELECT app.visible_org_array()), '{}'::uuid[]))` 把成员集合变成 `InitPlan`（每条策略表达式一个，`loops=1`）；`IN (SELECT setof)` 只能得到 hashed SubPlan + ProjectSet，会让规划器放弃 `ORDER BY path` 的索引扫 |

一句话内核：**事实只有一份；谱系是它的编排，谱文是它的叙述，谱书是这两者的目录；导出物是库外的那一版。**

---

## 2. 领域分层与实体清单

> **[目标]** 下表实体名与分层描述目标态；重构前实现的同名术语见 §8「读法」。

层间只允许**单向依赖**：谱书层 → 谱系层 / 谱文层 → 事实层。事实层不反向引用编排层：`person` 上不存在 `lineage_id` / `book_id` / `father_id`，`article` 上不存在 `book_id`。这条单向规则是整套模型的骨架，也是 §5 依赖链成立的原因。

| 层 | 回答的问题 | 实体 |
| --- | --- | --- |
| 认证层 | 这个账号是谁 | `auth.user` / `auth.session` / `auth.account` / `auth.verification` |
| 边界层 | 谁能看见哪些数据、数据在哪个项目里 | `organization` / `organization_member` / `invite` / `project` / `folder` |
| 事实层 | 世界上有谁、发生了什么关系与事件 | `person` / `person_name` / `family` / `family_partner` / `family_child` / `event` |
| 谱系层 | 这部谱把谁排在谁下面 | `lineage` / `node` |
| 谱文层 | 这部谱写了哪些文字 | `article` |
| 谱书层 | 按什么次序装订、导出过哪些制品 | `book` / `book_catalog` / `book_export` |

**适用边界**（结构选择的前提，任一不成立就要重算）：单项目 ≤ 10 万人、世系深度 < 50 世、读远多于写、整树渲染是热路径、改挂 / 移子树低频、同级插入偶发、不做库内多版本成书。目标库是 **PostgreSQL 18 硬下限**：`uuidv7()` 是 18 新增核心函数，`ON DELETE SET NULL (列清单)` 需 15+，用到 `ltree` + `btree_gist` 两个 contrib 扩展。`uuidv7()` 只是时间有序，**不是严格单调**，不要把 `ORDER BY id` 当插入序。

事实层与编排层**允许不一致**：谱把某人挂在非生父下、或为宗法改挂，是家谱常态，不是脏数据。两者通过 `person_id` 自然可比，但数据库不做一致性判定、不产出待复核清单，复核由编纂者完成。

---

## 3. 组织隔离

> **[目标]** 本节描述目标态隔离机制；重构前的实现差异见 §8。

隔离边界是 `organization`；RLS 的根是 `organization_member`——所有策略最终归约到「当前用户是否在该行 `organization_id` 下有成员行」，没有别的判定路径。数据容器是 `project`，其余 13 张项目内表全部携带 `organization_id` + `project_id`。

`auth` schema 由 Better Auth 管理，**不参与 RLS、不接受业务侧写入**；跨 schema 外键只允许指向 `auth.user(id)`，共 4 处。业务侧所有用户引用列统一 `text`，不为「类型统一」去改造第三方框架生成的 schema——这是全库唯一一处跨边界类型差异。

会话上下文由应用服务在**同一事务内**用 `SET LOCAL app.user_id` 注入，业务 SQL 必须与它同事务。`SET LOCAL` 的生命周期只到当前事务结束；把 `BEGIN; SET LOCAL …; COMMIT;` 单独跑成一个事务，之后所有查询都读到空 GUC → 0 行、写入 `42501`。改用会话级 `SET` 更危险：连接池归还前不 `RESET` 会跨请求串号。四个数据库函数构成机制（3 个 `SECURITY DEFINER`）：`app.current_user_id()` / `app.visible_org_array()` / `app.create_organization(text)` / `app.accept_invite(text)`。

所有业务表使用同一条策略谓词，`organization` 表自身把 `organization_id` 换成 `id`：

```sql
USING (organization_id = ANY (coalesce((SELECT app.visible_org_array()), '{}'::uuid[])))
WITH CHECK (organization_id = ANY (coalesce((SELECT app.visible_org_array()), '{}'::uuid[])));
```

三个不能省的细节，都是实测出来的：① 裸写 `= ANY (app.visible_org_array())` 会让 STABLE 标量函数逐行调用，10 万行 **607.445 ms**（InitPlan 形态是 26.454 ms）；② `= ANY ((SELECT …))` 直接写报 `operator does not exist: uuid = uuid[]`，`coalesce` 同时承担「变成 InitPlan」和「给出数组类型」；③ `IN (SELECT setof)` 得到 hashed SubPlan + ProjectSet，规划器放弃有序扫（93.526 ms）。`'{}'::uuid[]` 保证 GUC 未设置时 fail-closed。

> **GUC 不是安全边界。** 参数 ACL 管得住 `ALTER SYSTEM` / `ALTER ROLE … SET`，管不住会话内 `SET`。真正的安全边界是「只有应用服务持有数据库账号，且该账号不能执行任意 SQL」——**SQL 注入 = 跨租户读**。由此本模型定位是「单一可信服务 + RLS 纵深防御」：RLS 防的是应用内部作用域遗漏，不是身份伪造。

落地要求：应用连接用非属主角色；`app.*` 函数与业务表 DML 只授给它；必须补表级 `GRANT` 与 `ALTER DEFAULT PRIVILEGES`（否则普通查询直接 `42501`，RLS 根本没机会生效）；三个 SECDEF 函数把 `pg_temp` 显式放在 `search_path` 最后并全写 schema-qualified 名字，防临时表阴影提权；RLS 只做可见性，`owner / admin / editor / viewer` 的读写授权由应用服务在单一写入路径判定。

---

## 4. 全局约定

> **[目标]** 本节是目标态建表约定；重构前的实现差异见 §8。

| 约定 | 规则 |
| --- | --- |
| 主键 | `id uuid NOT NULL DEFAULT uuidv7()`，应用层不生成 ID |
| 复合主键 | `organization (id)`；`invite / project (organization_id, id)`；其余 13 张项目内表 `(project_id, id)`。`organization_member` 例外，直接用 `(organization_id, user_id)` |
| 隔离列 | 除 `organization` 外所有业务表都有 `organization_id uuid NOT NULL` |
| 时间戳 | 只有 `created_at`；**不设 `updated_at`**——没有查询用它，而「每条 UPDATE 显式赋值」是批量路径必然违反的契约 |
| 外键 | 指向项目内表一律 `(project_id, x_id) REFERENCES t(project_id, id)`；可空 FK 的 `ON DELETE SET NULL` **必须带列清单**，否则复合 FK 把 `NOT NULL` 的 `project_id` 一起置空，报 `23502` |
| 取值约束 | 只有被多张表共享的取值才抽 DOMAIN（全库 1 个 `member_role_t`）；单用取值就地写列级 CHECK |

`organization_id` 是唯一被允许的冗余列：RLS 谓词必须在行内判定隔离、不能 join `project`，而 InitPlan 化又要求谓词不引用其他表——只有把它放行上才能同时满足。复合主键的作用是让 `REFERENCES t(id)` 单列引用语法直接报错，属纵深防御；`project.id` 的全局 `UNIQUE (id)` 才是关闭跨租户引用的那一刀。

**两棵树的路径**（`node.path` / `book_catalog.path`）用 `ltree`，不存父指针：每段 4 位数字点分隔（`0010.0020`），`CHECK (path::text ~ '^[0-9]{4}([.][0-9]{4})*$')`（点必须写字符类 `[.]`，否则 `standard_conforming_strings = off` 时正则变成任意字符）。世次由 `nlevel(path)` 派生、不落可漂移列；兄弟序取末段树遍历序；同级插入用稀疏编号（`0010`/`0020` 之间插 `0015`）。整树读取 `WHERE project_id=$1 AND lineage_id=$2 ORDER BY path`，天然深度优先、祖先在后代之前；子树用 `path <@ '0010'::ltree`（**含根自身**）。

**闭包由数据库保证**：生成列 `parent_path = subpath(path, 0, nlevel(path)-1)`（根为 NULL），加自引用复合 FK 指向本表已有的 `(…, path)` UNIQUE。插无父子路径报 `23503`，只删中间行报 `23001`；整棵子树连同根一条 `DELETE` 仍成功（FK 按语句终态判定）。不需要新表、新索引、新 UNIQUE、新触发器，也不需要防环 CHECK——路径是树地址，成环无法表达。

**「三选二」互斥**：闭包由 FK 保证（要求非延迟 UNIQUE）、一条 `UPDATE` 完成前缀交换（要求延迟 UNIQUE）、零延迟约束，三者最多同时要两条。选 **闭包 + 零延迟**：重排是低频维护，把一条 UPDATE 换成「一个事务三条 UPDATE」更划算。三条路径必须非延迟，逐行检查意味着单条 `UPDATE` 交换 `0010 ↔ 0020` 必报 `23505`，走三阶段改名（借一个确认空闲的 scratch 段）。另注意 `UNIQUE … DEFERRABLE` 不能作 `INSERT … ON CONFLICT` 的 arbiter（`42P10`）。

---

## 5. 四类东西必须分开

> **[目标]** 本节是目标态实体边界；重构前的实现差异见 §8。

| 概念 | 本质 | 表 | 不做什么 |
| --- | --- | --- | --- |
| 谱系 | 结构化数据：身份 + 位置路径 + 序位 | `lineage` / `node` | 不写传记正文、不决定成书卷次 |
| 谱文 | 可独立阅读的文本 | `article` | 不产生父子边 |
| 谱书 | 把谱系与谱文按卷次装订成可输出的整书 | `book` / `book_catalog` | **不复制内容、不拥有内容、不在库内冻结内容** |
| 导出物 | 库外不可变制品；库内只登记元数据 | `book_export` | 不存正文、不建版本 diff、不建 GC |

**库内书没有「已出版」状态**：`book` + `book_catalog` 只描述装订次序，引用的是当前事实层与内容行。一次事实层或谱文编辑，会立刻反映到所有引用它的书上。成书真正成为历史制品发生在**导出**那一刻：应用遍历 `book_catalog.path` 渲染，把结果写成 PDF / 排版文件存到对象存储；制品一旦生成不再变化。`book_export` 只登记 `book_id` / `exported_at` / `fact_cutoff` / `artifact_uri` / `checksum` / `format`，回答「哪一版、何时、指向哪个制品、校验和多少」，不回答「那版里每个字是什么」。

**复制内容行不是冻结手段**，依赖链是：`book_catalog → lineage → node.path → node.person_id → person → person_name / event / family → family_*`。复制 `article` / `lineage` / `node` 树之后，副本的 `person_id` 仍指向共享的 `person` 行——改一次生年，所有「已出版」的书跟着变。要真正冻结得把整张事实层子图连同引用一起复制，那等价于分叉一个项目。因此本文不提供任何库内冻结手段。

三条硬边界：谱系 ≠ 谱书（一条世系可被多部书收录）、谱文 ≠ 谱书（同一篇谱序被两部书引用 = 两条目录条目指向同一行）、导出记录 ≠ 内容快照。若产品必须让用户在库内回看某版成书或比较两版差异，需要不可变版本行与派生关系，属于带版本的考据系统，**与本文取舍冲突，不是加几张扩展表能完成的**。

---

## 6. 关键不变量与删除语义

> **[目标]** 本节是目标态不变量清单；重构前的实现差异见 §8。

| 不变量 | 兑现机制 |
| --- | --- |
| 跨组织不可见 | 单一 RLS 谓词 + GUC 未设置时 fail-closed |
| 行归属与项目一致 / 跨项目引用不存在 | 复合 FK + `project.id` 全局 `UNIQUE (id)` |
| 事件主体恰好一个且类型匹配、目录条目不装订两类内容 | `CHECK (num_nonnulls(...) = 1 / <= 1)` |
| 同一世系 / 同一书内位置唯一、路径格式合法 | 两个非延迟 `(…, path)` UNIQUE + 格式 CHECK |
| 世次与深度不漂移、树不成环 | `nlevel(path)` 派生 + 路径类型本身 |
| **路径集合闭合（无孤儿）** | 生成列 + 自引用复合 FK，非运行时检查 |
| 每人最多一条生、一条卒事件 | 两条 kind/主体 CHECK + 两个部分唯一索引；列表页不做聚合 |
| 所出之母与子女同家庭且角色为妻 / 妾 | 四列复合 FK → `family_partner` + 成对 CHECK |
| 库内书没有已出版态、身份表不含关系事实 | 结构上不存在对应列与表 |

**全库用户定义触发器 0、定时任务 0、视图 0。** 上表机制都是主键、外键、CHECK、唯一索引、生成列、路径类型，或一条明确的写入路径契约。仍不由 DDL 保证的（写入路径契约、制品不可变性、组织至少一名 owner）必须写出「谁兜、怎么验、何时算失守」，见 §9。

删除：整棵子树一条 `DELETE ... WHERE path <@ '0010'::ltree`（`<@` 含根自身）；移子树用 `text2ltree` 重写前缀（根上 `subpath(path,1)` 会报 `22023`）；同级交换走三阶段改名。`auth.user` 删除时成员行 `CASCADE`、`created_by` / `invited_by` `SET NULL`；删 `folder` 时内容 `folder_id SET NULL (folder_id)`；**其余一切 `RESTRICT`**，不允许一条 SQL 静默抹掉数据。注意 `RESTRICT` 违反时 SQLSTATE 是 **`23001`** 而非 `23503`（`NO ACTION` 才是 `23503`）。

---

## 7. 取舍、非目标与验证口径

> **[目标]** 本节验证口径是重构验收条件，数字须在目标环境重跑刷新后才算兑现。

| 取舍 | 换来了什么 / 代价 |
| --- | --- |
| `ltree` + 生成列 + 自引用 FK，不用邻接表 | 消灭防环触发器、递归视图、三步删除；整树一次索引有序扫。**代价**：2 个 contrib 扩展、移子树 O(子树行数)、重排要三阶段改名、PG18 硬下限 |
| 复合主键 + `project.id` 全局 UNIQUE | 关闭一整类跨租户引用，只多一条唯一索引。**代价**：身份是项目内局部的，URL / 日志 / 缓存键要带 scope |
| 库内书 = 动态引用；成书 = 库外导出物 | 结构简单、编辑即时生效，不需要内容版本表与快照 GC。**代价**：库内无法回看或比较历史成书正文 |
| 不做考据、生卒各一条 | 列表页一次 LEFT JOIN，不聚合、不拼假事实。**代价**：异说只能写进原文，无法记录出处 |
| 原文 + 机器键双轨 | 成书输出保真、查询可排序。**代价**：两者之间不存在数据库可校验的一致性 |
| RLS 只做可见性，谓词 InitPlan 化 | 一条谓词覆盖全库、有序扫不被破坏。**代价**：安全边界落在部署前提上 |

**非目标**（不建模，也不预留空表）：史料引用链 / 断言体系 / 异说与考据备注；库内成书内容快照、不可变版本行、版本图、回看与 diff；邀请历史流水；媒体资产与附件；地点字典与历史地名隶属；跨项目身份对齐与自动合并；行级乐观锁版本号；用户自定义触发器、定时任务、常驻对账视图。

**性能口径**：整树查询的 < 100ms 只指**服务端 `EXPLAIN (ANALYZE)` 的 Execution Time**，以应用角色连接、10 万行 `node`、指定两条查询，实测 Q1 26.454 ms / Q3 42.930 ms；客户端 wall clock 187.5–215.4 ms 不在该 NFR 内。属主绕过 RLS，其计划不能作验收依据。**重构验收条件**：全量 DDL 在干净 PG18 库执行 0 ERROR、正反例逐条断言 SQLSTATE、计划形状为 `InitPlan 1 -> Result (loops=1)` + `Index Scan` + 无 Sort、伪造 `pg_temp` 提权被拦住。这些数字来自设计阶段的独立容器验收，**重构完成后必须在目标环境重跑并刷新本节**；在那之前它们不是仓库已兑现的能力。

---

## 8. 重构前的实现差异（迁移清单）

> **[现状]** 本节是重构前的实现快照，为待改对象；13 条差异逐条消掉后整节删除，不留双写。

> 本文 §1–§7 是**目标态**，代码按本文改。下表是重构前必须逐条消掉的差异，**旧实现是待改对象，不是裁决依据**。第 1 条是根上的变更：事实层从「`node` 的回填快照」变成主数据源，读写路径与术语已随本批同步跟改。取舍已在本文定稿，只需新增一条 ADR 记录这次模型变更，不需要再讨论选哪套。

> **[现状]（2026-11-08 B1 更新）**：`lib/db/migrations/0000_target_schema.sql` 已是附录 A 全量目标态 DDL 的唯一基线，#2 / #3 / #4 / #5 / #9 / #10 的**库结构**已在基线里就位；B1 补上 `book_export` 的 TS 表结构、并让 `project` / `folder` 的复合主键在 TS 侧追平（#6 部分消除、`lineage_folder_fk` 的 42830 隐患解除），但 #2 的 `book_export_book_fk` 目标键仍待 `content.ts` 追平，`lib/db/schema/*.ts` 与 `lib/auth/*` 其余部分也尚未追平（阶段 B 的 T18–T28、阶段 C 的 T29–T34）。下表「现状」列描述的是 TS / 应用侧，逐条消掉指两侧都对齐，不是只看 SQL 文件。

| # | 目标（本文） | 现状（待改） | 现状位置 / 待改文件 |
| --- | --- | --- | --- |
| 1 | `person` 是身份与事实的主数据源，谱系只引用它 | **已消除**：事实层六表由应用直接读写为主数据源，`node` 退为位置引用；`docs/architecture.md`「域所有权」与 `docs/glossary.md`「事实层 / 人丁」已同步 | `lib/db/schema/{person,family,event,lineage}.ts` |
| 2 | `book_export` 登记导出制品 | **B1 已补 TS 表结构**：B0 唯一 SQL 基线按附录 A.5 建 `book_export`；B1 补 `lib/db/schema/book-export.ts`（复合主键、四条 CHECK、两条 FK）与 barrel 类型导出。但 `book_export_book_fk` 的目标键 `book (project_id, id)` 在 TS 侧 `content.ts` 仍是单列主键，须由阶段 B 后续批次追平，**不能称两侧已对齐** | `lib/db/migrations/0000_target_schema.sql`；`lib/db/schema/book-export.ts`；`content.ts` |
| 3 | `parent_path` 生成列 + 自引用 FK 保证闭包 | **谱系层已消除**（A′）：`node.parent_path` 生成列 + 自引用 FK 已落地；谱书层 `book_catalog` 仍是 `parent_id` + `fk_catalog_parent_same_book`，待 T25 | `lib/db/schema/lineage.ts`；`content.ts` |
| 4 | `book_catalog.path` 是 `ltree`，用 `section` / `sort` 之外还靠路径排序 | `book_catalog` 用 `parent_id` + `section` + `sort` + `hide`，**没有 ltree 列** | `lib/db/schema/content.ts` |
| 5 | `article.body` 文本 | `article.content` 是 jsonb + `plain_text` | `lib/db/schema/content.ts` |
| 6 | 复合主键 `(project_id, id)`，`organization_member` 无 `id` | **B1 部分消除**：`project` 改 `(organization_id, id)` + `project_id_global` 全局唯一（替换与主键重复的 `uk_project_organization_id`），`folder` 改 `(project_id, id)`；其余表仍是单列 `id` 主键 + `uk_*_organization_id` 唯一约束，`organization_member` 仍有 `id`，`uuidPk()` 未退役（T18 收尾删） | `lib/db/schema/{shared,org,project,content,auth,activity}.ts` |
| 7 | 0 个 `updated_at`、无软删、删除走 `RESTRICT` | 6 个 schema 文件有 `updated_at` / `deleted_at`；业务表软删、`organization_member` 与 `invite` 硬删 | `lib/db/schema/*.ts`；`docs/glossary.md`「软删 / 硬删」；`docs/nfr.md` §5 |
| 8 | 不使用 Better Auth organization 插件；`auth.user` 主键 `text` | 用 organization 插件；`users.id` 是 uuid | `docs/architecture.md` 技术栈；`lib/db/schema/shared.ts` |
| 9 | 不启用 FORCE RLS（方案 A），角色 `genealogy_app` | `public` schema 启用 FORCE RLS；运行期角色 `app_rw` / `auth_service`，迁移直连角色才 `BYPASSRLS` | `docs/architecture.md` 部署形态；`docs/runbooks/README.md` §1 |
| 10 | `app.visible_org_array()` + InitPlan 谓词 | 全仓 schema 无该函数与 `app.*` 命名空间 | `grep -rn "visible_org_array\|genealogy_app" lib/db/schema/` 为 0 |
| 11 | 世次由 `nlevel(path)` 派生 | **谱系层已消除**（A′）：`node.generation` 存储列与两条 CHECK 已删，世次由 `path` 的段数（`segments.length`）在查询投影层派生 | `lib/db/queries/nodes.ts` |
| 12 | `path ltree NOT NULL`、树不可能成环 | **谱系层已消除**（A′）：`path ltree NOT NULL`；`parent_id` / `spouse_of_id` / `role` / `is_alive` 等身份字段已不再内嵌于 `node`（姓名在 `person_name`、生卒由 `event` 派生、性别在 `person.sex`） | `lib/db/schema/lineage.ts` |
| 13 | PG18 `uuidv7()` 是硬下限 | **已满足，无需改动**：`uuidPk()` = `uuid('id').primaryKey().default(sql\`uuidv7()\`)` | `lib/db/schema/shared.ts` |

重构验收时逐条确认差异已消掉：

```bash
grep -rn "pgTable(" lib/db/schema/
grep -rn "book_export\|parent_path\|visible_org_array\|genealogy_app" lib/db/schema/
grep -rn "uuidv7\|FORCE ROW LEVEL SECURITY" lib/db/schema/ lib/db/migrations/
node -e "console.log(require('./lib/db/migrations/meta/_journal.json').entries.length)"
```

**读法**：`docs/glossary.md` 的术语（人丁 = `node`、云谱空间 = `project`、谱系 / 谱文 / 谱书 / 编目）描述的是**重构前的实现**；本文 §2 的表名描述的是**目标态**。同名不同义时**以本文为准**——术语表、架构文档与运维手册会随重构跟改，不要反过来用旧术语去解释本文。

---

## 9. 约束要有执行者

> 写在文档里但拦不住的规则，等于没有规则。规格里每条保证都要能在 DDL 里指出兑现位置；指不出来的，写出谁兜、怎么验、什么时候算失守。

| 保证 | 执行者 |
| --- | --- |
| 闭包、跨项目引用、格式、唯一性、主体唯一 | DDL：主键 / 外键 / CHECK / 生成列 / 唯一索引 |
| 隔离与 fail-closed | RLS 策略 + 应用服务在事务内注入 `SET LOCAL`；`verify:deploy` 逐项断言运行期角色 `NOBYPASSRLS` |
| 角色授权、收录状态、制品不可变性、组织至少一名 owner | **无自动执行者**：靠单一写入路径契约、评审与巡检 SQL；制品不可变性由对象存储负责 |
| 路径标签稳定、稀疏序号重排、三阶段改名 | 写入路径契约，低频维护操作，靠代码评审 |
| 迁移已应用、库结构与代码对齐 | `.github/workflows/migrate-production.yml` + `scripts/verify-deployment.mjs` |
| §7 的验证结论（重构验收） | 当前**无自动执行者**：数字来自独立 PG18 容器的人工验收；重构完成后须落成 CI 或 `verify:deploy` 断言，否则纸面数字不算兑现 |

重构前的自动执行者清单在 `docs/architecture.md` 的「约束要有执行者」，本文不重抄，它会随本次重构同步更新。把本文从纸面变成现实靠的是迁移 + 断言，不是再写一份文档——**§8 的每一行都该在某个提交里消失**。
