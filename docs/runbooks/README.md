# 运维手册（Runbooks）

> **回答什么问题**：上线怎么发、出事按哪几步判断与恢复、怎么确认发布是好的。
> **读者**：值班 / 运维 / 技术负责人　**长度上限**：5 页
> **不写什么**：命令清单（`package.json`）、环境变量取值（`.env.example` / `lib/config.ts`）、CI 步骤顺序（`.github/workflows/ci.yml`）、表与列（`lib/db/schema/`）、阈值与不承诺清单（`docs/nfr.md`）、设计理由（`docs/adr/`）、编排与进度（`docs/roadmap.md`）、术语（`docs/glossary.md`）。

本层只放**代码里查不到的处置判断**和**压力下照着做的步骤**。命令名、变量值、表名、迁移编号都不在这里抄第二遍——它们在各自的真相源里，改代码时不会想起改文档。本文里的 SQL 与命令都对应当前实现，跑之前先按 §6 核对一次。

## 1. 值班前置

### 1.1 连接方式

| 用途               | 连接串                               | 角色                                                              |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------- |
| 应用运行           | `APP_POSTGRES_URL`（Neon pooled）    | `genealogy_app`（基线创建的 LOGIN 角色），受 RLS 约束             |
| 认证运行           | `AUTH_POSTGRES_URL`（Neon direct）   | `auth_runtime` → 启动参数固定 `auth_service`；pooler 会拒绝该参数 |
| 迁移 / 运维 / 备份 | `POSTGRES_URL_DIRECT`（Neon direct） | 迁移角色，拥有 `BYPASSRLS`                                        |

**所有运维写操作都用 `POSTGRES_URL_DIRECT`。** 用 `POSTGRES_URL` 会因为 RLS 与权限限制而失败，或只看到部分数据。变量清单与作用域以 `.env.example` 和 `lib/config.ts` 为准，本文不复制取值。

### 1.2 三条铁律

1. **先备份，再动手。** 任何写操作前先备份相关表；仓库没有应用层备份脚本，用 Neon 分支或 PITR。
2. **先查，再改。** 每一步先跑 `SELECT` 确认影响范围，再跑 `UPDATE`。
3. **走复核。** 生产库的写操作不允许单人直接执行，须有人复核并记录工单。

### 1.3 先确认隔离前提没被破坏

这是全系统最脆弱的隐含假设（理由见 `docs/data-model.md` §2 与 `docs/adr/` 的 `0006` / `0020` 两行）：

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

返回 `rolbypassrls = false` 时**不要继续任何操作**，先恢复角色权限。注意区分：运行期角色 `genealogy_app` / `auth_service` 必须 `NOBYPASSRLS`（`verify:deploy` 逐项断言），而迁移 / 运维直连角色才需要 `BYPASSRLS`。两者不是同一条规则。业务角色与认证角色不能互为成员——`auth.*` 四表没有 RLS，合并等于把密码哈希与会话 token 暴露给业务连接。

## 2. 发布与回滚

发布顺序、部署单元与「迁移为什么必须先于应用」在 `docs/architecture.md` 的部署形态，本层只记**值班要确认的开关、要跑的验证、以及什么时候恢复**，不重述顺序与理由。

**每次发布前**，改了 `lib/db/migrations/**` 就必须确认生产迁移 job 绿：`.github/workflows/migrate-production.yml` 在迁移文件合入 `main` 后触发，不可并发、不可被新提交取消，跑完立刻用同一份 journal 校验库结构，失败即红。漏掉这一步的后果见 RB-6。

**没有 down 迁移**。目标态是一次性停服 big-bang 切换：唯一全量 SQL 基线整份执行，旧迁移与 snapshot 退役、journal 重置为 1 条。因此「三段式变更（加列 → 回填 → 加约束）」与「回滚应用版本让旧代码兼容新列」都不成立——旧代码读不了目标态表。数据层只有 Neon 分支 / PITR 恢复点，**没有应用层回滚脚本，也没有 down 迁移**；失败按 §2.1 整体恢复。

