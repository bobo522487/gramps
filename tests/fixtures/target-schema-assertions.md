# S8 目标模型验证场景清单

> 原样归档自附件 `data-model.md` 附录 B（第 1858–1981 行）。
> **本文件是场景与期望 SQLSTATE 的清单，不是可执行 SQL**：请勿整文件 `psql -f`。
> 可执行 SQL 由实施计划 T38 按场景逐条编写；附录 C 的复现命令固化进 `scripts/verify-target-schema.mjs`。

---

## 附录 B. 验证清单

> 全部条目在 PostgreSQL 18.6 上验证，SQLSTATE 与预期一致（§12.2）。

### B.1 正例（应成功）

| # | 场景 |
|---|---|
| P1 | 附录 A 全量 DDL 在干净库按 A.0 → A.6 顺序执行（前置 → 扩展 → 表 → 函数 → 策略 → 权限；跳过含 `$1` 的 A.7），0 ERROR |
| P2 | `app.create_organization()` 返回组织 ID，且成员表中存在 `role='owner'` 行 |
| P3 | `app.accept_invite()` 在邮箱匹配时写入成员行，邀请状态变 `accepted` |
| P4 | 同一 `article` 被两部 `book` 的目录条目引用，成功 |
| P5 | 同一 `lineage` 被两部 `book` 的目录条目引用，成功 |
| P6 | 同一 `person` 在同一 `lineage` 中有一个 `primary` 节点与两个 `repeat` 节点，路径各不相同 |
| P7 | 旁注节点 `kind='annotation'` 且 `person_id IS NULL`，插入成功 |
| P8 | 同一 `person` 作为 `family_child` 出现在生父与养父两个 `family`；`mother_person_id` + `mother_role` 指向同家庭的 `family_partner` |
| P9 | `origin_family_id` 指向另一家庭且 `kind='ritual_heir'`，插入成功 |
| P10 | 整棵世系 `ORDER BY path` 一次索引有序扫，祖先路径在后代之前；`base_generation + nlevel(path) - 1` 给出正确世次 |
| P11 | 整书目录 `ORDER BY path` 直接得到深度优先顺序，无递归 CTE |
| P12 | 同级中间插入 `0010.0015`，只 touching 1 行 |
| P13 | 移整棵子树（目标槽空闲）：一条 `UPDATE node SET path = text2ltree('0030' \|\| substring(path::text from 5)) WHERE … AND path <@ '0010'::ltree`，提交成功；`parent_path` 自动联动 |
| P14 | 删整棵子树 / 删整棵目录子树：一条 `DELETE ... WHERE … AND path <@ …`（含根），提交成功 |
| P15 | 删除 `folder` 后，三个内容根的 `folder_id` 为 NULL 且 `project_id` 保持非空 |
| P16 | 组织 A 的会话查不到组织 B 的任何一行 |
| P17 | 嫡庶查询一次 join 返回 `mother_id` + `rank` + `role_label`，且 join 带 `AND fp.role = fc.mother_role` |
| P18 | 人物生卒用两次 `LEFT JOIN`，每人各最多一行 |
| P19 | 过期邀请重发：带 `WHERE invite.accepted_at IS NULL` 的 upsert 成功；同一邮箱仍只有一行，`status` 回 `pending`、新 `token_hash` 生效 |
| P20 | 已是 `viewer` 的账号接受 `editor` 邀请 → `23505`，邀请仍为 `pending`，成员角色不变 |
| P21 | `EXPLAIN` 单表整树查询（**必须以 `genealogy_app` 跑**）：`InitPlan 1 -> Result (actual rows=1.00 loops=1)` 出现一次，`Index Scan using node_path_unique`、无 Sort；10 万行 Q1 26.454 ms、Q3 42.930 ms（均 < 100ms） |
| P22 | `gist(project_id, path)` 上 `project_id = $1 AND path <@ $2` 的 Index Cond 同时含两列——**仅在属主 + `enable_seqscan=off` 下成立**；`genealogy_app` + RLS 下从不选该索引（§10.1） |
| P23 | §10.7 孤儿检测 SQL 在路径闭合的树上返回 0 行；且由 `node_parent_fk` 结构性保证 |
| P24 | `event.kind='adoption'` 分别挂 `person_id` 与 `family_id` 都能写入 |
| P25 | `genealogy_app` 执行 `SELECT count(*) FROM person` 成功（A.6 表级 DML GRANT 生效） |
| P26 | 伪造 `pg_temp.organization_member` / `pg_temp.invite`：`visible_org_array()` 返回真实组织集合，`accept_invite('pwned')` 报 `22023`，无跨租户成员行 |
| P27 | 插无父子路径被 `node_parent_fk` 拒（`23503`）；闭合树上 `parent_path` 由生成列正确派生；单条 UPDATE 安全移树后父路径自动联动 |
| P28 | 三阶段改名把一个事务内的 `0010 ↔ 0020` 交换成功，终态 `0010/0020/0020.0010/0020.0020` |
| P29 | `SET LOCAL ROLE genealogy_app; SET LOCAL app.user_id='u-alice';` **同一事务内** `SELECT count(*) FROM person` 返回 5 行（GUC 生效） |
| P30 | `book_export` 登记一行 `(book_id, fact_cutoff, artifact_uri, checksum, format)` 成功；`fact_cutoff > exported_at` 被 `23514` 拒绝 |
| P31 | `project.id` 全局唯一：两个组织各自建项目成功；`UNIQUE (id)` 使两个组织不能复用同一项目 `id` |
| P32 | `status='revoked'` 且 `accepted_at` 非空的行，重发 upsert 影响 0 行、`accepted_at` 保留；`pending` 与无时刻的 `revoked` 仍可重发 |

