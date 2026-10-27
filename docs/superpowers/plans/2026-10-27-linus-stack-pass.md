# 技术栈 Linus 复核与收敛（Stack Pass）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 ADR 0009 §3/ADR-24「约束没有执行者就是愿望」和「删掉什么比加上什么更有效」两把尺子，闭合技术栈里**已经在持续交税、或文档与代码已经各说各话**的六处：人丁表上一个零消费者的 trigram 索引（写放大付在最热的 `full_name` 列上）与它的镜像——最热写路径上一个**零索引**的 `spouse_of_id` 查询、ADR-13「检索」有决策无实现路径且没有文件、真正零引用的依赖/文件/导出、被 serverless import 的运行时模块在模块作用域加载 dotenv、搜索谓词两份且已行为分叉（同一 query 画布命中、世系表漏生卒/葬地）、ADR 0009 §2 明文钉死 ORM 版本却没有执行者、以及 D-9 富文本选型这个还未闭合的单向门。

**Architecture:** 全部是**减法 + 补执行者 + 一次对称的加法**，不新增任何运行期依赖（ADR 0009 §1）。三个正交纵深：**纵深 A 数据层的索引与事实一致**——给 ADR-13 落一个与真实实现一致的 ADR 0011（人丁搜索留在客户端、trigram 只留给谱文 FR-ART-5），据此只删 `idx_node_search`，**保留** `pg_trgm` 扩展与 `idx_article_search`；同时补上它的镜像缺陷（`spouse_of_id` 有消费者无索引）；两者用集成测试对**真实库**做执行者。**纵深 B 依赖与启动面**——删四个被证明零引用的东西（含一个零代码引用的根 pin），把 dotenv 从 `lib/**` 运行期模块挪到非 Next 入口，用 `env-bootstrap.test.ts` 做执行者。**纵深 C 已决策无执行者 + 唯一行为分叉**——ORM 钉版加执行者、搜索谓词收成一处并加去抖、D-9 定成 ADR 0010 且**从待决策表移除**（把 `D-9` 加进 `check-docs.mjs` 已解决的检测清单，让它真的会红）。

**Tech Stack:** Next.js 16.4.3 App Router · React 19.3.1 · TypeScript 7.0.2 · Drizzle ORM `^0.45.4` · PostgreSQL 18（`ltree`/`pg_trgm`/`btree_gist`/`uuidv7()`）· Vitest 5（单测 + 真实 PG 集成）· Playwright 1.64 · Biome 2.6.3 · pnpm 12

**Spec:** 无独立新 spec。输入：[PRD](../../prd.md)（FR-LIN-11 人丁搜索、FR-ART-5 谱文检索）、[ADR 0009 依赖与运行时立场](../../decisions/0009-dependency-and-runtime-stance.md)（§1 依赖只减不增、§2 ORM 钉版、§3 执行者）、[决策索引](../../decisions/README.md)（ADR-13 检索、ADR-24 约束执行、待决策 D-9）、[数据模型 §10.1 检索](../../data-model.md)、[2026-10-25 技术栈评审](../../reviews/2026-10-25-linus-stack-review.md)，以及本轮**对当前 HEAD `343e598` 的独立实测**（「证据基线」）。**与 [10-26 架构精简计划](./2026-10-26-linus-architecture-simplification.md) 不重叠**：那份管应用层重复代码、revalidate 收窄、F6/F7 初装、三棵树约束（已落地，见 git log `4b785c2`/`fe62a0b`/`bdc3b34`）；本文只管依赖、DB 索引、启动面、选型决策与「已决策无执行者」。

---

## 证据基线（本轮实测，基线 `343e598`）

### 构成本计划主体的事实

| # | 事实 | 证据（文件:行 / 命令输出） |
|---|---|---|
| E1 | **`idx_node_search` 零消费者**：`node` 表上 `USING gin (full_name gin_trgm_ops)` 存在，但全仓无任何 trigram 运算符（`%` / `similarity` / `ILIKE`）消费它；人丁搜索实际在**客户端内存**里做（`getNodes` 一次载入整谱系、无 `limit`，`matchLineagePerson` 遍历 `index.blood`）。 | `0001_auth_rls.sql:551-552`；`grep -rn "searchNodes" lib app components tests` → **空**（原实现被 `ee41526 refactor: 删除零调用方的查询/Action 与重复常量` 删掉，索引留下了）；`lib/db/queries/nodes.ts`（30 行，无 limit）；`derived.ts:203-228` |
| E2 | `full_name` 是最热写列之一：每个人丁 insert/update 都写它（`surname+name` 拼接），GIN(trigram) 每次写都要做 trigram 分解并放大索引项。 | `lib/db/schema.ts:348`；写点 `lib/lineage/node-services.ts:220,277,348,427,498,560` |
| E3 | **`idx_article_search` 与 `pg_trgm` 扩展要保留**：`article` 表尚未有业务实现（AGENTS §1 谱文未实现），FR-ART-5「按标题与正文全文检索」是**已承诺的未来需求**，`article.plain_text` 空表写成本≈0。删扩展会让未来的 FR-ART-5 撞 SQLSTATE `42704`。 | `docs/prd.md:223`；`data-model.md:532,663`；`implementation-status.md` 谱文未实现 |
| E4 | **ADR-13「检索」有决策、无文件、无执行者，且与实现路径不一致**：`decisions/README.md:28` 写「`pg_trgm` + ILIKE」，但 `docs/decisions/` 下**没有 ADR-13 对应文件**（`ls docs/decisions` 无检索/trgm 文件），而实现走的是客户端全量匹配。这正是 ADR-24 定义的「视为未决策」。 | `decisions/README.md:28`；`ls docs/decisions/` → 仅 0001–0009；`data-model.md:669-677` 论证 pg_trgm 选型 |
| E5 | 真正**零引用**的栈面（四条各测一次）：`autoprefixer` 不在 `postcss.config.mjs`（只有 `@tailwindcss/postcss`，Tailwind v4 由 lightningcss 出前缀）且全仓无引用；`components/ui/tabs.tsx`（87 行）**零 importer**；`resetAuthDb`（`lib/db/auth-db.ts:70-72`）零调用者，调用面只用 `closeAuthDb`；**`@better-auth/drizzle-adapter` 根 pin 零代码引用**——代码走 `better-auth/adapters/drizzle`，而该 subpath 由 better-auth 自带（`better-auth/package.json:180-182`）且它已把同名同版本 `1.7.12` 声明为自己的 prod 依赖；根 pin 只多造一个物理实例（`.pnpm` 下两个不同 hash 目录）。 | `grep -rn autoprefixer`（排除 package.json/.worktrees）→ 空；tabs importer 计数 0；`grep -rn resetAuthDb` → 仅定义处；`grep -rn "from '@better-auth/drizzle-adapter'" lib app components hooks tests scripts` → 空；`ls -d node_modules/.pnpm/@better-auth+drizzle-adapter@1.7.12*` → 2 个实例 |
| E6 | **dotenv 在模块作用域被 5 处加载**，其中 2 处属被 serverless 运行时 import 的业务模块（每次冷启动副作用）：`lib/db/drizzle.ts:4,17`、`lib/db/auth-db.ts:4,16`；另 3 处 `scripts/verify-deployment.mjs:3`、`tests/helpers/db.ts:1`、`tests/helpers/db-url.ts:1`。`lib/config.ts` 只读 `process.env` 不加载 dotenv——加载职责散在 5 个入口。 | 见各行；两处运行时模块都有 `config({ quiet: true })` |
| E7 | **搜索谓词两份，且世系表实际漏 3 类命中**：画布/索引谓词 `derived.ts:189 matchesNode`（私有、未导出）匹配 **8** 个自身字段（fullName / name / courtesy / namePrefix / birthText / deathText / burialPlace / biography）；世系表 `lineage-detail.tsx:419-423` **自带**内联谓词只匹配 4 个（fullName / courtesy / namePrefix / biography）+ 配偶 fullName。<br>**关键推导**：`fullName = surname + name` 是写侧不变式（`node-services.ts:70-72`，6 处写入点全走它），所以 `name` 永远是 `fullName` 的后缀——**表格对 `fullName` 的匹配已经覆盖了 `name`**，两份谓词的差异**不含** `name`。真正只有画布能命中、世系表漏的是三列：**`birthText` / `deathText` / `burialPlace`**（生卒、葬地）。 | `derived.ts:190-199` vs `lineage-detail.tsx:419-423`；`node-services.ts:70-72,220,277,348,427,498,560`；`implementation-status.md:176` 只写「世系表保留过滤」未定义字段集 |
| E8 | 世系表过滤是 **per-keystroke O(N) 全扫，无 debounce / `useDeferredValue` / `startTransition`**。 | `grep -rn "debounce\|useDeferredValue\|startTransition" components/lineage/*.tsx` → 空；`lineage-detail.tsx:411-426` |
| E9 | **ADR 0009 §2 的 ORM 钉版无执行者**。现有 `tests/docs-consistency.test.ts:82-94` 只做**文档抄写一致**：它从 `package.json` 的 specifier 反算 minor（`^0.45.4`→`0.45`）再断言 `implementation-status.md` 含「Drizzle 0.45」。`pnpm update` 把 specifier 和文档**一起**改成 0.46 时，这条**照样绿**。缺的是对**实际安装版本**与 **specifier 形态**的断言。（ADR 0009 正文「28 个文件 import drizzle-orm」实测已漂到 **29 个文件 / 35 个 specifier 站点**。） | `tests/docs-consistency.test.ts:82-94`；`grep -rl "from 'drizzle-orm" app components lib hooks scripts tests`（除 `.worktrees`）= 29；ADR 0009 §2 |
| E10 | **D-9 富文本选型仍未闭合**（待决策表在册），此刻是最后一次廉价决策窗口：`package.json` 无任何编辑器依赖，`article.content` 尚无解析它的业务代码，装什么/不装什么的代价都还是 0。 | `decisions/README.md` 待决策 D-9；`grep tiptap/prosemirror/lexical package.json` → 无 |
| E11 | F6「单文件 ≤400 行」目前**报 0 违规**，但是靠 8 条豁免撑着：`[F6] 157 files scanned, 8 exemptions, 0 violations`。豁免内文件合计 **5840 行**，占 F6 实际扫描面（`app`+`components`+`lib`+`hooks` = **18884 行**）的 **30.9%**——即约三分之一的应用源码实际不受该约束。这是**现状记录，不在本计划新增任务里瘦身**（属 10-26 计划的持续项）。 | `node scripts/check-file-size.mjs`；`scripts/check-file-size.mjs:16` `SCANNED`、`:21-30` EXEMPT |
| E12 | **CSP 是一个「注释承诺了、执行者只验存在、效果为零」的头部**：`next.config.ts:3-4` 写「Report-Only first: monitor violations before enforcing」，`verify-deployment.mjs:59` 把 `content-security-policy-report-only` 列为**必备头**并断言其存在。但全仓**没有 `report-uri` 也没有 `Report-To`**（`grep -rn "report-uri\|report-to" next.config.ts app lib scripts` → 空）——浏览器的违规报告**没有接收端**，永远看不到；而 Report-Only 本身**不拦任何东西**。净效果：对任意请求，这个头部改变的行为 = 0，却有一个 CI 断言保护它的存在。**这不是可以「顺手删」的孤儿税**：删它 = 主动放弃 CSP 演进路径，且要同步改 `verify-deployment.mjs:59`，属于安全决策。故本轮**只登记，不动**（见下方处置表）。 | `next.config.ts:3-4,32-35`；`scripts/verify-deployment.mjs:53-60`；grep 结果为空 |
| E13 | **E1 的镜像：消费者无索引**。`nextSpouseSort`（`node-services.ts:137-156`）按 `(organization_id, spouse_of_id)` 等值 + `deleted_at IS NULL` 过滤取 `max(sort)`，被**两条生产写路径**调用（`:217` 同录配偶、`:495` 加配偶），且都在 `loadLineageForUpdate`（`:75-93`）取的 **`FOR UPDATE` 谱系锁内**。`node` 上没有任何索引以 `spouse_of_id` 为首列（`schema.ts:408-410` 只有 `(org,lineage,depth)`、`(org,parent_id)`、`(org,lineage) WHERE deleted_at IS NULL`）→ 每次加配偶做一次谱系内扫描，且持锁。 | `grep -n "await nextSpouseSort" lib/lineage/node-services.ts` → 217, 495；`grep -n "index('idx_node" lib/db/schema.ts` → 无 `spouse_of_id` |
| E14 | **本轮改动最大的落地陷阱**：`lib/db/schema.ts` 现在 **688 行 = F6 豁免登记线 688，零余量**；`node-services.ts`、`lineage-sidebar.tsx`、`ui/sidebar.tsx`、`person-inspector.tsx`、`node-create-dialog.tsx` 同样卡在自己的登记线上（**零余量**），`lineage-detail.tsx` 864/865 只剩 1 行。也就是说 8 个豁免文件里 **6 个加一行就红**。凡是要往这些文件加代码的任务，都必须把「不进该文件 / 净减行」写成前置约束。 | `node -e "…count newlines"`；`scripts/check-file-size.mjs:21-30` EXEMPT；`scripts/lib/file-size.mjs:56-62` `over-budget` |

