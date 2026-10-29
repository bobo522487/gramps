# GEDCOM 7.0 PostgreSQL 家谱数据模型 v1.0 评审

> **评审对象**：附件 `基于 GEDCOM 7.0 的 PostgreSQL 家谱数据模型 v1.0.md`（1716 行 / 77192 字节 / sha256 `fe91ddaf…`）——40 张表 + 1 个视图 + RLS 章 + 触发器章，无第 6 章。
> **评审视角**：① PostgreSQL 模式设计最佳实践（约束、索引、租户隔离、性能）② GEDCOM 7.0 保真度（[gedcom.io v7](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html)）③ 中文宗族表达力 ④ 与本仓库现状的可落地性。
> **评审日期**：2026-10-29　**评审基线**：`52af0d1`（A1 关系层设计 [已定稿未实施](../superpowers/specs/2026-10-29-person-family-model-design.md)）
> **性质**：评审记录，**不是规范**。按 [`docs/README.md`](../README.md) §5.1，结论在转成 ADR 之前不具备约束力。本文的采纳部分已落成 [A2.1 生平层实施计划](../superpowers/plans/2026-10-29-a2-lifespan-layer.md)。
> **方法**：三把尺子分别由三次只读子评审独立执行（模式设计 / GEDCOM 规范 / 与本仓库差分），结论在这里合并去重；行号一律写作 `附件:L183`，本仓库引用写 `文件:行`。

---

## 0. 一句话结论

**这是一份「模式设计 7 分、GEDCOM 保真 6.5 分、与本仓库契合 4 分」的设计素材，不是可执行蓝图。**

它值得逐条吸收的地方集中在**事件层**（`event`/`event_participant` + 日期四件套 + `date_cn`）与**中文宗族骨架**（`lineage`/`lineage_branch`/派语/承嗣/嫡庶）；不能照抄的地方集中在**层级**（附件 `genealogy` 对应本仓库 `project`，不是 `lineage`）、**安全模型**（`genealogy_id` 可变 + 占位 GUC）、以及**三件撞 ADR 的能力**（后台任务、硬删、全量审计）。

| 维度 | 评分 | 判据 |
|---|---|---|
| 关系建模 | **8**/10 | `family` + `family_child` 把 GEDCOM FAM 拆成「婚配」与「亲子边」两层，一个事实一个来源；复合外键把租户一致性压进 DDL |
| 约束与索引 | **7**/10 | 排他弧 + `NULLS NOT DISTINCT` + `num_nonnulls` 用得准；但有 9 张表违反它自己写的 `UNIQUE (genealogy_id, id)` 规则，约 12 条复合外键缺子侧索引，链接表索引扇出到 10 条 |
| 租户隔离与安全 | **4**/10 | 租户列可变、`app.user_id`/`app.purge` 是任意连接都能 `SET` 的占位 GUC → 40 张表的 RLS 变成「防误操作」而不是「防越权」 |
| GEDCOM 7.0 保真 | **6.5**/10 | 导入够用、导出有损：16 个标准事件/属性标签、`ASSO`、`ALIA`、`ADDR`、`REFN`、`PLAC.FORM` 无处安放 |
| 中文宗族表达 | **6**/10 | 骨架在，但 `UNIQUE (lineage_id, person_id)` 让兼祧在结构上不可能；无排行，失考无标记 |
| 文档自洽 | **5**/10 | 第 6 章不存在却被两处引用；视图在依赖它的示例之后创建；DO 块不可重复执行；`raw_text` 无失效标记 |
| 与本仓库可落地 | **4**/10 | 无 project 层、无公开 ID、RLS 角色名与根键不同、5 处与现有 ADR 直接冲突（0002/0004/0005/0009/0011） |

### 0.1 五条要点

