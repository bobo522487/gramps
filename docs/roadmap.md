# Roadmap（编排核心）

> **回答什么问题**：现在做到哪、下一步做什么、按什么顺序、每个切片的范围边界在哪。
> **读者**：全员 · 新人第三份 · 产品 / 技术负责人　**长度上限**：4 页
> **不写什么**：产品意图与成功指标（`docs/vision.md`）、单条需求的完成度与验收标准（各 `specs/NNN-xxx/spec.md` 与 `tests/`）、技术阈值（`docs/nfr.md`）、决策理由（`docs/adr/`）、已交付的变更记录（`CHANGELOG.md`）、术语（`docs/glossary.md`）。

全项目唯一**编排与状态**归属地。纯文本表格 + 双向回链，`grep` 就能拉出整条脉络，不依赖任何工具。新人读完 `README.md` → `docs/architecture.md` → 本文件，应当能说清「边界在哪、现在做到哪、下一步是什么」。

---

## 1. 使用规则

1. **roadmap 先改，再改 spec**。范围变了先改本表那一行，再动受影响的子 spec；顺序反了，本表就退化成事后记录。
2. **ID 不可变**。`S3` 一旦被子 spec 的 `Input` 行引用，不得修改、删除或复用。作废条目只把状态改成 `cancelled`，**保留行**。
3. 条目用 `S<n>`（slice），不用 `R<n>`：`R` 前缀在本仓库已被风险登记占用，同一个 `R3` 会指两样东西。切片语义也更准。
4. 子 spec 在自己的 `spec.md` 头部 `Input` 行写 `Parent roadmap → entry <ID>`，形成双向链；编排状态与本表不一致时以本表为准，并立即修正子 spec。
5. **两种状态不要混**：本表的状态是**编排状态**（排没排、在不在途、有没有归档）。功能**是否验收以 `tests/` 与代码为准**，不在本表写「实现了百分之几」「哪几条 FR 完成了」——那是 spec 与测试的事，抄进来就变成第二份真相源。
6. **不给没触发条件的事建行**。条件未出现的演进方向放 §5，不占 ID、不留空行：明确排除的东西进表只会制造假进度。

---

## 2. 状态定义

| 状态 | 判定 |
| --- | --- |
| `planned` | 已排期、未开工，范围边界已写清 |
| `in_progress` | spec 已批准，实现或验收中 |
| `delivered` | spec 交付附注已落地，验收在 `tests/` 里 |
| `deferred` | 明确推迟；**必须写出等什么条件**，不写「以后再说」 |
| `cancelled` | 作废，保留行与理由，ID 不复用 |

状态改 `delivered` 前先跑 `pnpm test`。「表已建、索引已加、外键已加」不算实现入口。

---

## 3. 条目表

| ID | 意图（一句话） | 范围 in | 范围 deferred | 依赖 | 状态 | 子 spec | 归档版本 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `S1` | 谱系录编与实时预览 | 录入闭环、右侧抽屉、底部快捷条 / 右键菜单、删除措辞、谱系删除权限收紧 | 结构编辑（挂接 / 拆支 / 承嗣）、30 秒撤销、房支、导出与导入 | — | `delivered` | — | — |
| `S2` | 谱文录入与多页编辑 | 谱文管理与分类树、文本录入、多页、正文配图、自动保存、标题检索 | 正文全文检索、插入人丁引用、模板套用 | — | `delivered` | — | — |
| `S3` | 谱文编辑器 Word 化与常用格式 | 分组工具栏、纸张感编辑区、迷你页预览、加粗 / 斜体 / 下划线、单层列表、段落对齐 | 颜色、行高、表格、引用、链接、图片 alt / 题注、多级列表、模板套件、导出 / 分享 / 发布 | `S2` | `in_progress` | — | — |
| `S4` | 谱书编目与成品排版主线 | 编目三栏、引用谱系或谱文、嵌套与拖拽排序、章节分区、隐藏条目、端到端导出一份谱书 | 谱书预览与分享、PDF 排版成书、字体授权 | `S1`、`S2` | `planned` | — | — |
| `S5` | 事实层读写切换与 `node` 退役 | 定唯一写入路径 → 对账 → 切写 → 切读 → 退役 `node` | 双写、新增事实层表 / 列 / 索引（闸门之前冻结） | `S4`（闸门） | `deferred` | — | — |
| `S6` | 回收站与数据保留期 | 软删恢复入口、保留期策略、可用的物理删除路径 | 审计能力 | — | `planned` | — | — |
| `S7` | Preview 环境与外部探针 | 每个 PR 一套独立库、部署自检与 E2E 跑在 preview、定时探针与错误聚合 | 多区域、双活、APM 全家桶 | — | `planned` | — | — |
| `S8` | 目标数据模型重构（epic） | 按 `docs/data-model.md` 把 schema 迁到目标态：事实层升为主数据源、`ltree` + 生成列闭包、复合主键与全局 `project.id`、`book_export`、`app.*` 隔离函数与 InitPlan 谓词；§7 的验证结论落成 CI 断言 | 库内成书快照 / 版本图、考据与出处体系、跨项目身份对齐、媒体资产（`docs/data-model.md` §7 的非目标不夹带） | — | `in_progress` | — | — |