### 本轮证伪、明确不纳入的结论（诚实记录，防下一轮重复劳动）

| 曾出现的说法 | 实测 | 结论 |
|---|---|---|
| 「`dotenv` 是幻影依赖，未在 package.json 声明」 | `package.json:66 "dotenv": "18.0.9"` | **假**。E6 成立的是「位置不对」，不是「没声明」 |
| 「CI 不跑 E2E / 只装浏览器不执行」 | `.github/workflows/ci.yml:99,102,108`：install chromium + `pnpm test:e2e` + 上传 artifacts | **假**，E2E 在 CI |
| 「`lib/db/auth-schema.ts` 是零 importer 死文件」 | `lib/auth/better-auth.ts:10`、`tests/auth-schema.test.ts:4` 各 import | **假**，活跃依赖，勿删 |
| 「`pg_trgm` + 两个 trigram 索引全删」 | E3：`article` 的 trigram 服务 FR-ART-5；删扩展会让未来需求崩 | **不这么删**。只删 `idx_node_search`（E1），保留扩展与 `idx_article_search`，并把不一致写成 ADR 0011（Task 1） |
| 「合并 `pg` + `postgres` 双驱动」 | 10-25 评审「不要动」#3、ADR-19 明确保护：本地 postgres.js / Vercel `pg`+`attachDatabasePool` 是两种运行时的真实差别 | **不做**。只清分叉周围的 dotenv（Task 3）与 `resetAuthDb`（Task 2） |
| 「`next-themes` 是装饰依赖，手写 5 行即可」 | `app/layout.tsx:7,48` 已挂载；`globals.css:4` `@custom-variant dark`、`:52 .dark`；ADR 0009 §5 认可其编码「SSR 首帧不闪」 | **保留** |
| 「画布搜索无测试」 | `tests/lineage-canvas-layout.test.ts:468-480` 有 `matchLineagePerson` 断言（配偶命中定位血亲、空串、不命中） | **假**，已有覆盖；E7 缺的是**跨视图一致性**，不是正确性 |

### 已在册、不由本计划解决的（避免重复立项）

D-10 表单栈（RHF 文档虚构）、D-11 登录限流（进程内 Map + 可伪造 `x-forwarded-for`）已在 `decisions/README.md` 待决策表内，由 `scripts/check-docs.mjs` 的 pending 机制在册管理；ADR 0009 §重估触发条件已给 D-11 触发器。**本计划不重开这两条**——它们的执行者已存在（待决策表 + docs:check），缺的是产品触发条件，不是技术决策。E11 的 F6 豁免瘦身同理属于 10-26 计划的持续项，不在本轮新增任务。

### 性能类建议的处置（本轮已实测，明确拒绝/推迟，防下一轮照抄）

本轮实测与一份并行审计提出的性能/安全类结论（含号称 15x–27x 的加速），逐条查源码后**大多不能采纳**——记在这里，不要有人据此「优化」反而弄红 CI：

| 建议 | 实测结论 | 处置 |
|---|---|---|
| **CI 删掉 `db:migrate` 步**（号称冗余，因为 `test:coverage` 的 globalSetup 会 drop schema 重迁移） | **会直接把 CI 弄红**：`ci.yml:63-77` 的 provision 步执行 `GRANT app_rw TO app` / `GRANT auth_service TO auth_runtime`，而 `app_rw`、`auth_service` 两个角色**只由迁移创建**（`0001_auth_rls.sql:6`、`0003_better_auth.sql:16`）。`db:migrate`（`:59`）正是 provision（`:63`）的前置，删掉 → `role app_rw does not exist`。 | **拒绝**。「同一 job 里迁移被跑三次」是真的（`ci.yml:59` + `tests/helpers/db-setup.ts:90-113` + `tests/e2e/global-setup.ts:19`），但那是**顺序依赖**不是冗余——第一次是 provision 的前提。要减重复只能改成「globalSetup 检测已迁移则跳过」，属测试基建改造，不在本轮。 |
| **三份 vitest 配置合成一份 `projects`**（`vitest.config.ts` 与 `vitest.integration.config.ts` 有 14 行字节相同，含整个 `resolve.alias` 块） | 重复属实（本轮 diff 过，alias 块两边完全一致）。但**朴素合并会静默炸掉整个套件**：实测把 `extends: './vitest.config.ts'` 放在 `defineConfig` **顶层**时**不继承父配置的 `resolve.alias`**——`vitest run --config <probe>` 报 `Cannot find package '@/lib/ids'`，而同一个 `tests/ids.test.ts` 用基配置 4/4 通过。`vitest.coverage.config.ts` 的 `extends` 之所以有效，是因为它写在 **`projects` 数组内部**，是另一条机制。 | **本轮不做**（收益省 14 行样板，风险是全套件解析失败）。记为**移交项 D**：真要合只能在 `projects` 层 `extends`，且必须单测/集成**两套都跑通**证明 alias 生效；顺手把 `package.json:22-23` 字符串完全相同的 `test`/`test:unit` 收成一条。 |
| **CSP（E12）**：`content-security-policy-report-only` 无 `report-uri`/`Report-To`，违规报告无处送达，Report-Only 又不拦任何东西——净行为 0，却被 `verify-deployment.mjs:59` 断言「必须存在」 | 事实成立，但**删它不是「减面」**：它是一条演进路径的占位（注释自己写了「先 Report-Only，监视后再 enforce」），删了就等于无声关闭 CSP；且必须同步改 `verify-deployment.mjs:59` 与 `docs` 的安全头叙述 | **本轮不动，登记为移交项 C**：正确修法是先加收集端（哪怕只在 `verify-deployment` 里断言「有 report-uri」），或在 ADR 里明确放弃 enforce 并删头部。这是一个**安全决策**，需要人来定，不是本计划的减法。 |
| 把 `node_select` 的 RLS qual 从 `auth.has_org_role(...)` 改成 `organization_id IN (SELECT … FROM organization_member WHERE user_id=auth.uid())`（号称 27x） | **会弄红 CI 且重新引入越权**：`scripts/verify-deployment.mjs:340-349`（F5 强形式）要求每条 `app_rw` 策略**必须调用 `auth.has_org_role`**；`0001_auth_rls.sql:20` 的函数正是为表达 ADR-0006 的「读含 viewer、写不含 viewer」——裸子查询**表达不了**。`data-model.md` 曾推荐裸子查询、被 `check-docs.mjs:171,175-182` 机械封杀。 | **拒绝**。若将来真要提 RLS 性能，只能走「给 `has_org_role` 内部加缓存/改成 non-definer」那条，且**必须保持函数调用形态**以过 F5——那是一次独立立项，不在本计划。 |
| `reorderSiblingsInTransaction` 的 N+1 UPDATE 批量成一条 `unnest`（号称 15x） | 该函数**零生产调用方**：`grep reorderSiblings lib app components` → 仅 `node-services.ts:816` 定义 + `tests/integration/nodes.test.ts` 三处调用；对应 Action 早在 `ee41526` 被删。热路径不存在。 | **不做**（为测试专用路径改生产代码 = 反向的孤儿税）。留作「若将来重加排序 Action 再顺手批量化」。 |
| 删掉 `getNodes` 的 `ORDER BY generation,depth,sort,created_at`（号称省 7.1x + 磁盘外排） | **不安全**：`buildLineageIndex` 只按 `generation`+`sort`（`derived.ts:38-43`）重排，**不重排 `depth` 与 `created_at`**——那两个是世系表分组内与打印视图的同代 tie-break。删 DB 排序会静默改顺序。 | **不做**，除非先让 JS 排序**完整**复刻 4 个键。属数据语义改动，非本轮。 |
| `withOrg` 每读 3 条 setup SQL（号称 +3.1x）、把三个读并进一个事务 | `0006_statement_timeouts.sql` 已给 `app_rw` 设 `statement_timeout/lock_timeout` 兜底；合并读会改 `requireProjectContext`/`getNav*` 的 `cache()` 复用边界，是**架构级**改动（10-26 计划 §E3 已记「可只发一次」但判为不在那轮范围）。 | **推迟**，非本轮；记此处免得重复提。 |
| `deleteProjectAction` 后无 `invalidateQueries`，删掉的项目在选择器里滞留到 30s（`staleTime`）后 404 | **确为真 bug**，但属**应用层数据流**（`project-workspace.tsx:44-76` 的 `DeleteProjectButton` 缺失效），与「技术栈选型/依赖/DB/启动面」无关；10-26 计划 §5.1 的失效收敛正是它的归属。 | **不在本计划**。移交为独立 fix 任务（见下方「移交清单」），本轮不混入以免破坏「一个 commit 一件事」。 |

