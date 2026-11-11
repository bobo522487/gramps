# 变更记录

> 记录**对外可见的变化**。编排顺序与当前进度看 [`docs/roadmap.md`](docs/roadmap.md)，决策理由看 [`docs/adr/`](docs/adr/)。
> **口径**：仓库目前没有 tag / release，所以这里按**日期里程碑**聚合，不虚构版本号；每条都有仓库内依据（提交历史或决策记录），不推测未记录的变更。

---

## [未发布]

- **依赖维护升级（2026-11-11）**：Biome 2.6.6、Vitest / coverage 5.1.0、Vite 8.3.7、Playwright 1.65.0、dotenv 18.0.10；TipTap 全组 3.33.1、TanStack Query 5.107.1、Zustand 5.1.0、lucide-react 1.71.0、`@xyflow/react` 12.12.1；Better Auth 1.7.20、`@vercel/blob` 2.9.0、`@vercel/functions` 3.11.1。工具链同步 pnpm 12.18.0 与 Node 24.22.2，版本表见 `docs/overview.md` §4 / `docs/development.md` §1。
- **Next.js 安全补丁升级（2026-11-11）**：`next` 16.4.3 → 16.4.6。16.4.5 修复了 7 条 moderate 级公告（`use cache` 跨租户缓存泄露 / 缓存污染、图片优化 SVG 校验绕过、Edge 路由 HttpOnly Cookie 暴露等），16.4.6 另含 Turbopack dev GC 与 Route Handler 响应压缩修复。版本表同步 `docs/overview.md` §4。
- **文档护栏回归修复（2026-11-10）**：审查发现 `biome.json` 为让各依赖方向 override 互斥而排除的目录，反而使编辑器依赖禁令在这些目录失活——Biome 2.x 对同名 `noRestrictedImports` 不合并 options、后匹配组整体替换。改为按目录切互斥分区、每区自带该目录被禁的全部 import，`tests/docs-guard.test.ts` 用交叉探针逐分区验证「拦得住且无误伤」。护栏扫描范围从 `docs/` 扩到根级治理文档的链接、`scripts/` 与 `.github/` 的退役短语与反引号路径，扫描清单与根级文档都收进 `scripts/doc-manifest.json`；新删的三份文档登记进退役清单。ADR 索引的溯源口径由「正文」统一为提交信息与 PR 描述（该目录按设计只存索引），并同步 `docs/adr/README.md` 的机检说明。
- **文档去重与门禁前置（2026-11-10）**：覆盖率阈值、环境变量清单各自只收成一份真相源，`docs/development.md`、`docs/infrastructure.md`、`docs/architecture.md` 改为指路到配置与模板；`docs/data-model.md` 合并重复的删除语义与 RLS 两节并重编号；五组依赖方向硬规则改由 `tests/docs-guard.test.ts` 端到端验证，组数不再写死。`pnpm docs:check` 前置到提交前门禁且默认即失败，文档里的命令口径统一（CI 保留历史开关作 no-op 兼容）。
- **文档体系合并（2026-11-10）**：Code Wiki 落到 `docs/` 后随即删去重复正文，模块导读搬到 `docs/modules/`，产品意图与接口地图分别改名 `docs/overview.md` / `docs/api.md`。重组只搬文件未同步导航，留下多处失效引用与代码注释，而当时的文档测试与门禁全绿——退役清单在 `scripts/check-docs.mjs` 和 `tests/docs-consistency.test.ts` 各存一份，且只检查 Markdown 链接。
- **文档护栏整改（2026-11-10）**：清单收敛到 `scripts/doc-manifest.json` 单一数据源；`scripts/check-docs.mjs` 新增反引号路径 / 行号锚 / 退役短语校验并扫描根级文档与代码注释，默认即失败（`--strict` 保留为兼容开关）；新增 `tests/docs-guard.test.ts` 用临时仓库 fixture 端到端验证坏引用会让门禁变红；逐条修掉失效引用，删掉 `README.md` 手写目录树与任务表，导航只留 `docs/README.md`；裁决世次公式、修正环境变量名，并给 `biome.json` 补上 `lib/*/services.ts` 的真实 override。删掉当天即腐烂的手写符号索引、目录结构说明与谱书占位文档：这类清单和「以后要补」的占位都没有执行者，目录与符号一律以源码为准。

