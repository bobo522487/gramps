# Person + Family 关系模型（A1 期）设计

> **状态**：已定稿，待批准实施 · 2026-10-29
> **范围**：项目级改造（数据模型 + 谱系域读写重写 + 数据迁移），不是一次功能改造
> **相关**：ADR [0003](../../decisions/0003-tree-storage-ltree.md)（被本文取代）· [data-model.md](../../data-model.md) §7 · [05-data.md](../../architecture/05-data.md) §8.4 §8.5 · [08-evolution.md](../../architecture/08-evolution.md) · [decisions/README.md](../../decisions/README.md) D-4

> **基线声明**：本文的「现状」以**代码**为准（`lib/db/schema.ts:325-414`、`lib/lineage/node-services.ts`、`lib/db/migrations/0010_redundant_iron_man.sql`），不以 `docs/data-model.md` 为准——后者已过期（见 §10.1）。

## 1. 意图与理由

现状把「关系」编码成 `node` 表上的列：`parent_id`（父）、`spouse_of_id`（配偶）、`role`（`blood` / `spouse`）、`path`（`ltree` 父系路径）。ADR 0003 已把这一选择标注为**单向门**，并在「负面后果」里逐条列出表达不了的情形：过继/嗣子、兼祧、入赘、女儿入谱后子女成支。

这不是「以后可能用到」的预留，而是两个已确认的产品事实：

1. 族谱里过继、兼祧、入赘是常态，不是边角。第一个提出来的客户就会把我们挡在门外。
2. 目标产品从「印书 SaaS」扩为**通用家谱库**——要能和 Gramps / webtrees 互换数据。这两者的数据形状都是 GEDCOM 的 **Person + Family**（`INDI` 经 `FAMC` / `FAMS` 挂 `FAM`，`FAM` 持 `HUSB` / `WIFE` / `CHIL`）。把关系存在 `node` 的列上，导出时要从「节点属性」反推 `FAM`，反向导入更难。

**这次改造买到的东西**：过继/兼祧/入赘可表达；GEDCOM 导出近乎直译；关系操作（认亲、改嫁、立嗣）有语义位置可放。

**明确买不到的东西**：A1 不改生平/史料层（`event` / `place` / `source`），也不做 GEDCOM 导入导出本身——那两件是 A2 / A3。A1 只换**关系层**。

## 2. 已定决策（人类伙伴已确认，不再讨论）

1. **A 分期**：A1 关系层（本文）→ A2 事件与史料层 → A3 GEDCOM 适配器。
2. **一个 `lineage` = 一个 GEDCOM 文件；`person` 归属 `lineage`。** 即 `person.lineage_id NOT NULL`，不采用「`person` 属于组织、经 `lineage_person` 入谱」的多谱系共享方案。
3. **先改目标架构文档，确认没有问题再改代码。** 落地顺序：本文批准 → 修文档（§10）→ 实现计划 → 代码。
4. **A1 只放宽数据库的性别约束，录入 UI 保持男/女**（§15 Q1）。同性别、未知性别的录入留到 A2。
5. **删除门槛看直接子女**：有存活的直接子女就拒绝删除；「整支删除」A1 不做（§15 Q2）。
6. **A1 交付三件关系操作的 UI**：新增子女时可指定另一位亲本、检查器里的过继/立嗣、解除关系（§15 Q3）。

## 3. 目标 / 非目标 / 反目标

**目标**

- 关系层换成 `person` + `family` + `family_child`，形状对齐 GEDCOM，过继/兼祧/入赘可表达。
- 已有 `node` 数据**无损**迁移：人数、父子关系、配偶关系、排行、软删状态一条不少。
- 画布、世系表、检查器、搜索定位、打印视图、按代渲染在迁移后**全部照常工作**。
- `node` 表在 A1 结束时退役，库里只有一套可写的关系模型。

**非目标**

- `event` / `place` / `source` / `citation` / `person_name`（多姓名）——A2。
- GEDCOM 5.5.1 导入 / 导出（A3）。
- 跨谱系联宗、跨 `lineage` 的人物共享。
- **同一谱系内两个血亲之间的婚姻**（堂兄妹联姻等）：现状的 `spouse_of_id` 结构就表达不了（配偶恒为 `role='spouse'`），A1 不扩大这个范围，见 §4.2 的「恰好一方是血亲」规则。
- 母系祖先链的路径缓存（见 §8 的取舍）。
- 谱文、谱书、编目、回收站、编辑锁、分享（M2/M3 范围，不受本文影响）。

**反目标**