1. **最值钱的是事件层。** `event` + `event_participant` + `date_original/start/end/precision/qualifier/calendar/date_cn` 正是 A1 spec 的 A2 阶段，可以当规格直接用（§7 决策表第一行）。
2. **最危险的是租户隔离。** 两处 P0（可变租户列、无校验 GUC）让整份 RLS 章的保证降级；这两条在本仓库已经有更好的答案（`FORCE RLS` + `auth.has_org_role` + 只授 `SELECT/INSERT/UPDATE`），不需要抄。
3. **最不能照抄的是层级。** 附件 `genealogy` ≙ 本仓库 `project`、`lineage` ≙ `lineage`；附件 `L3` 写的「项目 = organization」在本仓库是错的（项目是 `project`，有 20 位 `ref`）。照抄会把成员与角色下沉一级。
4. **最该拒绝的是三件套**：`render_job` / `gedcom_import.status` 流水线（撞 ADR 0005 零后台任务）、purge 硬删 + `app.purge` 旁路（撞 ADR 0004 软删到底、且 `app_rw` 没有 DELETE 权限）、`change_log` 全行审计（本仓库明确拒绝过审计表）。
5. **最容易被忽略的是文档缺章。** 第 6 章（隐私阈值与保真等级）不存在，而「保真等级见第 6 章」是整份文档对自身局限的唯一交代——`附件:L90` 与 `附件:L1052` 都指向它，文件却在 `附件:L1716` 以 §5.16 结束。

---

## 1. 三把尺子

| 尺子 | 检查项 | 本次命中 |
|---|---|---|
| **S1 不变式有没有执行者** | 每条业务规则，是 DDL 在拦，还是只有散文？ | 兼祧、事件必须有主体、日期 qualifier 语义、`raw_text` 失效——四条都只有散文（§3.2） |
| **S2 隔离是不是三层** | 应用层过滤 + RLS + 复合外键，三层是否都成立 | 复合外键层是全仓最好的部分；RLS 层有两处 P0；应用层没有对应物（本仓库 `withOrg` 是答案） |
| **S3 保真是不是可证伪** | 「高保真往返」有没有可执行的判据 | 没有。`附件:L1052` 自己承认「核心表不能单独往返」，然后把判据推给不存在的第 6 章 |

**不评审**：视觉、排版、产品定价、字段命名审美（`sex varchar` vs `smallint` 只作为「需要二选一」记录）。

---

## 2. 它做对了什么（可直接吸收的 8 条）

| # | 做法 | 位置 | 本仓库对应动作 |
|---|---|---|---|
| G1 | **FAM 拆成婚配层 + 亲子边层**，`family_child` 带 `parentage_type` 与 `is_primary`，过继/收养/继子各有类型 | `附件:L269-348` | A1 已同构采纳（`spec` §4）；A2 不再动关系层 |
| G2 | **复合外键到 `(genealogy_id, id)`**，每个父表都建 `UNIQUE (genealogy_id, id)` 作目标 | `附件:L251-252`、`L501-502`、`L339` | 本仓库已有（`schema.ts` 复合 FK + `withOrg`），A2 新表必须延续 |
| G3 | **排他弧用 `num_nonnulls(...) = 1` + `UNIQUE NULLS NOT DISTINCT`** 表达「一条链接只指向一种目标」 | `附件:L683-688`、`L785-787`、`L866-869` | A2.1 不需要弧（事件只有一个主体）；A2.2 史料链接直接照抄这个模式 |
| G4 | **事件与属性共用一张表 + `event_kind`**，避免「职业」「教育」这类 GEDCOM 属性另开一张表 | `附件:L420-461` | 采纳，但把 `event_kind` 降级成 TS 常量派生，不落列（§3.2 E1） |
| G5 | **日期四件套 + `date_cn` jsonb**：原文、边界、精度、限定词、历法、农历细节分列 | `附件:L445-456` | 采纳为 A2.1 的日期契约，并把 qualifier→(start,end) 的映射写成 CHECK（§3.2 E3） |
| G6 | **`person_name` 多值 + `name_type` 枚举**（字/号/谥/庙/乳名/曾用名/教名…） | `附件:L218-258` | 采纳（A2.1 第一张新表），补软删与 `custom_type` 约束 |
| G7 | **`place` 自引用层级 + `place_original` 原文兜底** | `附件:L362-386` | 采纳 `place`；地名历史沿革（`place_name`）推迟到 A2.2 |
| G8 | **`person_merge_log` 的「保留者/被合并者 + 快照」形状** | `附件:L1458-1471` | 记录备查，A2 不做（合并功能本身未排期） |