**明确不承诺**：没有 RPO / RTO 承诺。`T50` 的恢复演练已在 §2.2 留档（本地 `pg_dump`/`pg_restore` 等价演练，**托管 Neon 分支 / PITR 仍未演练**），完整缺口在 `docs/nfr.md` §5。别把目标值当成已验证能力对外说。

| 阶段       | 验证方式                                                                                          | 执行者    |
| ---------- | ------------------------------------------------------------------------------------------------- | --------- |
| 迁移后     | `node scripts/verify-deployment.mjs --skip-http` 逐项 PASS/FAIL/SKIP                              | 迁移 job  |
| 部署后     | `pnpm verify:deploy`（HTTP 健康 / 安全头 / 鉴权 + 库结构 / RLS / 角色）                           | CI 与值班 |
| 目标态验收 | `pnpm verify:target-schema`（干净库重建唯一基线、P1–P32 / N1–N31、fail-closed、TS ↔ 基线 parity） | CI        |
| 关键路径   | `pnpm test:e2e`，E2E 报告与截图                                                                   | CI        |

### 2.1 切换失败恢复剧本（big-bang）

**触发条件**：`pnpm db:migrate` 报错、应用启动后 `/api/health` 不健康、`pnpm verify:deploy` 任一 FAIL、或切换后发现数据形状不对。

**前置**：切换前必须有一个**实际验证过可恢复**的恢复点（`T50` 留命令输出，见 §2.2）；只有备份文件、没做过恢复演练，不算恢复点。

1. **立即停服**，不再发任何写请求；不要尝试 down 迁移，也不要在目标库上手工 `DROP` / `ALTER` 修补。
2. **记录失败点**：迁移器输出、应用日志、`pnpm verify:deploy` 的 FAIL 项、UTC 时间窗。
3. **拉恢复分支**：从切换前的恢复点拉一个独立 Neon 分支，用 `psql -c "select 1"` 确认可连，抽样 `select count(*)` 核对核心表行数。
4. **在分支上验证**：确认旧版本应用能连、能登录、能读到数据；确认不了就换更细粒度的恢复点，不要直接 Promote。
5. **由技术负责人二选一**：整体恢复到切换前，或补齐失败步骤后重新走一遍切换。两者都不允许在目标库上手改 DDL。
6. **收尾验证**：`/api/health` 健康、`pnpm verify:deploy` 全 PASS、journal 条数为 1、`git status --short` 干净，跑关键路径 E2E，把命令输出附到切换记录。

**失败即回到恢复点，不在目标库上试第二次修补**；这也是 §1.2「先备份再动手」在 big-bang 下的具体形态。

### 2.2 切换演练记录（2026-11-09，T50–T52）

**环境如实声明**：本轮无托管生产环境（G1：单一环境、库内无正式业务数据、明确可删），演练在**本地 PG 18.6 容器**上做，不是生产 Neon。因此 T50 用 `pg_dump` / `pg_restore` 做等价的可恢复性演练，**Neon 原生分支 / PITR 的演练仍未做**——上生产前必须补一次，别把本文当成托管侧已演练的证明。

**T50（G4）备份 + 可恢复性演练**

```bash
# 1) 目标库：应用唯一基线 + 构造 1 万行抽样数据（node 父子分层插入，满足 node_parent_fk）
psql -d gramps_target -f lib/db/migrations/0000_target_schema.sql
# person 10000 行 / node 10000 行（根 '0001' + 9999 个子节点）

# 2) 备份
pg_dump -Fc -f /tmp/gramps_target.dump gramps_target
# -rw-r--r-- 366139 bytes
# sha256 2ccf407ba3b9aa5572ed2abcb21d0b1aaff9ea8ca8f37ae172e86c5e1046cd6a

# 3) 恢复到全新库
createdb gramps_restore
pg_restore -d gramps_restore --no-owner --exit-on-error /tmp/gramps_target.dump   # exit=0
psql -d gramps_restore -tAc "select 1"                # 1
psql -d gramps_restore -tAc "show server_version"     # 18.6

# 4) 抽样比对（源库 vs 恢复库，逐表相等）
# organization=2  project=1  person=10000  node=10000   → SAMPLING MATCH
# 恢复库对象：public 表 17 / RLS 策略 17 / app.* 函数 12（结构与策略一并还原）
```