### B.2 反例（应失败并断言 SQLSTATE）

| # | 场景 | 期望 |
|---|---|---|
| N1 | `REFERENCES person(id)` 单列外键 | `42830`（无对应唯一约束） |
| N2 | 子表 `project_id` 指向另一个组织的项目 | `23503`（复合外键） |
| N3 | `event` 同时设置 `person_id` 与 `family_id`，或两者皆空 | `23514` |
| N4 | `book_catalog` 同时设置 `article_id` 与 `lineage_id` | `23514` |
| N5 | 同一 `book` 内重复装订同一 `article` | `23505` |
| N6 | 同一 `lineage` 同一 `person` 出现两个 `primary` 节点 | `23505` |
| N7 | 同一世系 / 同一书内重复 `path` | `23505` |
| N8 | 非法 `path`（字母段、缺零填充、空路径、`0001x0002`） | `23514` |
| N9 | `annotation` 节点带 `person_id`，或 `primary` 节点无 `person_id` | `23514` |
| N10 | 同一 `person` 两条 `birth` 事件；两条 `death` 事件 | `23505` |
| N11 | 非法 `date_sort` 格式，或有 `date_sort` 无 `date_text` | `23514` |
| N12 | `mother_person_id` 指向别的家庭 / 别的项目 / 非伴侣的人；或只填 `mother_person_id` 不填 `mother_role` | `23503` / `23514` |
| N13 | `origin_family_id = family_id`，或普通 `biological` 子女带出继来源 | `23514` |
| N14 | 删除已被 `book_catalog` 引用的 `article` 或 `lineage` | **`23001`**（`restrict_violation`）；`23503` 属 `NO ACTION` |
| N15 | 同一 `person` 设置两个 `is_primary = true` 的姓名 | `23505` |
| N16 | `invite.role = 'owner'`；同一邮箱两条邀请行 | `23514` / `23505` |
| N17 | 未设置 `app.user_id` 的事务读取任意业务表 | 0 行（写入 `42501`） |
| N18 | 未获 `EXECUTE` 授权的角色调用 `app.create_organization()` | `42501` |
| N19 | 邮箱不匹配的账号调用 `app.accept_invite()` | `42501` |
| N20 | 尝试构造"节点是自己的祖先"：路径模型无父指针，无法写出该状态 | 结构性不可表达 |
| N21 | `kind='birth'` 且只设 `family_id`；`kind='marriage'` 且只设 `person_id` | `23514`（两条 kind/主体 CHECK） |
| N22 | 直接 `INSERT` 重发同一邮箱邀请（未走 upsert） | `23505`（全唯一约束） |
| N23 | 用已过期的 `token_hash` 调用 `app.accept_invite()` | `22023`，且邀请仍为 `pending`、未被消费 |
| N24 | 写入 `0010.0020` 但库中无 `0010` 行；或只删一个中间 `node` 行 | **`23503`（`node_parent_fk`）/ `23001`（RESTRICT）**；由自引用 FK 结构性阻止 |
| N25 | `invite.email` 含大写字母（违反归一化 CHECK） | `23514` |
| N26 | 伪造 `pg_temp.invite` + `accept_invite('pwned')` 试图跨租户提权 | `22023` 且 `organization_member` 无新增行 |
| N27 | 把**丈夫** `PE1` 填进 `family_child.mother_person_id`（配 `mother_role='wife'`） | `23503`，`DETAIL: Key (…, 041, wife) is not present in table "family_partner"` |
| N28 | `mother_role` 写 `husband` / `partner` 等非法值；或 `mother_person_id` 与 `mother_role` 只填一个 | `23514` |
| N29 | 单条 `UPDATE` 交换 `0010 ↔ 0020` 或全根段重排（非延迟 UNIQUE） | `23505 duplicate key value violates unique constraint "node_path_unique"`；须用三阶段改名 |
| N30 | 未授权角色查询业务表 / 调用 `app.visible_org_array()` | `42501: permission denied for table person` / `42501: permission denied for function visible_org_array` |
| N31 | 组织 B 建一个与组织 A 同 `id` 的 `project`，再让 O1 的可见行引用 O2 的人（跨租户引用） | 建 clone 项目即 `23505 duplicate key value violates unique constraint "project_id_global"`，引用路径根本不成立 |