---

## 3. 不符合最佳实践的地方

### 3.1 P0：隔离契约在 DDL 层面不成立

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| P0-1 | `附件:L1613` + 全表 `genealogy_id` | `_write FOR ALL … WITH CHECK (genealogy_id IN writable)` 允许「同时可写两个租户的用户」执行 `UPDATE person SET genealogy_id = B`，把行搬到另一个家谱；复合外键只在有子行时才拦，没有子行就无声通过。`genealogy.organization_id`（`附件:L160`）同理可被组织管理员改走 | `BEFORE UPDATE` 触发器：租户列一旦改变直接 `RAISE EXCEPTION`。**本仓库同样缺这一条**，A2.1 第一件事就是补上（见计划 Task 1） |
| P0-2 | `附件:L138-143`、`L1388`、`L1634`、`L1715` | `app.user_id` 与 `app.purge` 都是**普通占位 GUC**：任何连接 `SET app.user_id = '<别人的 uuid>'` 就能读另一个租户，`SET app.purge = 'on'` 就能绕过版本/快照不可变与审计 | 身份不能来自可写 GUC：要么用「连接角色 → 成员关系」的 definer 函数（本仓库 `auth.has_org_role` 走的就是这条），要么给旁路 GUC 加 `pg_has_role(current_user,'app_purge','MEMBER')` 守卫。本仓库当前用 `set_config('request.jwt.claims', …, true)` + `SET LOCAL ROLE app_rw`，语义上等价于 P0-2，**需要单独一条 ADR 记下接受理由与边界**（§8.2 D-3） |

### 3.2 P1：结构缺陷

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| P1-1 | `附件:L38` 规则 vs `L388`/`L648`/`L755`/`L834`/`L976`/`L1175`/`L1345`/`L1433`/`L1458` | 9 张有 `id` 的表没有 `UNIQUE (genealogy_id, id)`（`place_name`、`citation_link`、`media_link`、`note_link`、`gedcom_structure_map`、`generation_poem_item`、`render_job`、`validation_issue`、`person_merge_log`），`source_repository` 连 `id` 都没有——它们**不能**被复合外键引用，等于把自己写的规则作废 | 新表一律带 `UNIQUE (organization_id, id)`（A2.1 硬性要求）；附件里的存量表在采纳时逐张补 |
| P1-2 | `附件:L477` + `L508` | 事件**可以没有任何主体**：`family_id` 可空、`event_scope` 另有一列描述，主体唯一性只在 participant 层约束「至多一个 principal」 | 去掉 `event_scope`，改成 `person_id`/`family_id` 二选一 + `CHECK (num_nonnulls(person_id, family_id) = 1)`；主体即 principal，participant 只记见证/主婚/媒人（§3.2 E1） |
| P1-3 | `附件:L426-432` | `event_type` 是 25 值闭集，缺 16 个 GEDCOM 标准标签（CENS/PROB/WILL/NATU/ORDN/CONF/FCOM/BLES/BARM/BASM/CHRA/DIVF/MARB/MARC/MARL/MARS），只能落 `custom`，违反 `附件:L89`「不得静默丢弃」 | 枚举覆盖到「事件 + 属性」全集，`custom_type` 只在 `event_type='custom'` 时必填（CHECK），`gedcom_tag` 保留供 A3 导出 |
| P1-4 | `附件:L451-453`、`L520-527` | `date_qualifier` 到 `(date_start, date_end)` 的映射只写在散文里：「before 1691」有两种合法编码（`start=1691,end=NULL` 或 `start=NULL,end=1691`），没有任何 CHECK | 用四条 CHECK 固定语义：`exact/about/estimated/calculated` 与 `range/period` 要求 `start ≤ end` 且两端非空；`before` 只填 `end`；`after` 只填 `start`；无日期时三者同为 NULL（计划 Task 4） |
| P1-5 | `附件:L480` | `age_years`/`age_basis` 只约束了单向（有年龄必须有依据），有依据无年龄合法 | `CHECK ((age_years IS NULL) = (age_basis IS NULL))` |
| P1-6 | `附件:L256` | `uq_person_primary_name … WHERE is_primary` 是**部分唯一索引**，不能 `DEFERRABLE`，一条语句里换主名必然冲突；且「零个主名」合法 | 保留部分唯一 + 明确「换主名两条语句、同一事务」的应用规则并写测试；`person.primary_name_id` 方案因为会产生循环外键，本仓库不采用（§9 开放项） |
| P1-7 | `附件:L1654-1678` | 婚配/亲子冲突检查是 check-then-insert，没有加锁，并发两个插入都提交 | 先取 `pg_advisory_xact_lock(hashtextextended(...))` 再检查 |
| P1-8 | `附件:L1375-1418` | 不可变触发器逐行 `SELECT status FROM book_edition`，批量插入时 5 万次查表 | 改 `FOR EACH STATEMENT` + transition tables（A2 不涉及，记录备查） |
| P1-9 | `附件:L1474-1489`、`L1523` | `change_log` 写全行 before/after，散文说「按月分区」但没有分区 DDL，`PRIMARY KEY (id)` 让范围分区无法成立 | 本仓库**不采纳** `change_log`（§7）；若将来要审计，先写 ADR + 保留期 + 分区键 `(id, changed_at)` |
| P1-10 | `附件:L258` | `idx_person_name_search` 是 GIN trgm 且**没有 `genealogy_id` 前缀**，违反 `附件:L42` 自己定的「租户列永远第一列」；`search_text` 还是应用维护的可空列 | 本仓库 A2.1 **不建** trgm 索引：搜索边界仍按 [ADR 0011](../decisions/0011-search-boundary-node-client-article-trgm.md) 走客户端，等单谱系 >5000 人再重新评估（ADR 0011 的复评触发器） |
| P1-11 | `附件:L693`、`L792`、`L874`、`L1594`、`L1681`、`L1697` | DO 块里没有 `IF NOT EXISTS`，整章不可重复执行——而 `附件:L1713` 声称「按章节顺序执行即可」 | 本仓库所有 custom migration 必须可重复执行（`docs/data-model.md` §13） |