`S8` 是 epic，不是普通 slice：它改的是**所有切片共用的数据层**，因此会重排 `S4` / `S5` / `S6` 的范围与措辞（§4.3）。ID 仍用 `S<n>`，避免追溯命令里出现两套前缀。子 spec 列暂为空——按 `CONTRIBUTING.md` 的流程，先在本表建行拿到不可变 ID，再 specify。

**「归档版本」全为 `—` 不是漏填**：仓库没有 tag / release，`specs/_archive/` 也尚未建立，所以没有可写的版本标签。归档按 `CONTRIBUTING.md` 的「交付后归档」执行，落地后补标签；口径与 `CHANGELOG.md` 一致，不虚构版本号。

**「子 spec」列全为 `—` 不是漏填**：旧的 `001`–`003` 规格随旧文档体系一起下线，`S1`–`S3` 的交付事实以 `CHANGELOG.md` 为准；新规格按 `CONTRIBUTING.md` §4 从 `.specify/templates/` 生成，编号不复用旧号。写已删除目录会制造断链，写尚未建立的目录则是虚构。

---

## 4. 当前推进点与状态待复核项

**现在做到哪**：`S1`、`S2` 已交付；`S8`（目标数据模型重构）是新插入的前置 epic，代码按 `docs/data-model.md` 重构，因此**下一步是 `S8`，`S4` 顺延**。`S8` 的 DDL 落地前不动 `S4` 的编目实现——目标态的 `book_catalog` 结构与现状不同，先做会白做；最终排期由产品 + 技术负责人确认。

**S8 执行进度（2026-11-08）**：[现状] 第 0 批（T1–T9）与阶段 A 第 1 批已交付；阶段 A′ 按负责人「硬做原计划、一次到位」的拍板，把事实层与谱系层 8 张表一次性切到附录 A.3/A.4 的目标态，读写链路与前端投影同步重写，A′ 门禁 11 条断言全绿、默认单测集 51 文件 / 408 用例全绿。A′ **不碰** `lib/db/migrations/`，DDL 基线整体重建仍在阶段 B 的 B0；四处有意降级、独立评审结论与 DDL 探针结果登记在 `/workspace/gramps-S8-实施计划.md` §3.3。A′ 收尾五条本地基线一次性全 `exit=0`、A′ 门禁 `11 passed`，已落单个本地提交 `122d3b8`、工作区干净、未 push。阶段 B 的 B0 已按 G0① 重建唯一目标态 SQL 基线（`0000_target_schema.sql`，附录 A.0→A.6），28 个旧迁移与 19 个 snapshot 退役、`meta/_journal.json` 重置为 1 条，两份旧迁移验收集成测试随之下线；schema TS 追平与迁移漂移验收仍是 T18–T28 / T39 的事，本段不代表 DDL 已落库。[目标] 后续按 §4.1 的「DDL 层 → 隔离层 → 验收层 → 文档跟改 / ADR」推进，`docs/data-model.md` §7 的数字须在目标环境重跑刷新并落成 CI 断言。本段是进度记录、不是交付声明，状态仍为 `in_progress`。