**T51 切换前一次性复跑 G5**

```bash
POSTGRES_URL=<目标环境> pnpm verify:target-schema      # 96 PASS, 0 FAIL, 1 SKIP
# SKIP 只有 N20（结构性不可表达）；T40 的 Q1 / Q3 已实跑：
#   Q1 18.795 ms（Index Scan node_path_unique + InitPlan + 无 Sort，10 万行）
#   Q3 16.777 ms（Seq Scan + Sort + InitPlan，1 万行 / 10% 选择率）
```

**T52 执行切换 + 切换后核对**

```bash
# 0) 角色（必须在迁移之前）。口令只从环境变量来，不进任何文件。
APP_DB_PASSWORD=<强口令> AUTH_DB_PASSWORD=<强口令> \
  POSTGRES_URL_DIRECT=<目标环境> pnpm db:provision-roles --apply --roles-only

# 1) 清空（G0① 重建前置）。默认 dry-run，必须 --apply + --confirm=<库名>。
POSTGRES_URL_DIRECT=<目标环境> pnpm db:reset-target
POSTGRES_URL_DIRECT=<目标环境> pnpm db:reset-target --apply --confirm=<库名>
#    清空后 public schema 会被重建为空（不保留原 schema 会丢 search_path 目标）

# 2) 建表：唯一基线
POSTGRES_URL_DIRECT=<目标环境> pnpm db:migrate        # migrations applied successfully
psql -d gramps_target -tAc 'select count(*) from drizzle."__drizzle_migrations"'   # 1
# public_tables=17  policies=17  app_fns=12  extensions=ltree,btree_gist
# 关键约束/索引：folder_name_unique / folder_order_idx / node_parent_fk /
#                node_path_gist / node_path_unique / project_id_global

# 3) 授权（必须在迁移之后：`app` schema 与业务表都是基线建的）
POSTGRES_URL_DIRECT=<目标环境> pnpm db:provision-roles --apply --grants-only
#    auth_service: auth.user=rw · organization=rw · organization_member=rw · project=禁

# 4) 结构校验（不信任 drizzle 的 "applied successfully"，见下方事故）
POSTGRES_URL_DIRECT=<目标环境> node scripts/verify-deployment.mjs --skip-http
```

> 角色为什么是「迁移前」、授权是「迁移后」：基线只建 schema 并 GRANT，第一条 GRANT 就要求角色已存在（否则 `42704`）；而 `app` schema 要到基线跑完才有，授权提前会撞 `3F000 schema "app" does not exist`。本地 `prod_drill` 空库上实测过这两种错法。

**事故记录：drizzle 的 `applied successfully` 说过谎（2026-11-09）**

PR #13 合并后，main 的 `Migrate production database` job 红了一次。读日志要先知道这个陷阱：

- `pnpm db:migrate` 打了 `✓ migrations applied successfully!`，**库里几乎什么都没变**。drizzle 只判断「迁移记录表里有没有这条」，`0000_target_schema` 插一条记录就算跑完。
- 该基线对 `auth.*` 用 `CREATE TABLE IF NOT EXISTS`（为了测试库可重复执行）。生产库里已有同名旧表 → **整表跳过**，结构留旧，后续索引 / 策略对着旧表建。
- 校验阶段的报错文案也有坑：`FAIL RLS enabled: 17: organization, ...` 读起来像「17 张表全都不存在」，实际是「这 17 张表全都在，只是没启用 RLS」。该文案已改为 `all 17 tables: ...`，并抽到 `scripts/lib/deployment-report.mjs` 加单测。
- 另一条假红：`auth_service owns identity and tenant writes` 断言认证角色拥有业务表写权限，是「业务侧认证侧全量统一」时期的旧口径。ADR 0020 已修订为「业务侧统一、认证侧独立」，基线根本不给 `auth_service` 任何 public 表权限——这条断言在**正确**的库上必然报红。已改为断言真正的边界（认证角色写不了业务表）。