### 3.3 P2：工程细节

- `char(64)` 存 sha256 会补空格（`附件:L738`、`L902`、`L938`、`L1332`）→ 用 `text` + `CHECK (length = 64)`。
- `validation_issue` 没有自然唯一键（`附件:L1433`）→ 同一轮校验会插出重复 issue；本仓库将来做校验必须带 `(organization_id, issue_type, subject_type, subject_id)` 的幂等键。
- `render_job` / `gedcom_import` 没有队列索引与心跳列（`附件:L1345`、`L894`）→ 本仓库直接不采纳后台任务。
- `idx_person_live` 建在单列低基数列上（`附件:L215`）→ 选择性不足。
- `place_name` 没有审计列（`附件:L388`）→ 采纳时补 `created_at/updated_at/deleted_at`。
- `附件:L1713` 说「Drizzle 表达不了排他弧 CHECK / `NULLS NOT DISTINCT`」——前半句在本仓库已被证伪（`lib/db/schema.ts:522-525`、`lib/db/schema.ts:388-391` 都在 Drizzle 里声明了弧 CHECK），后半句成立（`NULLS NOT DISTINCT`、GiST、policy 走 `--custom` 迁移，见 `0013`/`0014` 先例）。

---

## 4. GEDCOM 7.0 保真度（6.5/10）

**结论：导入够用，导出有损，不是「高保真往返」。** 兼容层的承诺（`附件:L1052`）没有判据，而且判据指向的第 6 章不存在。

### 4.1 无处安放的结构