- 出现两套**可写**的关系模型（`node` 与 `person/family` 同时接受写入）。读路径可以有投影 DTO，数据库不行。
- 迁移后「数据在库里但画布上看不见」——对账脚本必须零差异才算完成。
- 迁移脚本不可重复执行、或在迁移文件里夹带数据回填（违反 `data-model.md` §13）。

## 4. 目标数据模型（A1）

四张表：`person`（人）、`family`（婚姻单位）、`family_child`（亲子边）、`person_tree`（父系投影缓存）。

### 4.1 person

一个人 = GEDCOM 的一条 `INDI`。姓名与生平保持扁平列（**有意的中间态**，A2 才抽成 `event` / `person_name`），这样 A1 不必同时改姓名 UI 与生平 UI。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid PK DEFAULT uuidv7()` | 迁移时保留原 `node.id`，便于追溯 |
| `organization_id` | `uuid NOT NULL` | 租户隔离，RLS 依据 |
| `lineage_id` | `uuid NOT NULL` | person 归属谱系（已定决策 2） |
| `role` | `text NOT NULL DEFAULT 'blood'` | `blood`（本支，有世次）/ `spouse`（姻亲，无世次）。**显式状态，不是推导出来的**，理由见 §4.1.1 |
| `sex` | `smallint NOT NULL DEFAULT 2` | `0` 男 / `1` 女 / `2` 未知。放宽自现状的 `IN (0,1)` |
| `surname` / `name` / `full_name` | `text NOT NULL` | 与 `node` 同名同义，UI 零改动 |
| `courtesy` / `name_prefix` | `text` | 字、称谓前缀 |
| `is_alive` | `boolean NOT NULL DEFAULT true` | |
| `birth_text` / `death_text` | `text` | A2 迁到 `event` |
| `birth_year` / `death_year` | `integer` | A2 迁到 `event` |
| `burial_place` | `text` | A2 迁到 `event` + `place` |
| `biography` | `text` | |
| `created_at` / `created_by` / `updated_at` / `deleted_at` | | 与现有业务表一致 |

**不迁移 `node.attributes`**：该列已在 `0010_redundant_iron_man.sql` 删除（当年判定为死列）。A1 不重新引入——没有读方的列加上就是负债。人丁自定义字段是独立需求（`docs/implementation-status.md` 的未实现项），届时再设计。

#### 4.1.1 为什么 `role` 必须是显式列

有人会想「血亲还是姻亲，从图里推得出来」——推不出来。一个没有亲子边的人可能是**没有配偶的始祖**（本支，要有 `path`），也可能是**嫁进来的配偶**（姻亲，不能有 `path`）；两者在图上同形。递归推导也会打转（判断 A 是否血亲要先知道 A 的父母是否血亲）。

所以 `role` 是**事实**，不是派生值：它是「这个人在本谱里有没有世次」这一句判断的存储形式。GEDCOM 没有对应字段——导入时按规则定：有 `FAMC` → `blood`；无 `FAMC` 但有 `FAMS` → `spouse`；都没有 → `blood`（始祖）。导出时丢弃，不污染 GEDCOM。

**`person_tree` 有行的充要条件是 `person.role = 'blood'`。** 这条让 `person_tree` 保持「纯缓存」身份：删掉它，`role` 仍在，只是变慢。

### 4.2 family

一个 `family` = GEDCOM 的一条 `FAM`：一对配偶 + 他们的子女。**子女不放在这一行**，见 4.3。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid PK DEFAULT uuidv7()` | |
| `organization_id` / `lineage_id` | `uuid NOT NULL` | |
| `husband_id` | `uuid NULL` | `FAM.HUSB`，指向 `person` |
| `wife_id` | `uuid NULL` | `FAM.WIFE`，指向 `person` |
| `sort` | `integer NOT NULL DEFAULT 0` | 本支一方名下的配偶展示序（原 `node.sort` 的配偶侧语义） |
| `created_at` / `created_by` / `updated_at` / `deleted_at` | | |

**A1 硬规则：每条 `family` 恰好一方 `role='blood'`。** 由应用层在同一事务内校验，并必须有集成测试。三个后果都是好的：

1. **`path` 的上一跳有唯一答案**：`family` 的血亲方。与父/母性别无关，所以**入赘天然可表达**——女方为 `blood`、男方为 `spouse`，子女的 `path` 沿母亲走。
2. **`sort` 只有一个 owner**（血亲方），不会出现「一条 `family` 两套排序」。
3. **配偶的世代**由血亲方决定，不用猜。