**唯一采纳的性能项**（因为它是数据层索引、且是 Task 1 的镜像）：**热写路径缺索引** —— `nextSpouseSort`（`node-services.ts:137-156`，被 `:217` 同录配偶与 `:495` 加配偶两条生产写路径调用，且在 `loadLineageForUpdate` 的 `FOR UPDATE` 锁内）按 `spouse_of_id` 等值过滤，但 `spouse_of_id` **不在任何索引**里（node 现有索引 `idx_node_lineage_depth`/`idx_node_parent`/`idx_node_alive` 皆不以其为首列）→ 每次加配偶全表扫。这正是「消费者无索引」，与 Task 1 的「索引无消费者」对称。见 Task 7。

### 移交清单（本轮查实、但不属于「技术栈」范畴，另开小任务）

- **Fix A（应用层数据流）**：`DeleteProjectButton`（`components/project/project-workspace.tsx:44-76`）加 `queryClient.invalidateQueries({ queryKey: queryKeys.projects(orgId) })`，与兄弟 `create-project-dialog.tsx:105`/`project-settings-panel.tsx:66` 对齐。
- **Fix B（安全，独立评审）**：`genealogy-canvas.tsx:463` `JSON.parse(raw) as DragTemplate` 把浏览器 `dataTransfer` 未校验载荷直接用于选择 spouse/child 写路径——改成 4 行 Zod 解析 `DragTemplate`；违反 AGENTS §6.1「外部输入用 Zod」。
- **Fix C（安全决策，需人拍板）**：`next.config.ts:3-4` 的 CSP Report-Only 无 `report-uri`/`Report-To`（E12）——要么补收集端再谈 enforce，要么立 ADR 明确放弃并同步删 `verify-deployment.mjs:59` 的必备头断言。**不要在无人决策时删头**。
- **Fix D（测试基建，非技术栈选型）**：三份 vitest 配置的 `resolve.alias` 重复（`vitest.config.ts` ≡ `vitest.integration.config.ts`，14 行字节相同）；合并必须在 `projects` 层 `extends`，**顶层 `extends` 实测不继承 alias**（见处置表）。附带把 `package.json:22-23` 两条字符串相同的 `test`/`test:unit` 收成一条。
- **Fix E（本地环境卫生，不改仓库）**：`node_modules` 现约 920 MB，其中约 186 个 `.pnpm` 目录是更早安装的孤儿（`react@19.1.0`、`radix-ui@1.4.2`、`vitest@3.2.7`、`autoprefixer@10.4.21` 等，均不在 `pnpm-lock.yaml` 里）。跑一次 `pnpm prune` 或删除 `node_modules` 重装即可；**这不属于提交内容**，也不影响 CI（CI 每次干净安装）。
- 以上各为一次独立提交（Fix E 除外，它不产出 commit），本计划不实现，仅登记，防止查到的问题被遗忘。

---

## Global Constraints

- **不新增任何运行期依赖**（ADR 0009 §1：新依赖必须替换 ≥100 行自写代码或涉及安全/协议；本计划全是减法与执行者，无一例）。
- **不修改任何已提交历史迁移** `0000`–`0012`（`_journal.json` idx 0–12）。结构变更**只追加** `0013+`；新迁移必须能在空库一次执行、不夹带数据修复（AGENTS §7 规则 9）。
- **不删被 ADR 保护的东西**：`pg`+`postgres` 双驱动（ADR-19）、`next-themes`、`postcss`+`@tailwindcss/postcss`、zustand 工作区边界（ADR-21）、TanStack 双缓存、4 个只读 Route Handler（ADR-0008）、Biome、`lib/db/auth-schema.ts`。要动其中任何一个，先立新 ADR，不在本计划里顺手做。
- **`pg_trgm` 扩展与 `idx_article_search` 保留**（E3/FR-ART-5）；本轮只移除 `idx_node_search`。
- **不新增后台任务 / 队列 / 定时器 / 常驻进程**（ADR 0005 / ADR-23）。
- **不执行 `src/modules` 重构、不引入 `*.service.ts`/`*.repo.ts`**（AGENTS 禁止清单 #10）；不重做 10-26 计划内容。
- **不修改 `auth.*` 表结构，不碰 Better Auth 会话/密码/成员写路径**（ADR 0007）。
- **`drizzle-orm`/`drizzle-kit` 不随 `pnpm update` 漂**（ADR 0009 §2）；Task 5 是给它加执行者，不是升版本。
- **每个删除动作前跑 grep 并把证据贴进 commit message**；「有执行者的东西不删」。
- 面向用户文案简体中文；库名/列名/日志/错误码英文；不引入裸色值（`tests/design-system.test.ts`）。
- 每任务结束前 `pnpm check && pnpm typecheck && pnpm test` 全绿；涉及真实 SQL/索引/迁移 → 补 `pnpm test:integration`。
- 迁移与业务代码分开提交；每个迁移单独 commit 且人工 review SQL（AGENTS §7 规则 8）。
- 新增测试文件必须匹配 `vitest.config.ts:7` 的 `tests/*.test.ts` / `tests/*.test.tsx` glob（放子目录就不会被单测跑到）。
- **F6 ratchet**：8 个豁免文件「只准缩不准涨」，涨过登记线即 `arch:check` 红。本计划会改到的豁免文件里，`components/lineage/lineage-detail.tsx` 当前 **864 行 / 上限 865——只剩 1 行余量**，Task 4 必须净减或持平（把内联谓词换成一次 `matchesNode` 调用本就会缩短）。改完必跑 `pnpm arch:check`。
- 改文档后必须 `pnpm run docs:check --strict` 绿；注意 `check-docs.mjs` 会校验 markdown **链接目标存在**与 stale-path 短语——新 ADR 必须先建文件再被 README 链接。
- 改文档后必须 `pnpm run docs:check --strict` 绿。

---

## Review Focus

以下五类输入/条件，规格没有明说，但正常用户或下一次改动一定会撞上，且最容易被本轮改动打破。每条都钉到拥有该代码的任务：

1. **未来有人给 `node` 加回 trigram 搜索或写 `full_name % q`**：那时 `idx_node_search` 必须先回来，且必须和查询**同一次**回来，否则又变成 E1 的孤儿索引（付写成本、无人消费）。期望行为是 ADR 0011 的边界被尊重：**要服务端搜索 = 先改 ADR**。执行者是 `tests/integration/search-boundary.test.ts`（Task 1）：每天对真实库断言 `node` 无 `gin_trgm_ops` 索引、`article` 有、`pg_trgm` 扩展在。加回索引会红一次，那一行的 diff 就是评审看「配套查询是否同时进来」的时刻。**不写迁移文本解析器**当执行者——`0001_auth_rls.sql` 永久含 `gin_trgm_ops` 字样（历史迁移不可改），任何「扫迁移文件里有没有 trigram」的朴素规则都会**永久为真**、进而永久要求源码里有 trigram 运算符：一个假阳性到死的检查比没有检查更坏。以数据库实际状态为 oracle。
2. **dotenv 挪出 `lib/**` 后，非 Next 入口仍能读到环境变量**：`db:seed`（tsx）、`verify-deployment.mjs`、集成测试 helper 都**不经过 Next 的 .env 加载**。收得过窄会以 `POSTGRES_URL undefined` 崩。期望行为：**脱离 Next 运行时的入口各加载一次；在 Next 运行时里的模块一次都不加载**。测试见 Task 3 Step 1（`lib/**` 无 dotenv import）与 Step 5/6（三个非 Next 入口仍绿 + `pnpm db:seed` 可用）。
3. **搜索谓词合并是一次语义放宽**：世系表从 4 个自身字段放宽到 8 个会**多命中**——原先漏掉的 `birthText`/`deathText`/`burialPlace` 首次出现在表格里（生卒年、葬地是修谱里的真实检索需求，FR-LIN-11 只写「按姓名模糊搜索」，所以这属于**超出规格的额外命中**，要确认产品接受）。注意 `name` **不是**差异项：`fullName = surname + name` 是写侧不变式（E7），表格匹配 `fullName` 已覆盖它。期望行为是**同一 query，画布与世系表命中同一批人丁**，且该一致性被钉住、表格不再自带字段列表。测试见 Task 4 Step 1（三列真实差异 + `name` 冗余性回归）与 Step 4（结构断言）。
4. **ORM 版本执行者不能假阳性红**：`drizzle-orm` 是 `^0.45.4`（caret），CI `--frozen-lockfile` 不重算，装的是某个 `0.45.x`。断言必须是「**实际安装** major.minor 仍是 `0.45`」+「specifier 以 `^0.45.` 开头」，**不能**断言等于精确 `0.45.4`——否则 `0.45.9` 补丁误红，且专门升级 PR 里合法升补丁还要附带改测试。期望：补丁可进、次版本不可漂、1.0 必红。测试见 Task 5 Step 1——含 `it.each` 的三态用例（`0.45.9` 放行 / `0.46.0` 与 `1.0.0` 必红）与「先把它临时改红一次再改回」的证伪动作。
5. **两个新 ADR 不能被读成「现在就去装包 / 现在就去改搜索」**：10-25 的教训正是「文档承诺了不存在的依赖（RHF）」。ADR 0010 必须含加粗「**决策 ≠ 现在安装**」，ADR 0011 必须写清「客户端搜索是当前实现的事实，不是待办」。执行者是 `check-docs.mjs` 的 pending 检测（把 `D-9` 加进已解决清单，`decisions/README.md:28` 的 ADR-13 行改为指向 0011）+ Task 6 Step 4 的依赖禁用断言。
6. **加索引不能顺手往 `schema.ts` 塞一行**（E14 是本轮最大的落地陷阱）：`lib/db/schema.ts` 现在 688/688、`node-services.ts` 875/875——**8 个豁免文件里 6 个零余量**，加一行代码或一行索引声明都会让 `arch:check` 立刻红，而失败信息是「exceeds its exemption ceiling」，不看计划的人查不出原因。期望行为是**新索引只写 custom migration**（与 `idx_node_search` 同先例），漂移检查（`ci.yml:92-93`）仍绿。测试见 Task 7 Step 6：`pnpm db:generate && git status --porcelain lib/db/migrations` **必须为空**；若非空，说明先例不适用，那时转为「schema.ts 需先拆分」的移交项，**不要硬塞一行把 gate 弄红**。
7. **索引测试不能依赖数据量**：空/小测试库上规划器永远选 Seq Scan，一条「EXPLAIN 必须走 Index Scan」的断言在索引真的建好之后**仍会红**——那会诱导人删掉正确的索引。期望行为是用 `set enable_seqscan = off` + 字面 UUID 常量测「索引是否存在且匹配谓词」，并**必须 `reset`**，否则污染同文件后续用例。测试见 Task 7 Step 2（子查询取 id 的写法被明确否决：无夹具库上返回 NULL，计划退化为一行 Result，测不到索引匹配）。