| 结构 | 现状 | 严重度 | 建议 |
|---|---|---|---|
| `ASSO` + `ROLE`（教父、主婚、见证、邻居…） | 缺失；`event_participant` 的角色枚举（principal/witness/godparent/officiant/relative/neighbor/other）是自创的，g7 `ROLE` 是 CHIL/CLERGY/FATH/FRIEND/GODP/HUSB/MOTH/MULTIPLE/OFFICIATOR/PARENT/SPOU/WITN/OTHER | 高 | A2.1 的 `event_participant` 先服务中文场景（见证/主婚/媒人），A3 再做 g7 角色映射表 |
| `ALIA` | 无；`merged_into_id` 是「同一人」，不是「疑为同一人」 | 中 | A3 用关联结构 + 显式标志 |
| `ADDR`/`PHON`/`EMAIL`/`FAX`/`WWW` | 只有 `repository`/`submitter` 上的扁平文本列（`附件:L591-594`、`L624-626`） | 中 | 统一成 `contact_point(owner_type, owner_id, kind, value, sort_order)`；A2 不做 |
| `CHAN`/`CREA`/`REFN` | 用 `created_at/updated_at` 近似，无 `REFN` | 中 | A3 导入进 `gedcom_extension`；文档写明导出总是重写 CHAN/CREA |
| `PLAC.FORM`（辖区顺序） | `place` 不存顺序，重新导出时 `PLAC` 字符串顺序会变 | 高 | `place.form_jurisdictions text[]`（A2.1 采纳） |
| `NAME.TRAN` | 只有 `pinyin` 一列 | 中 | A2.2 `person_name_translation` |
| HEAD 原文 / 非标准记录类型 | `gedcom_import.header` 是 jsonb（丢键序与重复键），`record_type` CHECK 只认 7 种（`附件:L954-955`） | 高 | A3 存 `head_raw_text`，`record_type` 改成开放 + `record_type_kind` |
| 在世者过滤 | `living_status` 说「年龄阈值」但没给数字，`privacy_level`/`resn`/`privacy_mode` 三套机制没有优先级、没有字段级脱敏矩阵 | 高 | 需要一条独立 ADR（§8.2 D-2）；A2 不实现，但新表的字段要留出脱敏位 |

### 4.2 映射错误与自相矛盾

| # | 位置 | 问题 |
|---|---|---|
| M1 | `附件:L98` | `confirmed` 导出成「—」是错的：g7 `FAMC-STAT` 是 CHALLENGED / DISPROVEN / **PROVEN**，`confirmed` 应映射 PROVEN；且 `family_partner.status` 没有 FAMS 侧对应物（g7 的 FAMS 无 STAT） |
| M2 | `附件:L101` | `name_type` 映射漏了内部枚举的 `religious` 与 g7 的 `IMMIGRANT` |
| M3 | `附件:L104` | 「`custom` 导出为 EVEN 或扩展标签」与「保留 `gedcom_tag`」冲突：标准标签必须原样回写，`EVEN`+`TYPE` 只用于真正的非标准事实，且 `EVEN`/`FACT` 必须带 `TYPE` |
| M4 | `附件:L90`、`L1052` | 「见第 6 章」——第 6 章不存在 |
| M5 | `附件:L62` | HEAD/SCHMA 映射到 `gedcom_export`，但该表没有 header 列（`附件:L926-946`），导出 HEAD 无定义 |
| M6 | `附件:L618`、`L641` | 保留 `submitter` 表，导出却取当前用户 → SUBM xref 往返在设计上就丢了 |
| M7 | `附件:L886` | NOTE 形态导出规则自相矛盾（同句先说恢复 `gedcom_form`，后说按链接数决定） |
| M8 | `附件:L962` | `raw_text` 没有失效标记：任何编辑之后，按原文导出会覆盖用户修改，按表导出会丢未映射结构——这才是 `L1052` 真正承认的洞 |
| M9 | `附件:L1530` vs `L1506`/`L1510` | `parent_child_edge` 是视图，却被示例当表查询；且视图创建在依赖它的示例之后，`L1713` 的「按章节顺序执行」不成立 |
| M10 | `附件:L1123` | `legitimacy`（嫡/庶）挂在 `lineage_person`（谱系范围）上，而它是出生家庭的事实；同一人进两个谱系时值会打架 |

---

## 5. 中文宗族表达力（6/10）

骨架是对的：谱系 → 房支 → 落位、派语按代取字、承嗣类型、嫡庶、生母/嫡母分离、「配王氏」这类省略式都能表达。缺的是**结构性**的两条与**词汇**的若干条。