代价：血亲与血亲通婚表达不了。这是现状就有的限制（`spouse_of_id` 的配偶恒为 `role='spouse'`），A1 明列为非目标。

`husband` / `wife` 是**角色不是性别**：GEDCOM 的 `HUSB` / `WIFE` 也不校验性别。不写「husband 必须 `sex=0`」这类 CHECK——那正是现状表达不了入赘的根因之一。

### 4.3 family_child

亲子边。**用边表而不是 `family.children` 数组**，理由有两条且都是硬需求：

1. 边的属性（`parentage_type`、排行）没有别处可放。
2. GEDCOM 允许一个人出现在多条 `FAMC` 里（生父母 + 养父母），数组做不到。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid PK DEFAULT uuidv7()` | |
| `organization_id` / `lineage_id` | `uuid NOT NULL` | |
| `family_id` | `uuid NOT NULL` | |
| `person_id` | `uuid NOT NULL` | 孩子 |
| `parentage_type` | `text NOT NULL DEFAULT 'birth'` | `birth` / `adoptive` / `foster` / `step` / `traditional` / `unknown` |
| `is_primary` | `boolean NOT NULL DEFAULT true` | 承继边：`person_tree` 的 `path` 沿这条边走（§8） |
| `sort` | `integer NOT NULL DEFAULT 0` | 排行（原 `node.sort` 的子女侧语义） |
| `created_at` / `created_by` / `updated_at` / `deleted_at` | | |

`parentage_type` ↔ GEDCOM `PEDI`：`birth`→`birth`，`adoptive`→`adopted`，`foster`→`foster`，`step`→`step`，`traditional`（嗣子/过继/兼祧）在 GEDCOM 无对应值，导出时落 `adopted` 并在 `NOTE` 保留原文——A3 处理。

**`is_primary` 的作用**：一个人可能有多条亲子边（生父 + 养父），但画布上只能站在一个位置。`is_primary` 显式标记「谱书上算哪一支」，不让程序靠 `parentage_type` 猜。约束（应用层）：每个 `role='blood'` 的人**至多一条** `is_primary` 边；没有 `is_primary` 边的人即本谱始祖（现状「一个谱系一个始祖」的限制不变）。

### 4.4 person_tree（派生缓存）

| 列 | 类型 | 说明 |
|---|---|---|
| `person_id` | `uuid PK` | 指向 `person` |
| `organization_id` / `lineage_id` | `uuid NOT NULL` | |
| `path` | `ltree NOT NULL` | 父系链的 person id 序列 |
| `depth` | `integer GENERATED ALWAYS AS (nlevel(path) - 1)` | 与现状 `node.level` 同款生成列 |
| `generation` | `integer NOT NULL` | 世次 |

**判定标准（加这张表的唯一理由）**：删掉它，功能不变、只是变慢。没有这一条就不许加。

**为什么 A1 保留 `path`**：ADR 0003 的读性能结论仍然成立——按代渲染、世系表、祖先链都靠它；删掉它意味着把 6600 行里所有读取改成递归 CTE，那是另一场改造。**代价写在 §8**：它只覆盖父系。

**这张表的写权限是破例的**（见 §4.6）：它是缓存，不适用「业务表只软删」的约定，需要 `DELETE` 权限。

### 4.5 约束与索引清单

| 表 | 约束 / 索引 | 意图 |
|---|---|---|
| person | `UNIQUE (organization_id, id)`、`UNIQUE (organization_id, lineage_id, id)` | 让复合外键可指向 person |
| person | `FK (organization_id, lineage_id) → lineage(organization_id, id)` ON DELETE RESTRICT | 跨谱系挂人不可能发生 |
| person | `CHECK ck_person_role (role IN ('blood','spouse'))` | |
| person | `CHECK ck_person_sex (sex IN (0,1,2))` | |
| person | `INDEX (organization_id, lineage_id) WHERE deleted_at IS NULL` | 列表与画布 |
| family | `UNIQUE (organization_id, lineage_id, id)` | 同上 |
| family | `FK (organization_id, lineage_id, husband_id) → person(organization_id, lineage_id, id)` | 配偶必须同谱系 |
| family | `FK (organization_id, lineage_id, wife_id) → person(...)` | 同上 |
| family | `CHECK ck_family_has_spouse (num_nonnulls(husband_id, wife_id) >= 1)` | 无配偶的 `family` 是脏数据 |
| family | `CHECK ck_family_spouses_distinct (husband_id IS DISTINCT FROM wife_id)` | 自己不能和自己结婚 |
| family | `UNIQUE NULLS NOT DISTINCT (organization_id, lineage_id, husband_id, wife_id) WHERE deleted_at IS NULL` | 同一对配偶只有一条 `family`；`NULLS NOT DISTINCT` 让「单亲」也能去重 |
| family | `INDEX (organization_id, lineage_id, husband_id)`、`INDEX (organization_id, lineage_id, wife_id)` | 找某人的所有婚姻 |
| family_child | `FK (organization_id, lineage_id, family_id) → family(organization_id, lineage_id, id)` | |
| family_child | `FK (organization_id, lineage_id, person_id) → person(organization_id, lineage_id, id)` | |
| family_child | `CHECK ck_family_child_parentage (parentage_type IN ('birth','adoptive','foster','step','traditional','unknown'))` | |
| family_child | `UNIQUE (organization_id, family_id, person_id) WHERE deleted_at IS NULL` | 同一对亲子只有一条边 |
| family_child | `INDEX (organization_id, person_id)` | 查某人的父母 |
| person_tree | `FK person_id → person(id)` ON DELETE CASCADE | 缓存跟着人走（硬删时才触发） |
| person_tree | `INDEX USING GiST (path)`、`INDEX (organization_id, lineage_id, generation)` | 与现状 `idx_node_lineage_path` / `idx_node_lineage_depth` 等价 |

**不写进数据库的约束**（重要，都靠应用层 + 集成测试）：

1. 不能成为自己的祖先。递归检查必须在同一事务内用递归 CTE 做；`CHECK` 与触发器拦不住（PostgreSQL 行级约束看不到整张图）。
2. 每条 `family` 恰好一方 `role='blood'`。
3. 每个 `role='blood'` 的人至多一条 `is_primary` 亲子边。

### 4.6 RLS 与缓存表的 DELETE 例外

`person` / `family` / `family_child` 三张表 `ENABLE` + `FORCE ROW LEVEL SECURITY`，策略形状与现有 `node` 完全一致（`lib/db/migrations/0001_auth_rls.sql:493` 那段 `FOREACH` 循环）：`SELECT` 四角色、`INSERT` / `UPDATE` 三角色，均用 `auth.has_org_role(organization_id, ...)`；不建 `DELETE` 策略（软删）。

新表自动继承 `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE`（`0001_auth_rls.sql:412`），不需要逐表 `GRANT`。

**`person_tree` 例外**：额外 `GRANT DELETE` 给 `app_rw` 并建 `person_tree_delete` 策略（三角色）。理由：它是缓存，行必须能真正消失——软删会让 `path` / `generation` 残留脏值。这是对「业务表只软删」约定的一次**有意破例**，写进 ADR 0014，不要让后来的人以为是漏改。

## 5. 从 `node` 迁移

### 5.1 行级映射

| `node` | 去向 | 规则 |
|---|---|---|
| 每一行（`role` 为 `blood` 或 `spouse`） | `person`（1:1） | `id` 原样保留；`role` / `sex` / 姓名 / 生平 / `deleted_at` 原样带过 |
| `parent_id` | `family(husband_id = parent_id, wife_id = NULL)` | 现状**没有** `mother_id`，所以迁移出来的每条 `family` 都是父系单亲，`wife_id` 全空。这是保真，不是缺陷 |
| `role='blood'` 且非始祖 | `family_child(family, person_id = node.id, parentage_type='birth', is_primary=true, sort = node.sort)` | |
| `role='spouse'` 的 `spouse_of_id` | 该配偶与 `spouse_of_id` 组成的 `family` | 若已存在同 (夫, 妻) 的 `family` 则复用，否则新建 |
| `node.sort`（spouse 侧） | `family.sort` | 配偶在本人名下的序 |
| `path` / `depth` / `generation` | `person_tree` | **重算，不复制**——`path` 里是 node id，语义已变 |
| `lineage.node_count` | 重算 | 改为 `person` 计数（含配偶，排除软删），语义与现状一致 |

### 5.2 边界情形（迁移脚本必须逐条处理）

1. **软删节点** → 一并迁移并保留 `deleted_at`。漏掉会让存活节点的关系断裂。
2. **孤儿配偶**（`spouse_of_id` 指向已软删节点）→ 保留 `person` 与 `family`，记入对账清单。
3. **一个血亲有多个配偶** → 每个配偶一条 `family`，`family.sort` 取原 `node.sort`。
4. **`spouse_of_id` 指向的节点本身是 `role='spouse'`** → 现状写入路径保证不会发生；迁移时记入对账清单并跳过，不猜。
5. **`sex` 异常值**（`ck_node_sex` 保证只有 0/1，理论不会发生）→ 按 `role` 决定 `husband` / `wife`：血亲方的性别决定角色，配偶取反。

现状数据里**不可能**出现、因此不进迁移脚本的情形（它们是 A1 之后新录入才可能产生的）：母系单亲、同父异母、同母异父、同性别配偶、双血亲婚姻。把不存在的分支写进迁移脚本只会制造无人验证的代码。

### 5.3 对账（迁移完成与否的唯一判据）

- `count(person)` == `count(node)`（含软删）。
- 每个非始祖 `role='blood'` 节点，有且仅有一条 `is_primary` 的 `family_child`。
- 父子对集合相等：`{(node.parent_id, node.id)}` == `{(family 血亲方, family_child.person_id)}`。
- 配偶对集合相等：`{(node.spouse_of_id, node.id)}` ⊆ `{(husband_id, wife_id)}`（无序）。
- `person_tree` 里每一行的 `path` 末端 == 该 `person_id`，父链连续，`generation` 与 `depth` 自洽。
- 无 `role='spouse'` 的人拥有 `person_tree` 行。

对账脚本放在 `data/`（与迁移分开），可重复执行，输出差异明细而不是只报个数字。

### 5.4 执行顺序与回滚

1. **前置**：拆分 `lib/db/schema.ts`（688 行已顶满 F6 豁免预算，再加四张表会直接让 `pnpm arch:check` 失败，见 §11）。
2. DDL 迁移：建四张表 + RLS + `person_tree` 的 DELETE 例外（**不含任何数据回填**，遵守 `data-model.md` §13）。
3. `data/backfill-person-family` 脚本：按 §5.1 回填，可重复（`ON CONFLICT DO NOTHING`）。
4. 对账脚本零差异。
5. 切换读路径（§6），跑完整测试套件。
6. 切换写路径（§7）。
7. `node` 置为只读（RLS 收紧为仅 `SELECT`），保留一个版本周期。
8. 删表。

**回滚点**：第 7 步之前，`node` 未被写入破坏，删掉新表即可回到现状。ADR 0003 说换模型是单向门，分期迁移把它降级为**可回滚的两段式**。

## 6. 读路径

**关键省钱点**：在 query 层把 `person` + `family` + `person_tree` 投影成**现有的树形 DTO**（字段名、嵌套形状都不变），让画布、世系表、检查器、打印视图只改数据来源，不改渲染算法。这不是「双模型」——数据库只有一套可写模型，投影只活在查询函数的返回值里。

| 现状 | 改法 |
|---|---|
| `getNodes(lineageId)`（`lib/db/queries/nodes.ts:7`） | 改为查 `person` LEFT JOIN `person_tree` LEFT JOIN 其作为配偶的 `family`，返回同形状 DTO |
| `node.role` → DTO 的 `role`（`components/lineage/types.ts:9`） | 直接来自 `person.role`，**不需要推导** |
| 画布按 `path` / `generation` 分层 | 数据来自 `person_tree`；配偶无投影行，世代 = 其 `family` 血亲方的 `generation` |
| 排行 `sort` | 血亲取 `family_child.sort`，配偶取 `family.sort` |
| 检查器展示父母子女配偶 | 新增查询：某 `person` 的父母（`family_child` → `family`）、子女、配偶（`family`） |
| `lineage.node_count` | 改为 `person` 计数，同一事务维护 |

**三条读路径纪律**：

1. **一律 JOIN `person` 并过滤 `person.deleted_at`**，不单靠 `person_tree` 的清理。缓存清理出错时，读路径不会把已删的人画出来。
2. **配偶与血亲必须一次查回**，不能分两次查——分两次会在「配偶的配偶」这类边界上错位。
3. 所有读路径都要能容忍「`role='blood'` 但暂时没有 `person_tree` 行」（重建过程中），此时按始祖处理，不崩。

## 7. 写路径

全部走 Server Action → `lib/db/queries/<domain>.ts`（`withOrg` 内），多步写在单事务里（AGENTS §5.2）。

| 操作 | 事务内做的事 |
|---|---|
| 新增人物 | `INSERT person` →（若给了父母）找/建 `family` → `INSERT family_child` → 重算该子树 `person_tree` |
| 编辑人物 | `UPDATE person`；改姓名不影响投影 |
| 删除人物 | 见下方「删除语义」 |
| 新增配偶 | 找/建 `family`（含 `sort`）；配偶无投影行，通常无需重算 |
| 认亲 / 改父母（原「移动节点」） | `UPDATE family_child.family_id`（或新建 `family`）→ **重算受影响子树** → 校验防环 |
| 立嗣 / 过继 | 新增一条 `family_child`（`parentage_type='traditional'` 或 `'adoptive'`），`is_primary` 由调用方指定 |
| 解除关系 | 软删对应 `family_child` / `family`；若失去唯一 `is_primary` 边，把该人**降级为新始祖**（`UPDATE person_tree` 为 `path = 自己 id`、`generation = 1`），不是删行 |

**删除语义**（已定，见 §15 Q2）：删除 `person` 时，同一事务内——作为孩子的亲子边软删；作为配偶的 `family`，若另一方仍在则清空该位，若 `family` 已无配偶则软删 `family`；**有存活直接子女的人不能直接删**，要先解除关系。门槛只看**直接子女**，不递归整棵子树。「整支删除」A1 不做。

**防环**：认亲/改父母时，用递归 CTE 判断「目标父/母是否是自己或自己的后代」，是则拒绝并返回中文提示。必须与写入同一事务，且必须有集成测试。

**`person_tree` 的重算**：只重算受影响子树，用 `INSERT ... ON CONFLICT (person_id) DO UPDATE` + `DELETE` 掉不再属于本支的行（这就是需要 `person_tree` 的 DELETE 权限的原因）。

## 8. 世代与路径的派生规则

`person_tree` 的算法：

- **始祖**：`role='blood'` 且没有 `is_primary` 亲子边的人（现状「一个谱系一个始祖」的限制不变）。
- `path` = 血亲父/母的 `path` 拼接 `person.id`；`depth = nlevel(path) - 1`。
- `generation` = 血亲父/母的 `generation` + 1（与现状 `lib/lineage/node-services.ts:344` 的 `parent.generation + 1` 一致；`lineage.hang_rule` 已在 `0010` 删除，不再参与计算）。
- **只沿 `is_primary` 边，且取该 `family` 的血亲方**（§4.2）。因此入赘（母方为血亲）与普通父系走同一段代码，不需要分支。

**明确的取舍**（要写进 ADR）：

- `path` / `generation` **只表达父系/承继主系**。谱书的「主线」就是这一条，所以缓存值得留；但**母系祖先链、过继支的祖先链必须走递归 CTE**，不能指望 `path`。别让后来的人以为 `path` 是完整家谱。
- **兼祧在 A1 只表达关系，不表达「多处出现」**：一人可以有多条亲子边，但 `person_tree` 只有一行，谱书上只出现在 `is_primary` 那一支。真正的「一支人出现在两处」是排版层问题，A2 再处理。

## 9. 分期边界

| 期 | 内容 | 依赖 |
|---|---|---|
| **A1（本文）** | `person` / `family` / `family_child` / `person_tree`；谱系域读写改造；`node` 退役；数据迁移 | — |
| **A2** | `event` / `place` / `source` / `citation` / `person_name`；生平扁平列迁入 `event`；日期四件套 | A1 稳定 |
| **A3** | GEDCOM 5.5.1 导入 / 导出 | A2 完成（没有 `event`/`source`，导出的 GEDCOM 是残缺的） |

A1 不改 `lineage` / `project` / `folder` / `article` / `book` / `book_catalog` 任何一列。M2 / M3 的加法迁移计划不受影响。

## 10. 连带文档改动（代码之前先做）

### 10.1 先修文档的过期内容（与本文无关的独立缺陷）

`docs/data-model.md` 仍在描述三个**已被删除**的列：`node.mother_id`、`node.attributes`、`lineage.hang_rule`（`lib/db/migrations/0010_redundant_iron_man.sql` 删除，`lib/db/schema.ts` 确认）。这是文档与代码不一致的既存缺陷，先修掉再谈新模型，否则下一份设计又会基于错的前提。

| 文档 | 改动 |
|---|---|
| `docs/decisions/0014-person-family-model.md` | **新建**：取代 ADR 0003，记录 Person+Family 决策、`role` 为何显式、`family` 恰好一方血亲、`is_primary`、父系 `path` 的取舍、`person_tree` 的 DELETE 破例、可回滚的两段式迁移 |
| `docs/decisions/0003-tree-storage-ltree.md` | 状态改为「被 ADR 0014 取代」，保留原文不删 |
| `docs/decisions/README.md` | D-4 关系模型 → 已决，指向 0014 |
| `docs/data-model.md` | 先删过期列（§10.1），再把 §7 `node` 章节重写为 `person` / `family` / `family_child` / `person_tree`；§14 数据字典同步；版本 1.6 → 2.0 |
| `docs/architecture/05-data.md` | §8.4 一致性（`person_tree` 重算取代 `path` 批量更新）、§8.5 容量口径（人数口径不变，行数变多） |
| `docs/architecture/08-evolution.md` | M2 / M3 表清单与里程碑说明 |
| `docs/prd.md` §6.3 | 补上 ADR 0003 遗留的欠账：过继/兼祧/入赘在 A1 后从「不支持」改为「支持」 |
| `docs/implementation-status.md` | 谱系域实现状态、表数量（11 → 14） |
| `AGENTS.md` | §1「谱系与人丁已有第一版」措辞、§5.5 查询域清单（`nodes.ts` → `persons.ts` / `families.ts`） |
| `docs/guides/add-a-feature.md` | 若引用 `node`，同步 |

## 11. 约束

- 组织级读写仍走 `withOrg` / `app_rw`；不碰 `auth.*`。
- 新表必须带 `organization_id` + 复合外键 + RLS（AGENTS 规则 10 / 1）。
- 主键 `uuidv7()`；业务表软删；查询默认 `isNull(deletedAt)`（`person_tree` 例外，见 §4.6）。
- 迁移只做 DDL，回填是 `data/` 脚本（`data-model.md` §13）。
- **`lib/db/schema.ts` 必须先在本次改造中拆分**：它 688 行、已在 `scripts/check-file-size.mjs` 的 F6 豁免名单里，而豁免预算**只许缩不许涨**——直接加四张表会让 `pnpm arch:check` 失败。拆成 `lib/db/schema/<domain>.ts` 并让 `drizzle.config.ts` 指向目录，是本改造的第一步。
- 新增代码按域拆分 `lib/db/queries/persons.ts` / `families.ts`，单文件 ≤ 400 行。
- 面向用户文案简体中文，数据库/日志英文；不回显堆栈。
- 每次提交前 `pnpm check && pnpm typecheck && pnpm test` 全绿；`pnpm docs:check --strict`、`pnpm arch:check` 无 issue。

## 12. 验收标准

- [ ] 对账脚本零差异：人数、父子对、配偶对、排行、软删状态全部一致。
- [ ] 迁移脚本在空库与有数据的库上都能重复执行，第二次执行零改动。
- [ ] 过继：给一个孩子挂两条亲子边（生父 `birth` + 养父 `adoptive`），世系表与检查器都能看到；谱书主线只入 `is_primary` 那一支。
- [ ] 入赘：女方为 `role='blood'`、男方为 `role='spouse'`，其子女的 `path` 沿母亲延伸（`person_tree.generation` 正确），画布上子女出现在母亲支下。
- [ ] 防环：把某人认到自己后代名下被拒绝，返回中文提示，库里无半成品数据。
- [ ] 新增子女时可指定另一位亲本，`family.wife_id` 被真正写入；随后能查回「同父异母」的兄弟姐妹。
- [ ] 检查器能发起过继/立嗣与解除关系，两者都只改 `family_child`，不改变画布位置（`is_primary` 决定位置）。
- [ ] 删除门槛：有存活直接子女的人删除被拒绝并给出中文提示；先解除关系后可删，且不留悬空引用。
- [ ] 跨组织：另一组织的用户读写 `person` / `family` 被 RLS 拒绝（集成测试）。
- [ ] 软删：删除人物后其亲子边、配偶关系符合 §7 删除语义，画布不出现悬空引用。
- [ ] `person_tree` 可整体重建：删掉所有行后跑重建脚本，与增量维护的结果逐行一致。
- [ ] 画布 2000 节点窗口、5 万人的谱系，按代渲染与世系表查询耗时**不劣于**迁移前（给出实测数字）。
- [ ] `node` 退役后全仓库无残留引用。
- [ ] `pnpm check && pnpm typecheck && pnpm test`、`test:integration`、`test:e2e`、`arch:check`、`docs:check --strict` 全绿。

## 13. 考虑过但没选的做法

| 做法 | 为什么放弃 |
|---|---|
| **从图里推导 `role`**（靠有无亲子边、`husband`/`wife` 位置判断血亲/姻亲） | 推不出来：无配偶的始祖与嫁入的配偶在图上同形；递归推导还会打转（§4.1.1） |
| **让 `person_tree` 承担 `role` 语义**（有行=血亲） | 那就不是缓存了，「删掉它功能不变」不再成立，重建脚本会改变业务语义 |
| **双模型**：`person/family` 权威 + `node/path` 只读投影（数据库层） | 两套表示要长期同步，投影漂移是最难查的一类 bug；本文只在 **query 层**做 DTO 投影 |
| **只做 GEDCOM 适配层**，内部仍是 `node` | 几周可交付，但过继/兼祧仍表达不了，导出时只能当生父——买到的只是「能换数据」，不是「结构对」 |
| **`person_parent` 边表**（附件 `PersonParent` 的主张） | 与 GEDCOM `FAM` 不直译：导出时要反推 `FAM`（哪两个配偶、`HUSB`/`WIFE` 是谁），导入时要正向猜；`family` 本身就是「婚姻单位」这一层语义，边表把它丢了 |
| **`person` 全局 + `lineage_person` 入谱**（附件主张） | 人类伙伴已定「一个 `lineage` = 一个 GEDCOM 文件」。代价：同一人在两套宗谱是两条 `person`，将来要跨谱系引用需另加 `person_link` |
| **保留 `node` 作为 `person` 的别名表**（不删表） | 两套可写模型，反目标 |
| **`family` 里存 `children uuid[]`** | 边的属性（`parentage_type`、排行）无处可放；一人多 `FAMC` 表达不了 |
| **允许双血亲婚姻**（放宽「恰好一方血亲」） | 需要 `family` 两侧各一套排序与两条 `path` 来源，入赘与联姻的语义会纠缠；A1 先不扩大范围 |
| **靠 `parentage_type` 猜承继支**（不加 `is_primary`） | 兼祧、双重过继下没有唯一答案，猜错会让人站到错的分支上 |
| **给 `person_tree` 加 `deleted_at` 而不是破例 DELETE** | 软删缓存会让 `path` / `generation` 残留脏值，且每张读查询都要多一层过滤；缓存就该能真删 |
| **A1 同时抽 `event` / `place` / `source`** | 一次改两层，迁移与回归面积翻倍；史料层是纯加法，可以等 |
| **用触发器维护 `person_tree`** | 隐藏副作用、难测、迁移期难排查；`withOrg` 事务内显式重算更可控 |

## 14. 留给构建者决定的部分

- `person_tree` 的重算粒度：每次写只重算受影响子树，还是标记脏 + 批量重算（倾向前者，与现状 `moveNode` 一致）。
- 读路径 DTO 投影放在 `lib/db/queries/persons.ts` 里，还是单独一个 `lib/genealogy/tree.ts` 纯函数（倾向后者：可单测）。
- `lib/db/queries/nodes.ts` 是改名还是保留文件名换实现（倾向改名，避免「`nodes.ts` 里没有 node」）。
- `lib/db/schema.ts` 怎么拆（按域一个文件 vs 按「组织域 / 家谱域」两个文件）。
- 迁移脚本用 `data/backfill-*.ts` 的形态与幂等键怎么取；对账脚本的输出格式。
- 画布组件里 `parentId` / `spouseOfId` 这些字段名是否在 DTO 层保留旧名以减少 diff（**倾向保留**，把改名留到 A2 一次性做）。
- 活动日志的 `ActivityType` 要不要为新的关系操作增加枚举值。

## 15. 范围决策（2026-10-29 已由人类伙伴确认）

三个问题在定稿时问过并已答，结论已并入 §2 的已定决策 4–6。这里保留提问背景，供后来的人理解「为什么范围划在这」。

**Q1：A1 的录入 UI 支持到什么程度？→ 答 (a)**
背景：模型支持同性别/未知性别的配偶，但现状 UI 只有「男/女」两个单选框（`components/lineage/node-create-dialog.tsx:339-360`），且强制「配偶与本人性别相反」（`:331`）。
结论：**A1 只放宽数据库（`sex` 允许 `2`），UI 保持男/女与「性别相反」的校验**。入赘仍可通过「女方为 `blood`、男方为 `spouse`」录入——那与性别无关。同性别、未知性别的录入留到 A2。

**Q2：删除语义 → 答 (a)**
结论：有**存活的直接子女**的人不能直接删，要先解除关系。门槛只看一层，不递归整棵子树；「整支删除」A1 不做。理由：递归门槛会让谱系中间层几乎人人不可删，等于把删除功能废掉。

**Q3：A1 哪些关系操作要有 UI？→ 答 (a)**
结论：三件都做最小形态——(a) 新增子女时能指定另一位亲本；(b) 过继/立嗣（新增一条非 `is_primary` 亲子边）；(c) 解除关系。其中 (b)(c) 放在**检查器**里，不进画布：画布是单位置渲染（`components/lineage/derived.ts:55-59`），过继子女仍只出现在 `is_primary` 支下。
为什么 (a) 不能砍：不做它，`family.wife_id` 永远为空，模型的半边是死的，§12 的「入赘」验收标准也无从验证。