---

## File Structure

| 文件 | 动作 | 本轮职责 |
|---|---|---|
| `docs/decisions/0011-search-boundary-node-client-article-trgm.md` | 新建 | 把 ADR-13 落成与实现一致：人丁搜索留在客户端全量匹配；`pg_trgm` 只服务 `article`（FR-ART-5）；`node` 不建 trigram 索引 |
| `lib/db/migrations/0013_drop_node_trgm.sql` | 新建（**手写 custom**，非 `db:generate`：该索引不在 `schema.ts` 的 `index()` 里，generate 不会为它产出 DROP） | 只 `DROP INDEX IF EXISTS "idx_node_search"`；**不动扩展、不动 `idx_article_search`** |
| `lib/db/migrations/meta/_journal.json` | 修改 | 登记 idx 13（照 0006/0012 custom 条目的格式） |
| `tests/integration/search-boundary.test.ts` | 新建 | 真实库执行者：`node` 无 `gin_trgm_ops`、`article` 有、`pg_trgm` 扩展在；也是「孤儿 trigram 索引不许再回来」的常驻红牌 |
| `docs/decisions/README.md` | 修改 | ADR-13 行指向 0011；待决策 D-9 移除并入「已解决」 |
| `scripts/check-docs.mjs:242` | 修改 | 已解决清单 `['D-1','D-2','D-3','D-5','D-7']` 加 `'D-9'`（否则决策转 ADR 后仍留在待决策表也无人报） |
| `package.json` | 修改 | 删 `autoprefixer` |
| `components/ui/tabs.tsx` | 删除 | 零 importer（E5） |
| `lib/db/auth-db.ts` | 修改 | 删 `resetAuthDb`；删 dotenv import/`config()`；保留 `closeAuthDb` |
| `lib/db/drizzle.ts` | 修改 | 删 dotenv import/`config()` |
| `scripts/load-env.mjs` | 新建 | 唯一的「脱离 Next 运行时」dotenv 加载 shim |
| `scripts/verify-deployment.mjs`、`tests/helpers/db.ts`、`tests/helpers/db-url.ts`、`lib/db/seed.ts` | 修改 | 改为显式加载一次 env |
| `tests/env-bootstrap.test.ts` | 新建 | 执行者：`lib/**` 运行期模块不含 `dotenv` |
| `components/lineage/derived.ts:189` | 修改 | `matchesNode` 导出（唯一搜索谓词） |
| `components/lineage/lineage-detail.tsx:411-426` | 修改 | 删内联 4 字段谓词改调 `matchesNode`；加 `useDeferredValue` |
| `tests/lineage-search-consistency.test.ts` | 新建 | 执行者：跨视图命中一致 + 表格不再自带字段列表 |
| `tests/dependency-pins.test.ts` | 新建 | 执行者：ADR 0009 §2 ORM 钉版（实际安装版本 + specifier 形态） |
| `docs/decisions/0010-rich-text-editor-selection.md` | 新建 | D-9 闭合；含「决策 ≠ 现在安装」标注 |
| `tests/docs-consistency.test.ts` | 修改 | ADR 0010 用例 + `check-docs` D-9 检测断言 |
| `docs/implementation-status.md`、`docs/architecture/05-data.md` | 修改 | 同步本轮变更（索引边界、删除项、执行者清单） |
| `lib/db/migrations/0014_spouse_sort_index.sql` | 新建（**手写 custom**，同 0013） | 补 `nextSpouseSort` 缺的等值索引；**不改 `lib/db/schema.ts`**（见 Task 7 前提） |
| `lib/db/migrations/meta/_journal.json` | 修改 | 登记 idx 14 |
| `tests/integration/spouse-sort-index.test.ts` | 新建 | 执行者：真实库断言该索引存在且被 `EXPLAIN` 选中 |

---

## Task 1: 让 ADR-13「检索」与实现一致，删掉零消费者的 `idx_node_search`

**Files:**
- Create: `docs/decisions/0011-search-boundary-node-client-article-trgm.md`
- Create: `lib/db/migrations/0013_drop_node_trgm.sql`（手写 custom migration）
- Modify: `lib/db/migrations/meta/_journal.json`、`docs/decisions/README.md`、`docs/data-model.md:662-663,669-677`、`docs/implementation-status.md:71`、`docs/architecture/05-data.md`
- Test: `tests/integration/search-boundary.test.ts`

**Interfaces:**
- Consumes: 无代码接口。
- Produces: 一条数据库存在性不变式（后续任务与未来搜索改动都必须满足）：`node` 表上**没有** `gin_trgm_ops` 索引；`article` 表上**仍有** `idx_article_search`；`pg_trgm` 扩展**仍在**。`node.full_name`、`article.plain_text` 两列都**保留**（都被读，只是不再都建 trigram 索引）。

- [ ] **Step 1: 先证明「今天确实无 trigram 消费者」（只读，不改）**

Run: `grep -rn "searchNodes" lib app components tests | grep -v .worktrees` 与 `grep -rn "ILIKE\|ilike\|similarity\|%" lib/db/queries lib/lineage --include=*.ts`
Expected: 第一条**空**（实现已随 `ee41526` 删除）；第二条无 trigram 谓词。**若第一条非空**，说明 trigram 搜索已被接线，E1 过时 → 本任务作废，转为给该查询补集成测试，不要删索引。

- [ ] **Step 2: 写 ADR 0011（先写决策，再动数据库）**

沿用 0009 的四段结构（`^## 决策`、`^## 后果`、`^## 放弃的方案`、`^## 重估触发条件`——`tests/docs-consistency.test.ts:139-144` 断言的就是这四个标题，缺一个 `pnpm test` 就红）。内容要点：
- **决策**：人丁搜索**留在客户端**（`getNodes` 全量载入 + `matchLineagePerson` 内存匹配，已实现、已有测试、画布即时过滤与定位依赖它）；`pg_trgm` + trigram 索引**只保留给 `article`**（FR-ART-5）；`node` 表不建 trigram 索引。
- **为什么**：E1/E2——`idx_node_search` 服务零查询却在最热写列上付 GIN 写放大；客户端全量匹配已满足 FR-LIN-11。
- **重估触发条件**：单谱系人丁量超过约 5000、或 `getNodes` 全量载入不再可行（`data-model.md:677` 已给十万级/500 万行的外部索引触发线）→ 那时**先改本 ADR**，再在同一改动里同时加回 `idx_node_search` 与服务端查询，并放宽 Task 1 Step 4 的断言。
- 明确一句：**「客户端搜索是当前实现的事实，不是待办」**（Review Focus #5）。

- [ ] **Step 3: 写 failing 集成测试 `tests/integration/search-boundary.test.ts`**

用 `tests/helpers/db.ts` 的 `getTestSql()`（postgres.js 模板串），三条断言：

```ts
// 1. node 上不应再有 trigram 索引（本轮要达成的状态）
const nodeTrgm = await sql`
  select indexname from pg_indexes
  where schemaname = 'public' and tablename = 'node' and indexdef ilike ${'%gin_trgm_ops%'}
`;
expect(nodeTrgm).toEqual([]);

// 2. article 的 trigram 索引必须还在（FR-ART-5 的前提，不许连坐删）
const articleTrgm = await sql`
  select indexname from pg_indexes
  where schemaname = 'public' and tablename = 'article' and indexdef ilike ${'%gin_trgm_ops%'}
`;
expect(articleTrgm.map((r) => r.indexname)).toEqual(['idx_article_search']);

// 3. 扩展必须还在（article 索引依赖它）
const ext = await sql`select extname from pg_extension where extname = 'pg_trgm'`;
expect(ext.length).toBe(1);
```

Run: `pnpm test:integration tests/integration/search-boundary.test.ts`
Expected: FAIL —断言 1 不满足（当前库里 `idx_node_search` 仍在）。断言 2、3 此刻应已满足（它们是护栏，不是变更目标）。

- [ ] **Step 4: 手写迁移 `lib/db/migrations/0013_drop_node_trgm.sql`**

照 `0006_statement_timeouts.sql` / `0012_equal_lockjaw.sql` 的手写 custom-migration 先例；`--> statement-breakpoint` 分隔语句（`db:migrate` 逐条执行）。**只一条 DROP，绝不写 `DROP EXTENSION`**：

```sql
-- idx_node_search has had no consumer since ee41526 deleted searchNodes: no query
-- in the app uses a trigram operator, and person search matches in memory over the
-- fully loaded lineage (ADR 0011). The GIN index still pays trigram decomposition
-- on every write to node.full_name, the app's hottest write column.
-- pg_trgm and idx_article_search stay: FR-ART-5 (article full-text search) needs
-- them the day 谱文 is implemented. Re-adding a trigram index on node requires
-- changing ADR 0011 first, in the same change as the query that uses it.
DROP INDEX IF EXISTS "idx_node_search";
```