- **数据模型整体重建（`S8`，2026-11-09 交付）**：`lib/db/migrations/` 重建为唯一全量 SQL 基线；事实层六表升为主数据源、`node` 退为 `ltree` 位置引用；`book_export`、复合主键与全局 `project.id` 落地；组织 / 成员写入收敛到 `app.*` SECURITY DEFINER 函数；业务角色 `genealogy_app` 与认证角色 `auth_service` 分离；新增 `pnpm verify:target-schema` 进 CI。决策见 `docs/adr/` 的 `0020` 行。
- **`folder` 压平为项目内单层分类**：`kind` / `parent_id` / `sort` / `created_by` 与三条旧约束退役，`folder_name_unique (project_id, name)` 成为唯一口径；同名撞名返回 `conflict`；前端分类树改为按名称平铺。
- **`verify:target-schema --explain` 从占位改为实跑**：自建 10 万行压测集，Q1 / Q3 进 CI 每次重测；Q3 按选择率走 Seq Scan 属合理计划，只断言 `InitPlan`、谓词下推与耗时上限，不硬凑索引。
- **切换日演练（限本地）**：`pg_dump` → `pg_restore` 抽样一致 → 复跑 G5（96 PASS / 0 FAIL / 1 SKIP）→ `pnpm db:migrate` 切换并核对对象与约束。托管 Neon 分支 / PITR 恢复与真实实例上的 `verify:deploy` + E2E **仍未做**，随 `roadmap S7` 补。
- **生产迁移修复：角色创建移出基线（2026-11-09）**：PR #13 合并后生产迁移连红两次。根因是基线越界——`CREATE ROLE … PASSWORD` 是集群级操作，口令属每环境部署配置，Neon 控制面按弱口令拒绝（`XX000`）。现由 `scripts/provision-roles.mjs` 接管角色（`--roles-only` 在迁移前、`--grants-only` 在迁移后，CI 与生产 workflow 共用同一份权限矩阵），基线只 GRANT；迁移是否成功只看 `verify-deployment.mjs`，不信 `drizzle-kit` 的 `applied successfully`；新增 `scripts/reset-target-db.mjs` 与 `db:migrate` 失败时的只读诊断探针（drizzle 会吞掉 SQLSTATE）。生产重建最终 26 项全 PASS。
- **Neon 角色属性 DDL 的实测边界**：只放行 `ALTER ROLE … PASSWORD`，其余属性 DDL 一律 `42501`，而 `pg_has_role(…,'MEMBER')` / `rolcreaterole` 仍判「可」——理论权限不可信。改为先读 `rolcanlogin` / `rolsuper` / `rolbypassrls` 与目标值比对，合规就不发属性 DDL。事故与边界记入 `docs/runbooks/README.md`。
- **`AUTH_DB_PASSWORD` 去掉默认口令兜底**：`provision-roles.mjs` 曾写 `AUTH_DB_PASSWORD ?? 'auth'`，缺变量的机器会把 `auth_runtime`（读得到 `auth.user` 的密码哈希与会话 token）静默改成 4 字符口令。现与 `genealogy_app` 同口径——没给口令就跳过并打印「未设置，未改口令」，脚本里没有任何默认口令；生产 workflow 补上对称的 `AUTH_DB_PASSWORD` 前置校验。角色判定抽到 `scripts/lib/role-provisioning.mjs`，对应测试从 grep 源码改为注入假连接的**行为断言**（缺失 / 空串时不得发出任何 `ALTER ROLE … PASSWORD`）。
- **认证侧权限矩阵改为「按对象回收」**：原来只 `REVOKE ALL ON SCHEMA …`，而 schema 级 REVOKE 收不回表级授权，迁移过的旧库上 `auth_service` 可能仍握着 public 全表 DML（ADR 0020 之前的旧口径），矩阵只是文档。现按 `auth` / `app` / `public` 三个 schema 分别回收**表 / 序列 / 函数**再重授，只针对 `auth_service`，不动基线管的 `genealogy_app`；`public` / `app` 侧从未给认证角色设过 DEFAULT ACL，故不补对称的默认权限 REVOKE。矩阵移到 `scripts/lib/auth-grants.mjs`，单测断言「回收先于授予」与覆盖面。
- **生产清库的确认不再自证**：`migrate-production.yml` 原来 `--confirm="$DB"`，`$DB` 由同一个连接串解析，逐字匹配恒为真。现改为 `workflow_dispatch` 的 `confirm_db` **由人逐字输入**，不匹配即 `::error::` 退出且不打印期望值；`migrate` job 引用 `environment: production`（required reviewers 由仓库设置提供）。非重建路径（push 触发的日常迁移）不经过该步骤。
- **文档系统收敛**：`docs/roadmap.md` 只保留编排状态，逐批进度与收口台账删去（历史留在提交历史与本文件）；`docs/adr/` 改为只有结论索引、不存正文，不再计划逐份迁回 17 份旧正文；未启用的 feature 归档流程从入口文档删除。
- **角色 provisioning 的属性与口令解耦**：`ensureRole` 曾在属性 ALTER 失败时直接 return，导致本来能改的口令一句没发、还被判致命（托管库常见边界：属性 42501、PASSWORD 放行）。现返回 `attributesCompliant` 与 `canSetPassword` 两个独立结果，口令分支总会独立尝试，属性不合规交给 `verify-deployment.mjs` 兜底；「本次没要求改口令」不再被算作口令改不动。
- **角色口令改为写入 SCRAM-SHA-256 verifier**：`ALTER ROLE … PASSWORD '<明文>'` 的语句文本会落进托管库查询历史与 `log_statement` 日志。现由 `scripts/lib/scram-verifier.mjs` 在客户端按 RFC 5802 / RFC 7677 算出 `SCRAM-SHA-256$<iter>:<salt>$<key>:<server>`，SQL 里只出现 base64 的 salt 与派生密钥，明文不出进程；迭代 4096、salt 16 字节随机。PostgreSQL ≥ 10 接受预哈希串（本仓库 CI `postgres:18-alpine`、生产 Neon 均支持），因此不保留明文回退路径；正确性由 RFC 7677 官方测试向量逐字节比对保证。
- **42501 报错指引与结论对齐**：去掉「目标角色的属主」说法——PG 角色没有属主概念（`pg_roles` 无 `rolowner` 列），改为「成员（带 ADMIN OPTION）、CREATEROLE 或超级用户」。