**B1（2026-11-08）**：[现状] 阶段 B 的零争议结构切片按 TDD RED→GREEN 完成（`tests/s8-stage-b1.test.ts` 7 条静态门禁，RED `6 failed / 1 passed` → GREEN `7 passed`）：按附录 A.5 新增 `lib/db/schema/book-export.ts` 与 barrel 类型导出；`project` 改 `(organization_id, id)` 复合主键 + `project_id_global` 全局唯一（替换与主键重复的 `uk_project_organization_id`）；`folder` 改 `(project_id, id)` 复合主键，顺带消除 A′ 登记的 `lineage_folder_fk` 42830 隐患。五条本地基线（`check` / `docs:check --strict` / `arch:check` / `typecheck` / `test`）全 `exit=0`。B1 **不碰** `activity_logs`、auth 三表、软删 / 时间戳列、文章层与认证层——三项待拍板规格分别归 B2 / B3 / B4。[目标] `book_export_book_fk` 的目标键 `book (project_id, id)` 已在 B0 基线成立，但 TS 侧 `content.ts` 仍是单列主键，须由阶段 B 后续批次追平；`pnpm db:generate` 的 drift 与 CI `Check migration drift` 红仍是 T18–T28 / T39 之前的已知中间态。另按独立评审补登一处 A′ 遗留隐患：`content.ts` 的 `fk_catalog_lineage` 引用 `lineages (organization_id, id)`，而 A′ 后 `lineages` 只有 `(project_id, id)` 复合主键、没有 `(organization_id, id)` 唯一键，同样会在 PG 上触发 42830，归 T18 余下 / B3 与 `content.ts` 追平一并消除。本段不代表 CI 全绿或 DDL 已落线上库，状态仍为 `in_progress`。

**三项规格决议（2026-11-08）**：① `activity_logs` 退役——目标态附录 A 无此表，代码面仅 4 文件 / 20 行且 `app/` 无页面调用，B0 基线不补建；② auth 四表 DDL 仍由 Better Auth 管理，本仓保留 `lib/db/schema/auth.ts` 作类型镜像，业务侧只 FK 到 `auth.user(id)`（符合 A.0 注释）；③ T28 缩为「去 Better Auth organization 插件 + `auth.user.id` 改 text」，角色与 CI / 部署脚本仍归 T32 / T34。据此阶段 B 余下三批：[现状] B1 已交付 `b7438d6`；[目标] B2 = T18 余下（`organization_member` 改 `(organization_id, user_id)` 去 `id`、`invite` 改 `(organization_id, id)`、`article` / `book` 改 `(project_id, id)`）+ T20–T23 + `activity_logs` 退役，`book` 改复合主键后 `book_export_book_fk` 的 42830 随之消除（`book_catalog` 需先加 `project_id`，随 B3 / T25）；B3 = T25 + T27；B4 = T28。②③ 的风险：`auth.user` 的 DDL 有两个来源（B0 基线骨架 + Better Auth 迁移），T28 须实测形状一致、部署不重复建表。

### 4.1 重构 epic 的拆分顺序

`S8` 的逐条差异清单**唯一真相源是 `docs/data-model.md` §8**，本表不复制那 13 行。验收时逐条消掉，`§8` 整节删除、不留双写。按「不做会不会堵住后面的路」排：

1. **先动第 1 条**：事实层从 `node` 的回填快照升为主数据源。这是根上的变更，牵动所有读写路径与术语，其余 DDL 改动都依赖它先定下来。
2. **DDL 层**：复合主键与 `project.id` 全局 UNIQUE、两棵树的 `ltree` + `parent_path` 生成列 + 自引用 FK、`book_export`、`article.body`、`RESTRICT` 删除语义。
3. **隔离层**：`app.*` 四个函数、`InitPlan` 谓词形状、非属主角色与 FORCE RLS 方案取舍、SECDEF 函数防 `pg_temp` 阴影、表级授权。
4. **验收层**：全量 DDL 0 ERROR、正反例 SQLSTATE、`EXPLAIN` 计划形状、安全用例；把 `docs/data-model.md` §7 的数字在目标环境重跑刷新，并落成 CI 或 `verify:deploy` 断言。
5. **文档跟改**（§4.2）与 ADR：新增一条 ADR 记录本次模型变更，被推翻的旧决策标 `superseded`，不回改已发布正文。

### 4.2 文档跟改登记

这是**本次重构的具体影响面**，不是 `CONTRIBUTING.md` §1 通用对照表的副本；通用规则仍以那里为准。