- [ ] **Step 5: 登记进 journal**

在 `lib/db/migrations/meta/_journal.json` 的 `entries` 末尾追加 `idx: 13`、`tag: "0013_drop_node_trgm"`、`breakpoints: true`、新 `when` 时间戳——**先读 0006/0012 的条目确认手写 custom 迁移在本仓库实际是怎么登记的**，照抄格式。

- [ ] **Step 6: 迁移并验证测试转绿**

Run: `pnpm db:migrate && pnpm test:integration tests/integration/search-boundary.test.ts`
Expected: 迁移无报错；三条断言全 PASS。
再跑一次空库全量：`pnpm test:integration tests/integration/migrations.test.ts`，确认「空库一次执行」这条（AGENTS §7 规则 9）没破。

- [ ] **Step 7: 证明迁移漂移检查不红**

Run: `pnpm db:generate && git status --porcelain lib/db/migrations`
Expected: 空。`idx_node_search` 不在 `schema.ts` 的 `index()` 里，generate 本就不认它。**若非空**（generate 反过来把它加回来了），说明有文件声明了它——`grep -n "idx_node_search\|gin_trgm" lib/db/schema.ts` 定位并按 custom-migration 先例处理，不要提 generate 产物。

- [ ] **Step 8: 同步文档（ADR-13 行 + data-model 索引表 + 实现状态）**

- `docs/decisions/README.md:28`：ADR-13 行末补 `[0011](./0011-search-boundary-node-client-article-trgm.md)`。
- `docs/data-model.md:662`：`idx_node_search` 行改为「已删除，见 ADR 0011」或整行移除（与 `:663` 的 article 行区分开）。
- `docs/implementation-status.md:71`：扩展行去掉「GIN/GiST 索引已建立」的对 `node` 的暗示，改为「`pg_trgm` 保留给 `article`；`node` 搜索在客户端」。
- `docs/architecture/05-data.md`：补一句边界。

Run: `pnpm run docs:check --strict`
Expected: PASS（0 issue）。

- [ ] **Step 9: Commit（迁移单独一提，先只提迁移）**

```bash
git add lib/db/migrations/0013_drop_node_trgm.sql lib/db/migrations/meta/_journal.json
git commit -m "perf(db): 删除零消费者的 idx_node_search trigram 索引

证据：searchNodes 已随 ee41526 删除，全仓无 trigram 运算符消费者；
node 全库唯一 trigram 索引，写放大付在最热的 full_name 列上（每写一次人丁）。
保留 pg_trgm 与 idx_article_search（FR-ART-5）。见 ADR 0011。"
```

```bash
git add docs/decisions/0011-search-boundary-node-client-article-trgm.md docs/decisions/README.md docs/data-model.md docs/implementation-status.md docs/architecture/05-data.md tests/integration/search-boundary.test.ts
git commit -m "docs(decisions): ADR 0011 让检索决策与实现一致，索引边界进集成测试

ADR-13 有决策无文件无执行者（ADR-24 定义的「视为未决策」）。
新增 search-boundary.test.ts 对真实库断言 node 无 trigram、article 有、扩展在。"
```

---

## Task 2: 删四个被证明零引用的依赖 / 文件 / 导出

**Files:**
- Modify: `package.json`（删 `autoprefixer`、删 `@better-auth/drizzle-adapter`）、`pnpm-lock.yaml`
- Delete: `components/ui/tabs.tsx`
- Modify: `lib/db/auth-db.ts`（删 `resetAuthDb`）

**Interfaces:**
- Consumes: 无。
- Produces: 无新接口。**`closeAuthDb` 必须保留**——`tests/integration/setup.ts:2,27` 依赖它；`resetAuthDb` 的删除不得波及。

- [ ] **Step 1: 四条零引用证明（只读，逐条留证据）**

```bash
grep -rn "autoprefixer" --include=*.json --include=*.mjs --include=*.ts . | grep -v node_modules | grep -v .worktrees
grep -rn "ui/tabs" app components lib hooks tests scripts | grep -v .worktrees
grep -rn "resetAuthDb" --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v .worktrees
grep -rn "from '@better-auth/drizzle-adapter'" lib app components hooks tests scripts | grep -v node_modules
```
Expected: 第一条只剩 `package.json:32,37` 里的声明行本身（`postcss.config.mjs` 里只有 `@tailwindcss/postcss`）；第二条**完全空**；第三条只剩 `lib/db/auth-db.ts:70` 定义行；第四条**完全空**。任一出现真实消费者 → 把该项从本任务剔除，并在计划里记一行「证伪」。

> **第四条为什么安全**：代码走 `lib/auth/better-auth.ts:4` 的 `import { drizzleAdapter } from 'better-auth/adapters/drizzle'`，而 `better-auth/package.json:180-182` 显示该 subpath 由 **better-auth 自带**（`dev-source: ./src/adapters/drizzle-adapter/index.ts`），且 `better-auth` 把 `@better-auth/drizzle-adapter: 1.7.12` 声明为**自己的 prod 依赖**——与根 pin **同版本**。根 pin 不贡献任何代码路径，只多产生一个物理实例：`ls -d node_modules/.pnpm/@better-auth+drizzle-adapter@1.7.12*` → **两个不同 hash 的目录**（根 symlink 与 better-auth 的 nested 解析到不同实例）。删根 pin 后 adapter 仍由 better-auth 提供。
> 与 10-25 评审 S2-3「两份 drizzle 适配器类型用 `as unknown as Db` 抹平」**无关**——那是驱动分叉的代价（ADR-19 保护线），本步不碰。

- [ ] **Step 2: 删两条 package.json 声明**

从 `package.json:37` 删 `"autoprefixer": "10.6.1",`；从 `package.json:32` 删 `"@better-auth/drizzle-adapter": "1.7.12",`。**本步只改 package.json**，lock 留到 Step 5 单独重算，失败时易定位。

> `@better-auth/drizzle-adapter` 删的是**根 pin**，不是能力：adapter 由 `better-auth` 自己的依赖继续提供（E5）。删完后 `pnpm typecheck` 仍必须绿——它就是这个删除的证明。

- [ ] **Step 3: 删 `components/ui/tabs.tsx`**

Run: `git rm components/ui/tabs.tsx`（87 行、0 importer，E5）

- [ ] **Step 4: 删 `resetAuthDb`**

删 `lib/db/auth-db.ts:70-72` 整个函数（函数体只有 `await closeAuthDb();`）。`read` 复核后删；**保留 `closeAuthDb`**。

- [ ] **Step 5: 重算 lock 并证明冻结安装仍通过**

Run: `pnpm install && pnpm install --frozen-lockfile`
Expected: 两步都成功，且**无** `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（本任务只**删**依赖，不新增/漂移任何受 `minimumReleaseAge` 影响的包，故不触发 ADR 0009 §2 记录的那个坑；那条坑针对的是给仍被使用的包去掉 `^`）。
`git diff pnpm-lock.yaml` 只应显示 autoprefixer 的**独占闭包**（8 项：`autoprefixer`/`browserslist`/`update-browserslist-db`/`caniuse-lite@1.0.30001819`/`electron-to-chromium`/`fraction.js`/`postcss-value-parser`/`normalize-range`）与根层 `@better-auth/drizzle-adapter` symlink 的移除；`caniuse-lite` 应从双版本回到单版本（另一份是 next 自带）。**若删掉了别人也需要的传递依赖 → 回 Step 1 复核。**

- [ ] **Step 6: 用既有门禁证明删除安全（不新增测试文件）**

Run: `pnpm typecheck && pnpm check && pnpm build && pnpm test`
Expected: 全绿。`typecheck` **同时**证明无人 import `tabs`/`resetAuthDb`/根 pin 的 adapter（`better-auth/adapters/drizzle` 的类型来自 better-auth 自身）；`build` 证明 CSS 流水线不需要 `autoprefixer`（`globals.css:1 @import "tailwindcss"` 走 `@tailwindcss/postcss`）；`--frozen-lockfile` 在 CI 侧证明 lock 未失配。

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml components/ui/tabs.tsx lib/db/auth-db.ts
git commit -m "chore(deps): 删除零引用面 autoprefixer / ui/tabs / resetAuthDb / adapter 根 pin

证据（Step 1 四条 grep，均只剩定义本身）：
- autoprefixer 不在 postcss.config.mjs，Tailwind v4 由 @tailwindcss/postcss 出前缀；
  其独占闭包 8 项，也是 caniuse-lite 双版本的唯一原因
- components/ui/tabs.tsx 0 importer（shadcn 预置未用）
- resetAuthDb 0 调用方，调用面只用 closeAuthDb
- @better-auth/drizzle-adapter 根 pin 0 代码引用：走 better-auth/adapters/drizzle，
  better-auth 自带该 adapter 并声明同版本依赖；根 pin 只多一个物理实例
ADR 0009 §1：依赖只减不增，删掉不需要理由，留着才需要。"
```

---

## Task 3: dotenv 从被 serverless import 的运行时模块里挪出去

**Files:**
- Create: `scripts/load-env.mjs`
- Modify: `lib/db/drizzle.ts`、`lib/db/auth-db.ts`（删 dotenv）；`scripts/verify-deployment.mjs`、`tests/helpers/db.ts`、`tests/helpers/db-url.ts`、`lib/db/seed.ts`（显式加载一次）
- Test: `tests/env-bootstrap.test.ts`

**Interfaces:**
- Consumes: `dotenv` 的 `config`（devDependency，Task 2 不动它）。
- Produces: `scripts/load-env.mjs` 导出 `loadEnv(): void`——幂等（内部 `loaded` 标志），首次调用 `config({ quiet: true })`。**不变式**：`lib/**` 中运行期（被 Next server bundle import 的）模块不得 `import ... from 'dotenv'`。

- [ ] **Step 1: 写 failing 测试 `tests/env-bootstrap.test.ts`**

复用 `tests/docs-consistency.test.ts:1-16` 的 `readdirSync/statSync/readFileSync` 递归读法（本仓库不依赖 `glob` 包，保持一致）。正则要**同时**抓 `from 'dotenv'` 与 `'dotenv/config'` 两种形态，否则「换个写法绕过不变式」就白做了：