| # | 概念 | 现状 | 严重度 | 建议 |
|---|---|---|---|---|
| C1 | **兼祧 / 一支两祧** | `UNIQUE (lineage_id, person_id)`（`附件:L1136`）+ 单个 `placement_family_child_id`（`L1120`）+ 「不产生第二个落位」（`L1193`）⇒ **结构上不可能**让一人在本生父与嗣父下各出现一次 | **Critical** | 去掉该唯一键，改 `lineage_person_placement(lineage_person_id, branch_id, family_child_id, placement_kind natural/heir/dual, is_primary)`；渲染 N 条、标「兼祧」 |
| C2 | 排行/行第 | 只有 `sort_order`（显示序），无行第 | 高 | `birth_order` + `birth_order_scope` + `birth_order_text`（伯/仲/叔/季） |
| C3 | 失考 / 待考 | 无标记，`full_name NOT NULL` 逼人填占位名 | 高 | 事实级 `data_status`（已知/失考/待考）——A2.1 落在 `event` 上 |
| C4 | 派语按房支 | `generation_poem.lineage_id` 单层 | 中 | 加 `branch_id` + 代际区间 |
| C5 | 字辈字位置 | `generation_char` 不记录在名中的位置 | 中 | `generation_char_position` + 与 `given_name` 的一致性校验 |
| C6 | 平妻/童养媳/改嫁 | `partner_role` 只有正妻/继室/妾/入赘 | 中 | 补 `equal_wife`、`child_bride`、`union_outcome` |
| C7 | 承重孙/入赘承嗣/外孙承祧 | `succession_type` 只有 4 值 | 中 | 扩枚举 |
| C8 | 避讳 | 无 | 中 | 谱系级 `taboo_char`，渲染与校验都用 |
| C9 | 学名/官名 | `name_type` 无 | 中 | 补 `school_name`/`official_name`（A2.1 枚举已含） |
| C10 | 农历↔公历确定性 | `date_cn` 有年号/干支/闰月/时辰，但无年号→公历年表、无闰月算法、干支脱离年号有 60 年歧义、`before/after/range/period` 没有推导规则（只举了「已知年」一例，`附件:L523`） | 高 | `era` 参考表 + 每条 qualifier 的推导规则 + 冻结转换库版本（A2.1 只做边界语义，转换推迟） |

---

## 6. 与本仓库的映射与硬冲突

### 6.1 层级映射

| 附件 | 本仓库 | 判据 |
|---|---|---|
| `organization`（`附件:L155-178`） | `organization`（`lib/db/schema.ts:57-85`） | 1:1；本仓库另有 20 位 `slug` 公开 ID |
| **`genealogy`** | **`project`**（`lib/db/schema.ts:215-253`） | 唯一自洽的读法：两者都是「所有业务表之下的那个容器」，`ON DELETE RESTRICT` 也对得上 |
| `lineage` | `lineage`（`lib/db/schema.ts:290-323`） | 同概念（姓氏/字辈/堂号），但附件在建谱系时自动建默认谱系、人必须经 `lineage_person` 进入；本仓库谱系由用户显式创建 |
| `lineage_branch` | 无 | 本仓库没有房支实体（只有 `generation_words` jsonb） |
| `person` + `lineage_person` | `node`（`lib/db/schema.ts:325-414`） | 附件 `person` 是**家谱级共享**、本仓库 `node` 是**谱系级**（`lineage_id NOT NULL`）——不可调和 |
| `member` | `organization_member`（`lib/db/schema.ts:155-182`） | 角色枚举相同 |

**附件 `L3`「产品文案称项目，实现层对应租户表 organization」在本仓库是错的**：项目 = `project`，有自己的 20 位 `ref` 和 URL 段。采纳附件时把 `genealogy` 当**文档别名**，不改表名、不改 URL。

### 6.2 硬冲突