**结论**：判定迁移成败只看 `verify-deployment.mjs` 的结构校验，不看 drizzle 的日志。重建路径见上面第 1 步；`db:reset-target` 有 `R1–R7` 七条门槛（dry-run 默认、`--confirm` 逐字匹配库名、拒绝系统库、public 必须重建、CI 里清空只允许人工重建模式、角色/授权两阶段顺序、缺口令前置拦截）。

**事故记录：Neon 拒掉弱口令，生产库被清空后停在无表状态（2026-11-09）**

同一天第二次红，比第一次严重：重建模式已经把生产库清空，`Apply migrations` 却失败了。

- 根因在基线第 18 行：`CREATE ROLE genealogy_app LOGIN PASSWORD 'app_pw';`。本地 PostgreSQL 放行任何口令，Neon 的控制面会校验强度，返回 `insecure password, try including more special characters, using uppercase letters, using numbers or using a longer password`，SQLSTATE `XX000`。整份基线在一个事务里，第 18 行失败 → 后面全没执行 → 库是空的。
- 之前没被发现，是因为这条语句包在 `DO $$ IF NOT EXISTS (SELECT 1 FROM pg_roles …) $$` 里：角色已存在时直接跳过，探针看到「已存在 → 跳过 → 成功」，把真实错误盖住了。单看那次诊断的输出，会误判成「迁移没问题」。
- 修法的关键不是「换个强口令」，而是**承认角色不该在基线里**：`CREATE ROLE` 是集群级操作，基线描述的是单库 schema；口令本来就是「每个环境一份」的部署配置。基线的第一条 GRANT 现在隐含要求角色已存在，缺角色时报 `42704`（比静默弱口令上线好得多）。
- 顺带修掉一个方向错：授权步骤原先跟着角色一起跑在迁移**前**，而 `app` schema 是基线建的，于是撞 `3F000 schema "app" does not exist`。现在拆成 `--roles-only`（前）与 `--grants-only`（后）。

**生产环境必须配置的 secret**：`APP_DB_PASSWORD`（`genealogy_app` 的口令，≥20 位、含大小写+数字+符号）、`AUTH_DB_PASSWORD`（`auth_runtime`）。两个都缺不得，workflow 在动库之前各有一条前置校验：缺 `APP_DB_PASSWORD` 报 `::error::APP_DB_PASSWORD secret is missing`，缺 `AUTH_DB_PASSWORD` 报 `::error::AUTH_DB_PASSWORD secret is missing` 并退出，不会跑到清库那一步。

> 脚本侧对两个口令是**同一口径**：给了才 `ALTER ROLE … PASSWORD`，没给就跳过并打印「未设置，未改口令」。不要指望脚本有默认口令——曾经 `AUTH_DB_PASSWORD ?? 'auth'` 就是这样一个兜底，缺变量的机器会把 `auth_runtime`（读得到 `auth.user` 的密码哈希与会话 token）静默改成 4 字符口令，本地 PG 还照单全收。

**事故记录：Neon 只放行 `ALTER ROLE … PASSWORD`，属性 DDL 一律 42501（2026-11-09）**

接着上一条。角色建出来之后，`alter role auth_service …` 报 `42501 permission denied to alter role`。排查走了两个弯路，记下来省下次的时间：

- **`pg_has_role(…,'MEMBER')` 与 `rolcreaterole` 在 Neon 上会骗人**。诊断显示 `neondb_owner` 带 `CREATEROLE`、对三个角色都判「可」，真跑全 42501。理论权限不等于实际权限——诊断脚本因此改成在 savepoint 里**逐条真跑再回滚**，实测结论：
  ```
  ✗ genealogy_app 属性不可改 → 42501
  ✗ auth_service  属性不可改 → 42501
  ✗ auth_runtime  属性不可改 → 42501
  ✓ genealogy_app 口令可改
  ```
- **PG 的角色没有「属主」概念**。第一版闸门用了 `pg_roles.rolowner`，本地一跑就是 `42703 column r.rolowner does not exist`。只有「谁创建的」，那是审计信息，不决定权限。