<!-- 条目模板
## YYYY-MM-DD · 主题
### 新增
- <变化>（关联 roadmap 条目 / feature 目录）
### 变更
- <变化>
### 修复
- <变化>
-->

---

## 2026-11-06 · 质量门禁与事实层收敛

### 新增

- 把事实层冻结与文档一致性做成**从代码派生**的 CI 门禁，并收紧漏检与空转；文档路径门禁改为从 `.gitignore` 派生豁免，消除干净检出失败。
- 拍板事实层目标真源，落地 P1 读写切换计划。

### 修复

- 修正认证流程措辞失真、原则文件死链，以及若干决策记录与计划中的夸大措辞；历史决策正文只补时态说明、不改结论。

### 变更

- 删除两个零调用的缓存失效辅助函数。

---

## 2026-11-04 · 谱系工作区 UX 与谱文编辑器

### 新增

- 谱系工作区第一期 UX（PR #5）：Viewer 档案只读呈现、关闭抽屉/切换人丁时的未保存确认、画布与世系表共用查询并支持多匹配下一个、删除改确认框、侧栏与工具条减负。
- 谱文编辑器 Word 化（feature 003，PR #8–#11）：加粗/斜体/下划线、单层列表、段落对齐；文档模型白名单与粘贴过滤守住边界（无颜色、行高、表格、嵌套列表等）；同时修订 002 中富文本范围的需求条目。
- 配套单测、集成与 E2E 用例，以及 003 的规格、计划、任务与验收边界清单。

---

## 2026-11-02 · 文档体系收敛

### 变更

- 文档集收敛为**一层**：根级事实文档并入架构文档集，同一份文档内用 `[现状]` / `[目标]` 段落前缀标注，替代原先靠目录位置区分 as-is / to-be 的做法；删掉的是重复副本而不是内容。
- 需求、追溯矩阵与实现状态合并为一份，**唯一状态表**只保留一处；其他文档不再声明进度。