| # | 冲突 | 证据 | 处理 |
|---|---|---|---|
| X1 | `render_job`、`gedcom_import` 流水线、周期校验、purge 服务都预设后台 worker | 附件 `L1345`/`L894`/`L414`/`L1715` vs [ADR 0005](../decisions/0005-zero-background-jobs.md) + AGENTS §8 | 不采纳；将来要做先写新 ADR + 调度器 + 失败告警 |
| X2 | purge 硬删 + `app.purge` 旁路 | 附件 `L46-55`、`L1634` vs [ADR 0004](../decisions/0004-soft-delete-forever.md)，且 `app_rw` **没有 DELETE 权限**（`lib/db/migrations/0001_auth_rls.sql:406`） | 不采纳；本仓库答案是软删 + runbook |
| X3 | RLS 机器名与根键不同：`app_user` + `member` + `app.readable_genealogy_ids()`，以 `genealogy_id` 为根 | 附件 `L1552-1616` vs `app_rw` + `organization_member` + `auth.has_org_role`（`0001_auth_rls.sql:1-8`、`490-513`；`0003_better_auth.sql:71-82`） | 附件 SQL 在本仓库**不可执行**（没有 `member` 表）；新表按 `0001` 的三段式 policy + `FORCE RLS` 写 |
| X4 | `gen_random_uuid()` | 附件 `L37`、`L1434`、`L1459`、`L1475` vs `lib/db/schema.ts:31` `uuidv7()` | 机械替换 |
| X5 | `row_version` + `app.touch_row()` 乐观锁 | 附件 `L38-45`、`L1681-1694` vs [ADR 0002](../decisions/0002-no-edit-lock.md)（明确不做并发控制、不加版本列） | 不采纳；若将来要，先改 ADR 0002 |
| X6 | `change_log` 全行审计 | 附件 `L1474-1488`、`L1697-1708` vs `docs/data-model.md` §628-636 与 `activity_logs` 明确「不是审计」 | 不采纳；`activity_logs` 是产品活动流，语义不同 |
| X7 | 对象存储（Supabase Storage） | 附件 `L803` vs `package.json` 无存储 SDK、[ADR 0009](../decisions/0009-dependency-and-runtime-stance.md) 把对象存储推到 M3 | `media*` 三张表推迟到存储 ADR 之后 |
| X8 | `person_name.search_text` + GIN trgm | 附件 `L258` vs [ADR 0011](../decisions/0011-search-boundary-node-client-article-trgm.md)（搜索边界在客户端，`0013_drop_node_trgm.sql` 刚删掉 node 的 trgm） | A2.1 不建 trgm 索引 |
| X9 | F6 单文件 ≤400 行，`lib/db/schema.ts` 现 688 行且豁免只许缩 | `scripts/check-file-size.mjs:27` | 任何 ~40 表采纳之前必须先拆分 schema（A1 spec §11 已列为第一步） |

### 6.3 附件缺而本仓库有的能力

`article` 谱文、`folder` 分类树、`book_catalog` 编目弧（`lib/db/schema.ts:483-536`，支撑「改一处谱系、多本书同步」）、`activity_logs` 活动流、20 位公开 ID + `isPublicId()` 门禁、`node_count` 计数器与对账、回收站/编辑锁的既定立场。**附件不能替代这些**，采纳时不得回退。

---

## 7. 采纳决策表