**修法**：不猜哪句能过，改成**只改真正需要改的**——先读 `rolcanlogin` / `rolsuper` / `rolbypassrls` 与目标值比对，合规就完全不发属性 DDL。生产上这两个角色由控制面创建、属性本就正确，整段属性 DDL 自然消失，只剩一条 `ALTER ROLE … PASSWORD`。口令改不动仍然致命（应用侧用的是同一份 secret，否则全线 `28P01`）。

> 判断「能不能改」不要靠 `has_role` 猜，跑 `node scripts/diagnose-drizzle-state.mjs`，看「ALTER 实测」那一段。

> ⚠️ 改 `APP_DB_PASSWORD` 之后要同步更新应用侧的连接串（`APP_POSTGRES_URL` 等），两边不一致就是全线 28P01。

**切换后仍待补**：应用侧 `pnpm verify:deploy` + `/api/health` + 关键路径 E2E 要在真实应用实例上跑（本地演练只覆盖数据层）；托管侧恢复点（Neon 分支 / PITR）上生产前补一次。

## 3. 故障处置

每个场景给「判断 → 处置 → 验证」，不重复上文的三条铁律。表与列名以 `lib/db/schema/` 为准。

### RB-1 误删数据恢复

目标态业务表**没有软删列**，删除是物理删除：`ON DELETE RESTRICT` 只拦「仍被引用」的行，无引用的行一次 `DELETE` 就没了，**没有按行恢复的手工 `UPDATE` 路径**。注意 `RESTRICT` 违约的 SQLSTATE 是 `23001`，不是 `23503`（后者是 `NO ACTION`）；把两者混用会误判成「库坏了」。

先确认影响面：删除前应用有预览接口（`getArticleDeletePreviewAction` / `getFolderDeletePreviewAction`），值班按工单记录定位组织、项目与时间窗，结合 `pg_stat_activity` 与恢复点采样确认，**不要在目标库上试 `UPDATE` 复活行**：

```sql
SELECT o.id, o.name, p.id AS project_id
FROM organization o JOIN project p ON p.organization_id = o.id
WHERE o.status <> 'closed' AND p.id = $1;
```

恢复只能整体进行：按 §2.1 从 Neon 分支 / PITR 恢复点拉分支，核对行数后把需要的行导回目标库，导回时**必须同时限定 `organization_id` + `project_id`**，否则跨组织误写。恢复可能撞唯一约束（`23505`），先查同名再决定改名或放弃。

事后记录工单；同组织重复误删，走产品侧「删除二次确认」需求，不要在运维手册里临时加流程。

### RB-2 忘记密码 / 强制下线

M1 无邮件通道、无自助找回。先**线下验证身份**（家族联系人、邀请人、组织 owner 之一），没验证就不重置。密码存 `auth.account`（`provider_id = 'credential'`），不在 `auth.user`；运行时业务角色没有 `auth.*` 权限，此操作必须用直连：

```bash
node --input-type=module -e "import { hashPassword } from 'better-auth/crypto'; console.log(await hashPassword(process.argv[1]))" '临时密码'
```

```sql
BEGIN;
UPDATE auth.account a SET password = '<scrypt-hash>', updated_at = now()
  FROM auth.user u WHERE a.user_id = u.id AND a.provider_id = 'credential'
    AND lower(u.email) = lower('user@example.com');
DELETE FROM auth.session s USING auth.user u
 WHERE s.user_id = u.id AND lower(u.email) = lower('user@example.com');
COMMIT;
```

只「踢掉某用户全部会话」时只跑 `DELETE`，不动密码。通过可信渠道交付临时密码并要求登录后立即改密。

### RB-3 组织没有 owner

全库业务表都是硬删除、没有软删列；「单组织最多一个 owner」有 `uk_org_member_single_owner`，但「至少一个 owner」没有数据库约束，绕过服务层直写能造出这种状态：

```sql
SELECT o.id, o.name FROM organization o WHERE o.status <> 'closed'
  AND NOT EXISTS (SELECT 1 FROM organization_member m
                  WHERE m.organization_id = o.id AND m.role = 'owner');
```

修复：把某个 `admin` 提为 `owner`（`UPDATE organization_member SET role='owner' WHERE ... AND role='admin'`，包在事务里）。若已无任何有效成员，先按邀请流程加人再提 owner。库内 `app.set_org_member_role` 的 last-owner 守卫是兜底，不能替代预检。