| 文档 | 会被推翻的结论 | 跟改触发点 | 何时失效 |
| --- | --- | --- | --- |
| `docs/glossary.md` | 「人丁 = `node`」「事实层 = 单向回填快照」「软删 `deleted_at`」「组织成员硬删」 | 事实层语义定稿（T10–T17 / T23） | 根变更落地即失效 |
| `docs/architecture.md` | 域所有权表（应用读写 `node`）、Better Auth organization 插件、FORCE RLS 与 `app_rw` / `auth_service` 角色、§8 多条结论 | schema 与隔离层落地（T18–T35） | DDL / 隔离层落地即失效 |
| `docs/runbooks/README.md` | RB-1~RB-7 的处置 SQL、§4 值班信号（表、角色、软删口径全变） | 表结构与角色变更（T32 / T34） | 角色与表名变更即失效 |
| `docs/nfr.md` | §5 的删除语义（业务表软删 / 组织成员硬删） | 删除语义变更（T23） | `RESTRICT` 落地即失效 |
| `docs/adr/README.md` | 涉及软删、树存储、RLS 的既有决策需标 `superseded` | ADR 新增时（T48） | 新 ADR 落地即失效 |
| `CONTRIBUTING.md` | §1 对照表补「数据模型重构」这一行的跟改范围 | 流程落地（T49） | 对照表补齐即失效 |
| `README.md` | §1 明确不做清单（回收站 UI、谱书编目编辑）、§3.1 目录树里 `data-model.md` 的职责描述 | 目标态范围定稿（T46） | 明确不做清单更新即失效 |
| `docs/vision.md` | §5「统计口径定义在 `docs/data-model.md`」语义断链；§6.3 缺口 3「并发覆盖」、缺口 4「删了找不回 / 软删兜底」 | 目标态章节重编号（T46 / T47） | 删除语义与章节号变更即失效 |
| `docs/interfaces.md` | §2「写只走 Server Action，例外只有 3 条图片通道」——目标态 `app.create_organization` / `app.accept_invite` 是库内 SECDEF 写入口 | 隔离层落地（T35） | SECDEF 写入口上线即失效 |
| `docs/contracts/README.md` | §4 全部谱系 Action（`createRootNode` / `addChild` / `addSpouse` / `nodeId` / `requestId` 幂等键）围绕「`node` 是人丁主体」 | 根变更落地（T13 / T44） | `node` 变纯位置引用即失效 |
| `docs/data-model.md` | §8 迁移清单在重构完成后整节删除 | 13 条差异逐条消掉（T47） | §8 删除时本行一并删除 |

### 4.3 连带待复核（本轮不动）

| 条目 | 冲突 | 处置 |
| --- | --- | --- |
| `S5` | 意图写「`node` 退役」，但目标态保留 `node` 作为谱系位置，退役的是它身上的身份字段 | 改写意图或标 `cancelled`，保留行 |
| `S6` | 目标态无软删、删除走 `RESTRICT`，恢复入口不再成立 | 同上 |
| `S4` | 「嵌套与拖拽排序」需按目标态 `book_catalog.path` 重新界定 | 更新范围 in / deferred，并在依赖列补 `S8` |

按 §1 规则 2，ID 不可变、作废只改状态并保留行；这三行**本轮不改**，等产品 + 技术负责人确认后单独一个补丁。

#### 阶段 E 挂起项（2026-11-09，文档跟改批次登记）

阶段 E 只落地文档跟改与 ADR。`T47` 的「13 条差异全部消掉后删 §8」与 `T49` 的「`S8` → `delivered`」都有硬前提，逐条核对后以下四项**未兑现**，不写进交付声明：

| 挂起项 | 事实 | 解除条件 |
| --- | --- | --- |
| `T40` / §7 数字 | Q1 / Q3 的 `EXPLAIN` 计划形状与耗时须在 G1 书面确认的目标环境重跑；`pnpm verify:target-schema` 对 P21 / P22 恒显式 `SKIP`，本地 Docker PG18 的旧数字不作验收依据 | 目标环境实测并留命令输出，刷新数据模型文档 §7 |
| `#14` folder 层级 | 附录 A.2 的扁平单层与实现多级分类的取舍**从未拍板**：唯一 SQL 基线与 TS 都按「扁平 + 实现层级列」超集建表，基线注释仍要求「B3 开工前拍板」，而 B3 已完成。它不在 `S8` 的范围 in 里，属被跳过的独立规格问题 | 产品 + 技术负责人拍板层级去留，单独批次改 DDL / TS / 查询与验收夹具 |
| `T47` 删差异清单 | 数据模型文档 §8 的 #1–#13 实质已消除（#6 / #7 / #10 的表格文字是 B1 / B2a 时期的过时快照，本批已更正），但 #14 仍被该节登记为待改对象；整节删除会让唯一遗留项失去归属地 | #14 拍板并迁出后整节删除；§9 编号不重排，避免所有引用断链 |
| `T49` / `S8` 状态 | 完成定义要求 G0–G5 全绿 + 切换日 T50–T52 执行完毕并留档 + §7 数字刷新；当前 G5 的 EXPLAIN 未兑现、切换日未执行，故本表 `S8` 继续记 `in_progress` | T50–T52 执行完毕并留档后再改 `delivered` |

`S4` / `S5` / `S6` 三行按 §4.3 仍是「本轮不改」，需产品 + 技术负责人确认后单独一个补丁；ID 不复用、行不删。本段是核对结论与待办台账，不是交付声明。