### B.3 保证矩阵

每条保证写明 DDL 兑现位置、兜底责任人与检测方式。

| 保证 | DDL 兑现位置 | 兜底责任人 · 检测方式 |
|---|---|---|
| 跨组织不可见 | 17 条 `org_isolation` 策略 + `app.visible_org_array()` | 应用服务（唯一持有 DB 账号）· §10.7 `EXPLAIN` + 每次部署后以两个组织的会话各跑 `SELECT count(*) FROM person` 并比对。**GUC 可伪造，不是安全边界**（§3.4） |
| 跨项目 / 跨组织引用阻断 | 全表复合 FK + 复合主键 + `project.id` 全局 `UNIQUE (id)` | 数据库 · N1/N2/N31 |
| 路径闭包（无孤儿） | `node_parent_fk` / `book_catalog_parent_fk`（生成列 + 自引用 FK） | 数据库 · N24、§10.7 可选诊断 |
| 树不成环 | `ltree` 路径类型本身 | 数据库 · N20 结构性不可表达 |
| 位置唯一 / 兄弟序 | 两条 `(…, path)` 非延迟 UNIQUE | 数据库 · N7/N29；重排由应用三阶段改名（§8.2） |
| 母亲是妻 / 妾且同家庭 | `family_child_mother_fk` 四列 + `family_child_mother_pair` | 数据库 · N12/N27/N28 |
| 次序按角色分域 | `family_partner_rank_unique (project_id, family_id, role, rank)` | 数据库 · §6.2 的约束定义；P8 测的是四列母亲 FK，不覆盖 `rank` |
| 邀请状态机 / 不抹接受历史 | 两条单向蕴含 CHECK + `WHERE invite.accepted_at IS NULL` 的 upsert | 应用服务（检查 rowcount、不静默改角色）· P19/P32、N16/N22/N23 |
| 导出物可追溯、可校验 | `book_export` 的 `book_id` / `fact_cutoff` / `artifact_uri` / `checksum` / `format` | 对象存储（制品不可变、不被 GC）· 应用导出流程写登记行 |
| 至少一个 owner | `app.create_organization()` 单事务写组织 + owner 行 | 应用服务 · 组织创建后 `SELECT count(*) FROM organization_member WHERE organization_id=$1 AND role='owner'`（应为 1） |
| 路径标签稳定 / 稀疏序号重排 | 无 DDL；由写入路径与三阶段改名控制 | 应用服务 · 改路径前跑 §10.7 与 §8.2 模板。失守判据：`display_name` 之类可变文本出现在 `path` 里，或出现单条 `UPDATE` 重排 |
| 事实层与谱系层一致 | **不保证**（领域判断，刻意不落库） | 编纂者 · §10.4 显式 SQL，人工触发 |
| 制品正文与导出时的库内内容一致 | **不保证**（制品在模型外） | 应用导出流程 · `fact_cutoff` + `checksum` 只提供可校验的指针 |

**对象数量表**：

| 机制 | 数量 |
|---|---|
| 业务表 | 17 |
| 认证表（框架管理；附录 A.0 只建最小契约 `auth.user`） | 4 |
| contrib 扩展 | 2（`ltree`、`btree_gist`） |
| DOMAIN | 1 |
| 数据库函数 | 4（其中 `SECURITY DEFINER` 3） |
| 生成列 | 2（`node.parent_path`、`book_catalog.parent_path`） |
| 自引用外键 | 2（`node_parent_fk`、`book_catalog_parent_fk`） |
| RLS 策略 | 17（DO 环 16 张 + `organization`） |
| 视图 | 0 |
| 用户定义触发器 | 0（FK 用 PostgreSQL 内建 RI 触发器） |
| 定时任务 | 0 |
| 延迟约束 | 0 |
| 父指针列 | 0（`parent_path` 是生成列，不是可写指针） |
| 可漂移的派生列 | 0 |
| `updated_at` 列 | 0 |
| `note` / `certainty` 列 | 0 |
| 库内成书内容快照 / 版本行 | 0 |
| 由数据库保证的树闭包 | 2（§4.5） |
| 可选 GiST 索引 | 2（§10.1） |
| `project.id` 全局唯一约束 | 1（`project_id_global`） |

---