### RB-4 轮换 `BETTER_AUTH_SECRET`

**轮换会让全量用户下次请求失去会话**（Cookie 签名失效，会话记录在 `auth.session`）。只在疑似泄露或经手范围变化时做：选低峰时段并提前公告 → `openssl rand -base64 48` 生成 → 在 Vercel 更新变量并重新部署 → 观察登录成功率，大面积失败就回滚环境变量。旧密钥在被覆盖前仍有效。轮换后如需立即清理旧会话，删 `auth.session` 记录即可。

### RB-5 连接池耗尽 / 数据库变慢

日志出现 `too many clients already` / `timeout exceeded when trying to connect`，页面 TTFB 突增但 CPU 不高：

```sql
SELECT usename, state, count(*) FROM pg_stat_activity GROUP BY 1,2 ORDER BY 3 DESC;
SELECT pid, usename, now() - query_start AS duration, left(query,120)
FROM pg_stat_activity WHERE state <> 'idle' ORDER BY duration DESC LIMIT 10;
```

有长事务占连接时 `SELECT pg_terminate_backend(<pid>)`（先确认不是迁移 / 备份）；连接数接近上限但无长查询时查 Vercel 实例数与每实例池上限；单个查询持续变慢就单独 `EXPLAIN (ANALYZE, BUFFERS)`。

**T34 已完成自检侧**：旧迁移曾用 `rolconfig` 给运行期角色设置三条超时，该迁移随基线重建退役，目标态基线不设这三条；`verify:deploy` 现在会读 `rolconfig` 并把缺失**显式报成 `SKIP`**，不再假装自检覆盖了它。注入三条超时属于目标环境配置决策，须在 G1 书面确认后由技术负责人决定，值班不要临时 `ALTER ROLE`。

### RB-6 所有页面报错（React #441 + digest）

浏览器 console 出现 `Minified React error #441` 紧跟 `Unhandled route error` digest，页面只剩错误边界；匿名页与 `/api/health` 都正常。`#441` 只说明某个 Server Component 渲染时抛错，生产构建把消息换成了 digest；`/api/health` 只跑 `select 1`，**它绿不能证明 schema 对得上**。

先对比生产库与 journal。**迁移记录表由 Drizzle 迁移器创建，核对前先查实际表名，不要凭文档里的数字或写死的表名判断**：

```sql
SELECT schemaname, tablename FROM pg_tables WHERE tablename LIKE '%migrations%';
```

```bash
node -e "console.log(require('./lib/db/migrations/meta/_journal.json').entries.length)"
pnpm db:migrate                              # 用 POSTGRES_URL_DIRECT
node scripts/verify-deployment.mjs --skip-http
```

**big-bang 切换特有**：G0① 把 journal 重置为 1 条，目标库里旧的一批已应用记录不清会让迁移器误判；切换前按 `T52` 先清空旧迁移记录再迁移，这条不适用于日常发布。迁移后带真实会话重试出错页面，确认 200 且 HTML 里没有 digest。**不要手抄当前迁移条数**——以 journal 为准，它会变。

### RB-7 迁移失败 / 需回滚发布

CI 阶段失败、未上生产：修 SQL 重跑，生产库未被触碰。已应用但应用启动失败：**没有 down 迁移，不能回滚数据库**，只能按 §2.1 从切换前恢复点整体恢复，再决定重切。写坏数据：同样用 Neon 分支 / PITR 恢复点。卡在锁等待：查 `pg_locks` + `pg_stat_activity`；目标态基线不设 `lock_timeout`，**不要假设 5 秒后会自动放弃**。季度演练从 PITR 恢复到临时分支 → 抽查核心表行数 → 记录实际耗时；`T50` 已要求在切换前留命令输出，在那之前恢复能力只是纸面数字。

### 巡检 SQL