```ts
const RUNTIME_ALLOWLIST = new Set(['lib/db/seed.ts']); // 见 Step 5：dev CLI 入口，恰好住在 lib/ 下

// lib 运行期模块不得加载 dotenv：那是启动职责，属于入口/bootstrap
for (const file of listTs('lib')) {
  if (RUNTIME_ALLOWLIST.has(file)) continue;
  const src = readFileSync(join(root, file), 'utf8');
  expect(src, `${file} 不应加载 dotenv（非 Next 入口改用 loadEnv）`)
    .not.toMatch(/['"]dotenv(\/config)?['"]/);
}
```

Run: `pnpm test tests/env-bootstrap.test.ts`
Expected: FAIL（`lib/db/drizzle.ts:4`、`lib/db/auth-db.ts:4` 命中）。

- [ ] **Step 2: 建 `scripts/load-env.mjs`**

```js
import { config } from 'dotenv';

let loaded = false;

/** Load .env once for entry points that run outside the Next.js runtime. */
export function loadEnv() {
  if (loaded) return;
  // Keep startup output quiet; dotenv >= 17 logs an injection summary by default.
  config({ quiet: true });
  loaded = true;
}
```

- [ ] **Step 3: 从两个运行时模块删 dotenv**

`lib/db/drizzle.ts`：删第 4 行 `import { config } from 'dotenv';` 与第 16-17 行注释 + `config({ quiet: true });`。
`lib/db/auth-db.ts`：删第 4 行 import 与第 15-16 行注释 + `config({ quiet: true });`。
（两者只经 `getServerConfig()` 读 `process.env`，不负责加载。）

- [ ] **Step 4: 非 Next 入口显式加载**

`scripts/verify-deployment.mjs`、`tests/helpers/db.ts`、`tests/helpers/db-url.ts`：把各自的 `import { config } from 'dotenv'` + `config({ quiet: true })` 换成 `import { loadEnv } from '<相对路径>/load-env.mjs'` 并在文件顶部调用 `loadEnv()`（helper 里必须在**读 `process.env.POSTGRES_URL` 之前**，`tests/helpers/db.ts:10-16` 的 `getTestDatabaseUrl()` 在模块顶层执行，顺序敏感）。
测试文件走 vitest alias，可用 `@/scripts/load-env.mjs`（与现有 `tests/arch-check.test.ts:2-3` import `.mjs` 同法，已验证可解析）。

- [ ] **Step 5: `lib/db/seed.ts` 单独处理（它是 dev-only 脚本，不是运行期模块）**

`pnpm db:seed` 经 `npx tsx --conditions=react-server` 跑（`package.json:13`），不走 Next 的 env 加载；`seed.ts:1-4` 目前靠它 import 的 `./drizzle` 触发 dotenv——Step 3 删掉那处后就断了。在 `lib/db/seed.ts` 顶部加 `import 'dotenv/config';`（与 Step 1 的正则一致，会被 `['"]dotenv(\/config)?['"]` 命中，故 Step 1 的白名单 `RUNTIME_ALLOWLIST` 里那一条**是真会生效的**，不是死代码）。
> 为什么 seed 可以例外而 `drizzle.ts`/`auth-db.ts` 不行：seed 只被 `db:seed` 这一个 dev 入口 import，不进 server bundle；后两者被 29 个模块 import、每个 serverless 冷启动都执行。不变式的边界是「是否被 server bundle import」，不是「是否在 `lib/` 下」。白名单用文件路径集合显式表达这一条边界，注释写明理由。

- [ ] **Step 6: 验证 env 真的读到了**

Run: `pnpm test tests/env-bootstrap.test.ts && pnpm test:integration tests/integration/health.test.ts`
Expected: env-bootstrap PASS；health 集成测试不因 `POSTGRES_URL undefined` 失败。
Run: `pnpm db:seed`
Expected: 正常灌数据（不报缺 URL）。
Run: `node scripts/verify-deployment.mjs --base-url http://127.0.0.1:3099 || true`
Expected: 走到「连不上 3099」是**预期**（无服务）；关键是它已读到 DB URL 并尝试连接，而不是以 URL undefined 崩。

- [ ] **Step 7: 全量绿 + Commit**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm arch:check`
Expected: 全绿（`arch:check` 的 F7 仍只允许 `lib/config.ts` 读 `process.env`，本改动没新增读者）。

```bash
git add scripts/load-env.mjs lib/db/drizzle.ts lib/db/auth-db.ts scripts/verify-deployment.mjs tests/helpers/db.ts tests/helpers/db-url.ts lib/db/seed.ts tests/env-bootstrap.test.ts
git commit -m "refactor(config): dotenv 加载收拢到非 Next 入口，运行时模块不再模块级加载

证据 E6：5 处模块级 config() 中 2 处属被 serverless import 的 lib/db 模块，
每次冷启动都执行一遍；加载职责散在 5 个入口。新不变式由 env-bootstrap.test.ts 执行。"
```

---

## Task 4: 搜索谓词收成一处，修跨视图行为分叉 + 输入去抖

**Files:**
- Modify: `components/lineage/derived.ts:189`（`matchesNode` 导出）
- Modify: `components/lineage/lineage-detail.tsx:411-426`（删内联 4 字段谓词、加 `useDeferredValue`）
- Test: `tests/lineage-search-consistency.test.ts`

**Interfaces:**
- Consumes: `NodeView`（`components/lineage/types.ts`）；`LineageIndex.spousesByBlood: Map<string, NodeView[]>`（`derived.ts:7`——配偶也是 `NodeView`，可直接喂同一谓词）。
- Produces: `export function matchesNode(node: NodeView, needle: string): boolean`——全仓**唯一**人丁搜索谓词；`needle` **必须已由调用方 `trim().toLowerCase()`**（沿用现状：`matchLineagePerson:207` 就是这么归一化的，本任务不改）。消费方：`derived.ts:216,221`（画布，已在用）与 `lineage-detail.tsx` 的 `visibleBlood`（表格，本任务改为用它）。

> 为什么不靠渲染组件跑端到端一致性：`lineage-detail.tsx` 是 864 行的客户端组件，且**在 F6 豁免预算内（只准缩不准涨）**。真正要钉的是「存在两份字段列表且已分叉」，所以钉两件事：谓词函数的命中集合，以及表格里不再存在第二份字段列表。

- [ ] **Step 1: 写 failing 测试 `tests/lineage-search-consistency.test.ts`**

抄 `tests/lineage-canvas-layout.test.ts:34-45` 的 `person()` 构造风格，在测试内写一个本地 `node(overrides)` 构造器（保持单测自足，不跨文件 import 测试辅助）。构造器约束（照该文件已有的默认值）：必填 `id` / `name` / `generation`，默认 `role: 'blood'`、`parentId: null`、`spouseOfId: null`、其余文本字段 `null`；**`fullName` 由构造器算成 `surname + name`**——那是写侧不变式（E7），测试数据不一致会让断言失去意义。`role: 'blood'` 是硬要求：`buildLineageIndex`（`derived.ts:28-30`）只把 `role === 'blood'` 放进 `index.blood`，而 `matchLineagePerson` 只遍历 `index.blood`。断言三类真实差异输入：

```ts
import { buildLineageIndex, matchLineagePerson, matchesNode } from '@/components/lineage/derived';

// 真实差异三列：只有画布谓词匹配，世系表原先漏
for (const field of ['birthText', 'deathText', 'burialPlace'] as const) {
  const n = node({ id: `n-${field}`, name: '某', [field]: '崇祯十七年' });
  expect(matchesNode(n, '崇祯')).toBe(true);
  // 画布同一 query 命中同一人丁 → 两视图同源的证明
  expect(matchLineagePerson(buildLineageIndex([n]), '崇祯')?.matchedId).toBe(n.id);
}

// 回归：`name` 不是差异项（fullName = surname + name，表格匹配 fullName 已覆盖）。
// 这条防止后来的人误以为「合并谓词」会让 name 搜索发生变化。
const n = node({ id: 'x', name: '鼎', surname: '王' }); // fullName 派生为 '王鼎'
expect(matchesNode(n, '鼎')).toBe(true);
expect('王鼎'.includes('鼎')).toBe(true);               // 表格旧谓词同样命中 → 行为不变
```

Run: `pnpm test tests/lineage-search-consistency.test.ts`
Expected: FAIL —`matchesNode` 尚未导出（import 报错 / 不是函数）。

- [ ] **Step 2: 导出 `matchesNode`**

`components/lineage/derived.ts:189`：`function matchesNode` → `export function matchesNode`。其余不动（`matchLineagePerson` 已在 `:216,221` 调它）。

- [ ] **Step 3: 跑通**

Run: `pnpm test tests/lineage-search-consistency.test.ts`
Expected: PASS。

- [ ] **Step 4: 表格改用 `matchesNode` + `useDeferredValue`**

`lineage-detail.tsx`：
1. 把 `matchesNode` 并进**第 29 行已有的** `import { … } from '@/components/lineage/derived'`（别新开一行，文件在 F6 预算内）。
2. `visibleBlood`（`:411-426`）的内联字段判断换成：

```ts
return bloodNodes.filter((node) => {
  const spouses = spousesByBlood.get(node.id) ?? [];
  return matchesNode(node, needle) || spouses.some((spouse) => matchesNode(spouse, needle));
});
```

3. 消 E8 的 per-keystroke 全扫：`const deferredQuery = useDeferredValue(tableQuery);`，`needle`（`:412`）从 `deferredQuery` 算，`visibleBlood` 的 `useMemo` 依赖由 `tableQuery` 改为 `deferredQuery`（`useDeferredValue` 从 `react` 引入）。

4. 同一测试里加结构断言（这条是**执行者**，不依赖渲染）：

```ts
const src = readFileSync('components/lineage/lineage-detail.tsx', 'utf8');
// 改动前 :419-423 有 5 处逐列 `.toLowerCase().includes(needle)`；改动后必须为零
expect(src).not.toMatch(/\.toLowerCase\(\)\.includes\(needle\)/);
expect(src).toMatch(/import \{[^}]*matchesNode[^}]*\} from '@\/components\/lineage\/derived'/);
expect(src).toMatch(/useDeferredValue\(tableQuery\)/);
```

> 正则已核对过实际文件：改动后仅剩 `const needle = deferredQuery.trim().toLowerCase();`（后面不接 `.includes(needle)`），第一条断言成立；改动前任一条即红。

- [ ] **Step 5: 确认没有回归画布搜索（已有覆盖，别弄坏它）**

Run: `pnpm test tests/lineage-canvas-layout.test.ts && pnpm test && pnpm typecheck && pnpm check`
Expected: 全绿——特别是 `:468-480` 那四条既有搜索断言（配偶命中定位血亲、空串、不命中）必须仍然通过。

- [ ] **Step 6: Commit**

```bash
git add components/lineage/derived.ts components/lineage/lineage-detail.tsx tests/lineage-search-consistency.test.ts
git commit -m "fix(lineage): 搜索谓词单一来源，修世系表漏搜 + 输入去抖