---

## 2026-10-31 · 生产库迁移与线上故障闭环

### 新增

- 生产库迁移改为由独立 CI job 在迁移文件变更时执行，跑完用同一份 journal 校验；不把 DDL 放进构建流程，避免预览部署重复执行。

### 修复

- 修复一次线上整站故障：生产库停在旧迁移版本、代码却在读新列，导致服务端组件报错；补齐部署状态描述、风险登记与排障手册条目。

---

## 2026-10-30 · 架构文档集、规格工作流与事实层

### 新增

- 建立 15 份架构视图文档集（总览、目标约束、逻辑视图、数据视图、接口与集成、部署视图、运行视图、非功能、安全、可观测性与运维、技术选型与决策索引、需求追溯、风险演进、本地开发与命令、附录）。
- 引入规格驱动工作流与项目定制模板；原则文件改为引用工程协作指南，不复制规则正文。
- 事实层回填与对账 CLI，补齐事件/日期约束与 P0、P1 评审遗留项。

### 修复

- 回填过程遇到占位年份时降级处理而非整批中止；关闭事实层回填与对账的缺口。

---

## 2026-10-29 · 数据模型与租户安全

### 新增

- 人丁、姓名、家庭、配偶、子女、事件等表与事实层模型；数据模型 v1.0 评审与全域蓝图。
- 租户列不可变：所有租户表挂触发器，禁止通过 `UPDATE` 改写归属列；schema 按域拆分目录。

### 修复

- 事件日期枚举改用生成的 CHECK 约束；拒绝非法触发器参数。

---

## 2026-10-28 · 首屏数据与技术栈

### 修复

- 首屏不再把 RSC 刚算过的会话与组织列表重复查一遍。

### 变更

- 打开 4 条实测零报错的编译器检查，删掉被覆盖的开关；记录开关账目并结掉此前未验证的假设。
- 工程协作指南收敛成「规则 + 指针」，细节交回各自唯一来源；重新生成锁文件对齐已删除依赖。

---

## 2026-10-27 · 检索边界、依赖与 CI 守卫

### 新增

- 检索边界决策：人丁搜索在客户端，trigram 索引只保留给谱文；删除零消费者的索引。
- 三处守卫补上执行者：环境加载按 specifier 匹配、工具钉安装版本、ORM 版本锁定；变异证明改成可自复现步骤。

### 修复

- 世系表搜索与过滤统一到同一查询源，修漏搜并加输入去抖；修正迁移 journal 时间戳与文档中的引用。

### 变更

- 删除零引用的依赖与组件；dotenv 加载收拢到非应用入口。

---

## 2026-10-26 · 架构约束、数据完整性与清理

### 新增

- 文件行数上限与环境变量访问约束进入 CI；部署验证断言 RLS 策略不使用裸子查询；租户策略强制调用角色判定函数。
- 谱系索引一次计算、四处消费；节点层级由路径派生并约束世次下界；三棵树父引用改复合外键。

### 变更

- 写入口统一走单事务写通道，鉴权样板收成一处；缓存失效调用收拢到单一模块。
- 删除零读写字段、零调用查询/Action 与重复常量，多处映射收敛成单一定义。

### 修复

- 恢复组织隔离断言；日志级别改为注入，避免服务端配置进入浏览器包。

---

## 2026-10-25 · 谱系与工具链

- 创建谱系流程优化。
- 固定 Node 24 LTS 与 pnpm 12，记录技术栈升级计划。

---

## 2026-10-24 · 工程基础设施

- 添加 Neon 相关技能与锁文件；固定基础依赖与配置。

---

## 2026-10-21 · 初始化

- 仓库初始化，项目「云谱」立项。

---

## 维护约定

- 一次变更只写一行摘要，按 `新增 / 变更 / 修复` 归类；不逐条罗列 commit。
- 条目关联 `docs/roadmap.md` 的条目 ID 或 `specs/NNN-xxx/` 目录；涉及不可逆决策时回链 `docs/adr/`。
- 有了正式 tag / release 后，改为按版本分组并保留语义化版本号；在此之前保持按日期里程碑。
- 状态与编排不在本文件声明，以 `docs/roadmap.md` 为准。