```sql
-- 每张业务表是否都开了 RLS（应为 0 行）
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
  AND c.relname NOT LIKE '\_drizzle%';
-- 是否存在未 InitPlan 化的隔离策略（应为 0 行）
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
  AND coalesce(qual, '') NOT LIKE '%(SELECT app.visible_org_array())%';
-- 业务角色不能触达认证表（应为 false）
SELECT has_schema_privilege('genealogy_app', 'auth', 'USAGE') AS leaked;
```

## 4. 值班能看到的信号

结构化 JSON 日志由 `lib/logger.ts` 写 stdout/stderr。级别由 `instrumentation.ts` 在 Node 运行时调 `setLogLevel(resolveLogLevel())` 注入；`LOG_LEVEL` 未配置时**生产 `info`、开发 `debug`**（`lib/config.ts`）。`lib/logger.ts` 里那个 `'error'` 兜底**只作用于浏览器错误边界**——同一模块也被打进客户端包，读不到 server-only 配置，它不是服务端默认级别。

`request_id` 由 `lib/api.ts` 的 `withApiLogging` 经 `runWithRequestContext` 建立，只在 Route Handler 有；`addLogContext` 唯一写入的是 `user_id`（`lib/auth/context.ts`）。Server Action 没有 `request_id`——用户报错时若只有时间窗，只能靠 `user_id` 猜。`RequestLogContext` 里声明了 `org_id`，但全仓没有任何写入点，按组织聚合做不到。

运行期两条连接分别是业务 `genealogy_app`（在 RLS 内）与认证 `auth_service`（`auth.*` 四表无 RLS，`verify:deploy` 断言两者不互为成员）；日志里不会出现软删过滤条件，因为目标态没有软删列。删除失败常见 `23001`（`RESTRICT`），插入类外键违约才是 `23503`（`NO ACTION`）——值班要能区分「删不掉」与「已经删了」。

`/api/health` 是唯一运行时探针，匿名可访问，只 `select 1`。**没有外部告警系统、没有 APM、没有分布式追踪**；能看的只有 Vercel 函数日志、Neon 指标、健康响应。信号缺口与阈值见 `docs/nfr.md` §5，本文不重列。切换失败按 §2.1 的恢复剧本处理，不要在这里临时发明步骤。

## 5. 新增 runbook 的结构

不预建空的 `deploy.md` / `rollback.md` / `troubleshoot-*.md`——没有触发过演练的空文件只会制造无人维护的副本。真出现新场景时，在本文加一节并包含：触发条件与影响面 → 前置检查 → 编号步骤（每步预期结果）→ 验证（冒烟用例 + 关键指标，回链 `docs/nfr.md`）→ 回滚阈值与数据兼容性 → 记录与复盘。复盘结论上传项目资料库，后续优化点创建事项。

## 6. 核对与待办

```bash
# 命令是否仍存在（清单以 package.json 为准）
node -e "console.log(Object.keys(require('./package.json').scripts).join('\n'))"
# 迁移基线以 journal 为准，别信文档里的数字
node -e "console.log(require('./lib/db/migrations/meta/_journal.json').entries.length)"
# 部署自检是否读 rolconfig（T34 已补：缺失显式报 SKIP）
grep -n "rolconfig" scripts/verify-deployment.mjs
# 目标态验收是否进了 CI
grep -n "verify:target-schema" .github/workflows/ci.yml
# 变量清单与作用域
cat .env.example
```

| 待办                                | 触发条件              | 说明                                                                                                                                |
| ----------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 恢复演练                            | 每季度一次            | 无 RPO / RTO 承诺；`T50` 的本地等价演练已留档（§2.2），托管 Neon 分支 / PITR 演练上生产前补；`S7` 会补外部探针                      |
| 在目标基线注入三条 `rolconfig` 超时 | G1 目标环境书面确认后 | T34 已完成自检侧：`verify:deploy` 读 `rolconfig` 并把缺失显式报 `SKIP`，不再是假 PASS；注入三条超时属环境配置决策，待技术负责人确认 |
| 删除二次确认                        | 出现真实误删工单后    | 目标态无软删、无回收站 UI，不能靠运维 `UPDATE` 恢复；见 RB-1                                                                        |

写在文档里但拦不住的规则等于没有规则：部署自检、CI、季度演练是本层仅有的自动执行者，其余前置检查靠值班人复核。