证据 E7/E8：画布 matchesNode 匹配 8 个自身字段，世系表内联谓词只匹配 4 个——
只 birthText/deathText/burialPlace（生卒、葬地）命中的人丁在表格里搜不到。
（name 不是差异项：fullName = surname + name 是写侧不变式，表格匹配 fullName 已覆盖。）
表格改吃同一个 matchesNode；过滤加 useDeferredValue。
结构断言禁止再出现第二份字段列表。"
```

---

## Task 5: 给 ADR 0009 §2「钉死 ORM 版本」加执行者

**Files:**
- Create: `tests/dependency-pins.test.ts`

**Interfaces:**
- Consumes: `package.json`（`dependencies['drizzle-orm']`、`devDependencies['drizzle-kit']`）；`node_modules/drizzle-orm/package.json` 的 `version`。
- Produces: CI 会红的三条断言，编码 ADR 0009 §2：实际安装 `0.45.x`、specifier 形态为 `^0.45.`、`drizzle-kit` 为 `^0.31.`。
- **不修改 `tests/docs-consistency.test.ts:82-94`**：那条从 specifier 反算 minor 再比对 `implementation-status.md`，验的是**文档抄写一致**；本文件读**实际安装版本**，验的是**版本立场**。两份职责不同，互补，各自一处（AGENTS 单一事实源原则不冲突：事实源仍是 `package.json`，本文件不新增第三处版本号抄写）。

- [ ] **Step 1: 先写「证伪用例」——证明执行者会红（Review Focus #4）**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const installed = JSON.parse(
  readFileSync(join(root, 'node_modules/drizzle-orm/package.json'), 'utf8')
) as { version: string };

const minor = (v: string) => v.split('.').slice(0, 2).join('.');

describe('ADR 0009 §2 ORM 版本钉死', () => {
  it('钉的是实际安装版本，补丁可进、次版本与大版本不可漂', () => {
    expect(minor(installed.version)).toBe('0.45');
  });

  it('specifier 形态不变（^0.45.），不许顺手改成 ~ 或精确值', () => {
    expect(pkg.dependencies['drizzle-orm']).toMatch(/^\^0\.45\./);
    expect(pkg.devDependencies['drizzle-kit']).toMatch(/^\^0\.31\./);
  });

  it.each([
    ['0.45.9', '0.45', '补丁应放行'],
    ['0.46.0', null, '次版本必须红'],
    ['1.0.0', null, '1.0 必须红'],
  ] as const)('%s → %s（%s）', (version, expected) => {
    const passes = minor(version) === '0.45';
    if (expected === null) {
      expect(passes).toBe(false);
    } else {
      expect(passes).toBe(true);
    }
  });
});
```

> **先跑它证明前三条不是永远绿的**：临时把 `'0.45'` 改成 `'0.46'` 跑一次看 FAIL、改回；把正则临时改成 `/^~/` 跑一次看 FAIL、改回。两次都红过才继续。**为什么不断言精确 `0.45.4`**：ADR 0009 §2 明文记录了「不去掉 `^`」的原因是 `minimumReleaseAge` 会让 `pnpm install --frozen-lockfile` 红；写成前缀匹配，专门升级 PR 里合法升补丁不必附带改测试。

Run: `pnpm test tests/dependency-pins.test.ts`
Expected: 当前 PASS（装的是 `0.45.x`），且 Step 1 的两次临时改动各红一次。

- [ ] **Step 2: 全量绿**

Run: `pnpm test && pnpm typecheck && pnpm check`
Expected: 全绿。CI 的 `--frozen-lockfile`（`ci.yml:44`）保证装的是 lock 里的 `0.45.x`，所以本地与 CI 判定一致。

- [ ] **Step 3: Commit**

```bash
git add tests/dependency-pins.test.ts
git commit -m "test(deps): ADR 0009 §2 的 ORM 钉版获得执行者

证据 E9：docs-consistency.test.ts:82-94 只做 specifier→文档 的抄写一致，
pnpm update 把 specifier 与 implementation-status 一起改成 0.46 时它照样绿。
本测试读 node_modules 的实际安装版本 + specifier 形态，1.0 漂移会红。"
```

---

## Task 6: 闭合 D-9 富文本选型（定 ADR 0010，不装包），并让「转成 ADR 后必须从待决策表移除」有执行者

**Files:**
- Create: `docs/decisions/0010-rich-text-editor-selection.md`
- Modify: `docs/decisions/README.md`（待决策 D-9 移除 + 「已解决」补一行 + ADR-12 行改指向 0010）、`scripts/check-docs.mjs:242`、`tests/docs-consistency.test.ts`
- Modify: `docs/architecture/04-runtime.md:153`（`| 表单 | React Hook Form + Zod |` 是虚构陈述——D-10 不在本计划决策，但「文档承诺不存在的依赖」必须先止血成「未引入，见待决策 D-10」）

**Interfaces:**
- Consumes: 无代码。
- Produces: (a) ADR 0010，正文含 `^## 决策`/`^## 后果`/`^## 放弃的方案`/`^## 重估触发条件` 四段 + 字面「决策 ≠ 现在安装」+「尚未安装」；(b) `scripts/check-docs.mjs` 的已解决清单含 `D-9`；(c) `docs-consistency.test.ts` 一条新用例同时钉 (a)(b) 与「未安装时 `package.json` 不得有编辑器依赖」。

- [ ] **Step 1: 读先例再落笔（只读）**

Run: `grep -n "^## " docs/decisions/0009-dependency-and-runtime-stance.md`
Expected: 四段标题（`## 决策`/`## 后果`/`## 放弃的方案`/`## 重估触发条件`）。ADR 0010 必须同结构——`tests/docs-consistency.test.ts:139-144` 会按这四个标题断言 ADR 0009，同一条风格检查会盯上新文件。
再 `sed -n '/S1-1/,/S1-2/p' docs/reviews/2026-10-25-linus-stack-review.md` 取既有口径，别造第二套说法。

- [ ] **Step 2: 写 `0010-rich-text-editor-selection.md`**

内容要点（这是决策，不是实现）：
- **选定**：TipTap（ProseMirror 封装）作为谱文编辑器；`article.content` 存 ProseMirror JSON（承接 ADR-12 既有结论）。
- **ADR 0009 §5 三问逐一回答**：① 编码的不变式——正文结构由编辑器 schema 约束，不由字符串正则约束；`plain_text` 由 JSON **派生**，二者不可各写各的（这正是 `idx_article_search` 的前提，见 ADR 0011）。② 消灭的特殊分支——自写 contenteditable、选区、表格合并、粘贴清洗。③ 换掉它要改几个文件——被约束到 `lib/article/**` 与单个编辑器组件，不散落。
- **加粗一句：决策 ≠ 现在安装。** 谱文功能立项前，`package.json` 里不得出现编辑器依赖；提前装就是 Task 1 处理的那种「付成本、无消费者」的税。
- **重估触发条件**：TipTap 发布 2.x 稳定版；或 PRD FR-ART-2 的块级需求超出 5 种。

- [ ] **Step 3: `README.md` 待决策表移除 D-9，并把 `D-9` 加进 `check-docs.mjs` 的已解决清单**

- `docs/decisions/README.md`：从待决策表删掉 D-9 那一行；在「已解决」列表加一行 `- D-9（富文本选型）→ [ADR 0010](./0010-rich-text-editor-selection.md)`；ADR-12 行的「具体编辑器待决策，见 D-9」改为指向 0010。
- `scripts/check-docs.mjs:242`：`['D-1', 'D-2', 'D-3', 'D-5', 'D-7']` → 加上 `'D-9'`。
  > **为什么这一行是本任务真正的执行者**：现在的清单是硬编码的旧集合。不扩它，则「决策已转 ADR 但仍赖在待决策表里」这种漂移**没有任何东西会报**——这正是 ADR-24 禁止的「有名字没执行者」。加进清单后，若有人把 0010 撤了却没把 D-9 放回去、或反过来留了孤儿行，`docs:check --strict` 直接红。

Run: `pnpm run docs:check --strict`
Expected: PASS。
（临时把 D-9 那行贴回待决策表再跑一次，必须**红**；然后撤掉——证明执行者真的会咬。）

- [ ] **Step 4: 给「未安装」加依赖断言**

在 `tests/docs-consistency.test.ts` 里照 ADR 0009 用例（`:136-146`）的写法追加：

```ts
test('ADR 0010 pins the editor choice without installing it', () => {
  const adr = read('docs/decisions/0010-rich-text-editor-selection.md');
  const index = read('docs/decisions/README.md');
  const deps = Object.keys(JSON.parse(read('package.json')).dependencies);

  expect(adr).toMatch(/^## 决策$/m);
  expect(adr).toMatch(/^## 重估触发条件$/m);
  expect(adr).toContain('决策 ≠ 现在安装');
  expect(index).toContain('0010-rich-text-editor-selection.md');
  // D-9 必须已从待决策表转成「已解决」
  expect(adr).toMatch(/尚未安装/);

  for (const banned of ['tiptap', '@tiptap/core', 'prosemirror-state', 'lexical']) {
    expect(deps, `${banned} 违反 ADR 0010「决策 ≠ 现在安装」`).not.toContain(banned);
  }
});
```

Run: `pnpm test tests/docs-consistency.test.ts`
Expected: PASS。

- [ ] **Step 5: `04-runtime.md` §6.2 的 RHF 虚构陈述先止血（不决策 D-10，只让文档不再承诺不存在的依赖）**