按 L4 还有两处不能粉饰，需要技术负责人确认：

| 项 | 事实 | 待办 |
| --- | --- | --- |
| `S3` 状态 | 格式能力的代码已落地（`components/article/editor/text-align.ts`、`text-style.ts`、`lib/article/flatten-lists.ts`、`toolbar.tsx`），但旧 `003` 规格已随文档换代下线，没有留下交付附注 | 由产品 + 测试负责人按代码与 `CHANGELOG.md` 确认是否 `delivered`；本表暂记 `in_progress`，不替 spec 下结论 |
| 双向回链 | 新规格的 `Input` 行 MUST 写 `Parent roadmap → entry <ID>`（`CONTRIBUTING.md` §4 第 2 步）；模板唯一在 `.specify/templates/`，归档区 `specs/_archive/` 待首个交付后建立 | 首个新 spec 落地时验收回链，不预建空目录 |

这两项都是队列后面的活，按「一次一个补丁」不在本轮改动，但先记在这里，免得被当成已闭环。

---

## 5. 切片顺序与不建条目的方向

顺序不是按工作量排，是按**「不做会不会堵住后面的路」**排。正文里现状与目标并存，按 `CONTRIBUTING.md` §3 用 `[现状]` / `[目标]` 标出边界：

1. **`S8` 先于所有未开工切片**：它换掉的是全部切片共用的数据层。[现状] 事实层是一次性回填后的冻结快照；[目标] `docs/data-model.md` 把它定为主数据源。schema 与隔离层没落地就动 `S4` / `S5` / `S6`，等于按旧表结构写一遍再重写。
2. **`S4` 先于 `S5`**（前提待 `S8` 复核）：[现状] 先让谱书编目 / 排版端到端跑通（有真实消费方），再切真源；**写路径是替换，不是同步**。[目标] 事实层已是主数据源，`S5` 的「切真源 / `node` 退役」不再成立，两者范围按 §4.3 重界定。
3. **`S6` 不能单独先做**（前提待 `S8` 复核）：[现状] 回收站必须同时回答保留期，否则会变成「永久保留」的入口。[目标] 删除走 `RESTRICT`、无软删，该条目的意图本身要重定。
4. **`S7` 不阻塞开发，但阻塞「敢对外承诺可用性」**：成本低，收益是把「不知道挂没挂」变成「知道」；不随数据模型重构变化。
5. **`S5` 的 `deferred` 是硬约束**（前提待 `S8` 复核）：[现状] 闸门未到就冻结，不加表 / 列 / 索引，不双写、不切读。[目标] 闸门改由 `S8` 的 DDL 落地充当，冻结口径随之失效。

**不建条目的方向**（触发条件出现才建行，不预留 ID）：

| 方向 | 触发条件 |
| --- | --- |
| 编辑锁 | 出现真实并发覆盖投诉 |
| 缓存层、外部搜索索引、服务端分页 | 单谱系人丁量级或全量加载成为实测瓶颈 |
| 多实例化（共享限流、后台任务） | 单实例承载不住流量，或限流被证明必须真正生效 |
| 拆服务 / 消息队列 | 团队规模与 QPS 同时越过拆分门槛 |
| 审计通道 | 有明确合规诉求（谁要、保留多久、能否篡改） |

最后一条尤其要忍住：诉求不明就做，大概率是一张没人查的表。

开放问题（字辈分支、女儿入谱子女归属、联宗、导出自助化、指标埋点口径）在 `docs/vision.md`，不在本表造条目；它们改变的是范围边界，定了之后先改 vision 与本表对应行。

---

## 6. 追溯与核对

```bash
# 从 roadmap 条目找子 spec（双向链的另一端）
grep -rn "entry S4" specs/ docs/
# 从子 spec 反查 roadmap 行
grep -n "S4" docs/roadmap.md
# 从一条需求一路拉到决策与测试
grep -rn "FR-001" specs/ docs/adr/ tests/
# 重构 epic 的差异清单（唯一真相源在 data-model.md §8，本表不复制）
grep -n "重构前的实现差异\|现状（待改）" docs/data-model.md
# 待复核的连带条目（S8 定稿后单独一个补丁处理）
grep -n "S4\|S5\|S6" docs/roadmap.md
# 现有切片与状态改 delivered 前的门禁
find specs -maxdepth 1 -type d | sort
pnpm test
```

本表与 `tests/` 冲突时**先确认哪个是意图**，再同步两边，不允许长期双轨。涉及排期、资源与上线范围的调整，须找产品与技术负责人确认后再改本表。