| 域 | 决策 | 说明 |
|---|---|---|
| `event` + `event_participant` + 日期四件套 | **修正后采纳**（A2.1） | 去掉 `event_scope`，主体二选一 + `num_nonnulls=1`；qualifier→边界写成 CHECK；`event_kind` 降级为 TS 常量；补 `data_status`（失考/待考） |
| `person_name` | **修正后采纳**（A2.1） | 补软删、`custom_type` CHECK、主名切换规则；不建 trgm |
| `place` | **修正后采纳**（A2.1） | 补 `form_jurisdictions text[]`、软删；`place_name` 推迟 |
| `place_name`、`source`、`citation`、`citation_link`、`repository`、`source_repository`、`submitter` | **修正后采纳**（A2.2） | 弧用 `num_nonnulls` + `NULLS NOT DISTINCT`；每张表补 `UNIQUE (organization_id, id)` |
| `note`/`note_link`、`media*` | **推迟** | 前者 A2.2 之后，后者等存储 ADR |
| `lineage_branch`、`generation_poem(_item)` | **采纳**（A2 之后、独立增量） | 纯加法，不依赖 A1 |
| `gedcom_*`、`external_id` | **推迟到 A3** | 需先解决 X1（后台任务）与 M8（`raw_text` 失效标记） |
| `family_partner`、`lineage_person`（家谱级 person） | **不采纳** | 会重开 A1 的关系层 |
| `render_job`、purge、`change_log`、`row_version` | **不采纳** | X1/X2/X5/X6 |
| `book_edition`/`book_section`/`book_content`/`publication_snapshot` | **不采纳** | 与现有 `book` + `book_catalog` 冲突，且属 M3 排版域 |
| `validation_issue`、`person_merge_log` | **记录备查** | 形状可参考，功能未排期 |
| `lineage_person_placement`（C1 的修法） | **必须采纳**（A3 之前） | 兼祧是中文宗族的硬需求，A1 的「只表达关系不表达多处出现」是已知妥协 |

---

## 8. 优化路线

### 8.1 四步

1. **A1 关系层照原样落地**（[spec](../superpowers/specs/2026-10-29-person-family-model-design.md)），第 0 步拆 `lib/db/schema.ts`——否则 F6 挡住后面所有表。
2. **A2.1 生平层**（[计划](../superpowers/plans/2026-10-29-a2-lifespan-layer.md)）：先补租户列不可变触发器（P0-1 本仓库同样中招），再上 `person_name`/`place`/`event`/`event_participant`，回填 `node` 的扁平生卒列，只读展示 + 最小编辑。
3. **A2.2 史料层**：`source`/`citation`/`citation_link`/`repository`/`submitter` + `place_name`/`person_name_translation`；同时把 `citation_link` 的弧模式固定下来。
4. **A3 适配层**：`gedcom_*` + `external_id`，前置条件是 X1 的 ADR 与 M8 的失效标记；同批做 `lineage_person_placement`（兼祧）。

### 8.2 需要补的 ADR

| 编号 | 主题 | 触发原因 |
|---|---|---|
| 0014 | `person_tree` 的 DELETE 权限例外 | A1 spec 已列 |
| **0015** | **事件与日期语义**：`(date_start, date_end)` 是闭区间边界、qualifier 决定哪端为空、精度只影响展示 | P1-4 |
| **0016** | **租户列不可变**：`organization_id`/`org_id` 一旦写入不允许 UPDATE，用触发器兜底而不是只靠 RLS `WITH CHECK` | P0-1（本仓库存量表也缺） |
| 0017 | 会话身份的信任边界：为什么接受 `set_config('request.jwt.claims', …)` + `SET LOCAL ROLE`，以及什么情况下必须换成 definer 身份表 | P0-2 |
| 0018 | 在世者隐私阈值与字段级脱敏矩阵 | §4.1 最后一行 |
| 0019 | 审计与变更日志的取舍（拒绝 `change_log` 的理由与替代方案） | X6 |

---

## 9. 评审局限与开放项

- **没有跑过这份 DDL。** 附件 SQL 引用的 `member` 表、`app.user_id` 约定、Supabase Storage 在本仓库都不存在，全部结论基于静态阅读 + 与 `0001_auth_rls.sql`/`0003_better_auth.sql` 的对照。
- **GEDCOM 侧只对照了 v7 规范的结构定义与枚举**，没有拿真实 `.ged` 样本做往返测试；「导出有损」的具体损失面需要 A3 用样本量化。
- **`person.primary_name_id` vs 部分唯一索引**：本评审选了后者（避免循环外键），代价是「零个主名」只能靠应用规则 + 测试守住。若将来切换主名的并发场景真的出现，再评估 `DEFERRABLE` 约束方案。
- **附件第 6 章无法评审**——它不存在。隐私阈值、脱敏矩阵、保真等级这三件事在本仓库也还没有答案，见 §8.2 的 0018/0019。
- 中文宗族侧的 10 条（§5）只做了「能不能表达」的判断，没有做「怎么在 UI 上呈现」的设计；兼祧的渲染形态需要单独的产品讨论。