把「React Hook Form + Zod」改成「Zod + `useActionState`（表单栈见待决策 D-10；**未引入** React Hook Form）」，并在 `decisions/README.md` 的 D-10 行保持原样（它已在册，本计划不重开）。
`grep -n "React Hook Form\|react-hook-form" docs/` 确认再无「已引入」语气的表述。

Run: `pnpm run docs:check --strict`
Expected: PASS。

- [ ] **Step 6: 全量绿 + Commit（文档与其执行者同提）**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm arch:check`
Expected: 全绿（纯文档 + 一个测试用例 + `check-docs.mjs` 一行清单扩展；`arch:check` 确认没碰任何源文件行数）。

```bash
git add docs/decisions/0010-rich-text-editor-selection.md docs/decisions/README.md scripts/check-docs.mjs tests/docs-consistency.test.ts docs/architecture/04-runtime.md
git commit -m "docs(decisions): ADR 0010 闭合 D-9 富文本选型（决策，不安装）

遵守 ADR 0009 §1：无需求不装依赖。check-docs 的已解决清单加入 D-9，
让「转成 ADR 后仍赖在待决策表」这种漂移真的有东西报；
docs-consistency 断言 package.json 里不得出现编辑器依赖。
顺带把 04-runtime 的 React Hook Form 虚构陈述止血（D-10 仍在册，不在本计划决策）。"
```

---

## Task 7: 给最热写路径上缺索引的配偶排序查询补一个 partial 索引

**Files:**
- Create: `lib/db/migrations/0014_spouse_sort_index.sql`（手写 custom migration，**不是** `db:generate`）
- Modify: `lib/db/migrations/meta/_journal.json`
- Test: `tests/integration/spouse-sort-index.test.ts`

**Interfaces:**
- Consumes: 既有查询形态 `nextSpouseSort`（`node-services.ts:137-156`）：`WHERE organization_id=$1 AND lineage_id=$2 AND role='spouse' AND spouse_of_id=$3 AND deleted_at IS NULL`，聚合 `coalesce(max(sort),-1)`；调用方 `:217`（`insertCoSpouse`，每建一个同录配偶的血亲节点）与 `:495`（`addSpouseInTransaction`），两者都在 `loadLineageForUpdate`（`:75-93`）的 `FOR UPDATE` 锁内。
- Produces: 数据库不变式——存在索引 `idx_node_spouse_sort ON node (organization_id, spouse_of_id) WHERE deleted_at IS NULL`，且 `nextSpouseSort` 的 plan 从 Seq Scan 变为 Index Scan。查询本身**不改**（Drizzle 写法保持原样）。

**前提（为什么走手写 custom、为什么不碰 `schema.ts`）**：`lib/db/schema.ts` 当前 **688 行，恰好等于 F6 豁免登记线 688——零余量**（`scripts/check-file-size.mjs:27`）。往它加一行 `index('idx_node_spouse_sort')…` 会直接把 `arch:check` 弄红。仓库已有成熟先例：`idx_node_search`、`idx_node_lineage_path` 等**只活在迁移里、不在 schema/快照里**（`grep -c idx_node_search lib/db/schema.ts lib/db/migrations/meta/0012_snapshot.json` → 0,0），CI 的漂移检查（`ci.yml:92-93`）在 main 上照样绿。所以：**新索引写进 custom migration，schema.ts 不动**。这是本任务成立的方式，也是 E12 精神（约束与执行者对齐）在迁移层的体现。

- [ ] **Step 1: 确认查询形态与索引缺口（只读）**

Run: `grep -n "await nextSpouseSort" lib/lineage/node-services.ts` 与 `grep -n "index('idx_node" lib/db/schema.ts`
Expected: 前者两条生产调用 `:217`、`:495`；后者三行（`idx_node_lineage_depth`/`idx_node_parent`/`idx_node_alive`），**没有一条以 `spouse_of_id` 为首列**。若将来有人给 `spouse_of_id` 加过索引，本任务作废。

- [ ] **Step 2: 写 failing 集成测试 `tests/integration/spouse-sort-index.test.ts`**

用 `tests/helpers/db.ts` 的 `getTestSql()`。断言两件事：**(a) 存在性**——索引存在且形状正确（partial、首两列对）；**(b) 可用性**——查询形态能选到它。

**(b) 不能依赖数据量**：空/小表上规划器永远选 Seq Scan（成本估算更低），所以用 `set enable_seqscan = off` 强制暴露「索引是否存在且匹配谓词」，并用**字面 UUID 常量**而不是子查询——子查询在无夹具数据的测试库里返回 NULL，会把 plan 变成 one-row Result，测不到索引匹配。这两点合起来让这个测试在任何数据状态下都确定：

```ts
// (a) 存在性 + 形状：partial、首列 organization_id、次列 spouse_of_id
const idx = await sql`
  select indexdef from pg_indexes
  where schemaname='public' and tablename='node' and indexname='idx_node_spouse_sort'
`;
expect(idx.length).toBe(1);
const def = String(idx[0]?.indexdef);
expect(def).toMatch(/\(organization_id, spouse_of_id\)/);
expect(def).toMatch(/WHERE \(deleted_at IS NULL\)/);

// (b) 可用性：关 seqscan 后，nextSpouseSort 的形态必须落到这个索引上
await sql`set enable_seqscan = off`;
try {
  const plan = await sql`
    explain (format json)
    select coalesce(max(sort), -1)::int from node
    where organization_id = '00000000-0000-7000-8000-000000000001'::uuid
      and lineage_id      = '00000000-0000-7000-8000-000000000002'::uuid
      and role = 'spouse'
      and spouse_of_id    = '00000000-0000-7000-8000-000000000003'::uuid
      and deleted_at is null
  `;
  expect(JSON.stringify(plan)).toContain('idx_node_spouse_sort');
} finally {
  await sql`reset enable_seqscan`;   // 必须复位，否则污染同文件后续用例
}
```

Run: `pnpm test:integration tests/integration/spouse-sort-index.test.ts`
Expected: FAIL —断言 (a) 命中 0 行（索引尚不存在）；(b) 因 `set enable_seqscan` 后仍无该索引名而红。

- [ ] **Step 3: 手写迁移 `lib/db/migrations/0014_spouse_sort_index.sql`**

```sql
-- nextSpouseSort (node-services.ts:137-156) filters node by
-- (organization_id, spouse_of_id) + deleted_at IS NULL, and runs on both
-- spouse write paths (:217 co-recorded spouse, :495 add spouse) while holding
-- the lineage's FOR UPDATE lock. No index leads on spouse_of_id, so each call
-- is a lineage-wide scan inside the write lock. Partial on deleted_at IS NULL
-- to match the query and the existing idx_node_alive precedent (0000:242-245).
-- Deliberately migration-only, not schema.ts: see plan Task 7 premise (F6
-- ceiling). Re-add to schema.ts only together with a genuine file split.
CREATE INDEX idx_node_spouse_sort ON node
  (organization_id, spouse_of_id) WHERE deleted_at IS NULL;
```

（单条语句，不需要 `--> statement-breakpoint`；对照 0012 的单语句先例。）

- [ ] **Step 4: 登记 journal**

`_journal.json` 追加 `idx: 14`、`tag: "0014_spouse_sort_index"`、`breakpoints: true`——格式照 Step（Task 1 Step 5）读到的 0006/0012/0013 条目抄。**注意**：0013 与 0014 若同分支，先合 0013，本任务基于其后的编号。

- [ ] **Step 5: 迁移 + 测试转绿**

Run: `pnpm db:migrate && pnpm test:integration tests/integration/spouse-sort-index.test.ts`
Expected: PASS。(b) 若仍在小数据下选不到索引，保留 `enable_seqscan=off` 那版；不要为此往库里灌 2000 行夹具——那会把一个存在性测试变成数据量测试。

- [ ] **Step 6: 漂移检查与空库重放**

Run: `pnpm db:generate && git status --porcelain lib/db/migrations && pnpm test:integration tests/integration/migrations.test.ts`
Expected: `git status` **必须为空**——这是本任务的关键验证：它证明「索引不进 schema/快照」在本仓库不会被漂移检查判红（与 `idx_node_search` 同一先例）。若非空，**停下来**，说明该先例只对 DROP 成立、对 CREATE 不成立，此时才需要回 `schema.ts` 加行——并把「schema.ts 需要拆分腾行」记为移交项，不要硬塞。

- [ ] **Step 7: Commit（迁移单独提）**

```bash
git add lib/db/migrations/0014_spouse_sort_index.sql lib/db/migrations/meta/_journal.json tests/integration/spouse-sort-index.test.ts
git commit -m "perf(db): 给配偶排序查询补 (org, spouse_of_id) partial 索引

证据：nextSpouseSort 按 spouse_of_id 等值过滤且在 FOR UPDATE 谱系锁内执行，
node 上没有任何索引以 spouse_of_id 为首列 → 每次加配偶做一次谱系内扫描。
与 Task 1 对称：那是索引无消费者，这是消费者无索引。
索引只写迁移不进 schema.ts（schema.ts 正处 F6 零余量），先例同 idx_node_search。"
```

---

## 收尾（整分支一次，非任务）

- [ ] 全量门禁：`pnpm check && pnpm typecheck && pnpm test && pnpm arch:check && pnpm run docs:check --strict && pnpm test:integration && pnpm build`
- [ ] `pnpm test:e2e`（本地会重置 `*_test` 库）：确认世系表搜索改动与去抖没破坏「侧栏搜索/折叠」那条关键路径（`implementation-status.md:96`）。
- [ ] `docs/implementation-status.md` 同步本轮变更：`node` trigram 索引已删（ADR 0011）、`autoprefixer`/`ui/tabs`/`resetAuthDb` 已删、五个新执行者（`search-boundary`、`env-bootstrap`、`lineage-search-consistency`、`dependency-pins`、`check-docs` D-9）、ADR 0010/0011 已立。测试与迁移数字按其单一事实源约定处理（`80bdd03 docs: 测试与迁移数字改为单一事实源`）。
- [ ] 用 `requesting-code-review` 做一次 fresh reviewer 全分支评审，重点问五句：Task 1 的迁移能否空库一次执行且**没有**误删扩展/article 索引；Task 3 的三个非 Next 入口是否都仍读到 env；Task 4 的去抖有没有破坏选中/聚焦与画布那四条既有搜索断言；Task 5 有没有把补丁升级误判成红；Task 6 有没有偷偷引入编辑器依赖。
