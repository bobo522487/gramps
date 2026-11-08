# 运维手册（Runbooks）

> **回答什么问题**：上线怎么发、出事按哪几步判断与恢复、怎么确认发布是好的。
> **读者**：值班 / 运维 / 技术负责人　**长度上限**：5 页
> **不写什么**：命令清单（`package.json`）、环境变量取值（`.env.example` / `lib/config.ts`）、CI 步骤顺序（`.github/workflows/ci.yml`）、表与列（`lib/db/schema/`）、阈值与不承诺清单（`docs/nfr.md`）、设计理由（`docs/adr/`）、编排与进度（`docs/roadmap.md`）、术语（`docs/glossary.md`）。

本层只放**代码里查不到的处置判断**和**压力下照着做的步骤**。命令名、变量值、表名、迁移编号都不在这里抄第二遍——它们在各自的真相源里，改代码时不会想起改文档。本文里的 SQL 与命令都对应当前实现，跑之前先按 §6 核对一次。

## 1. 值班前置

### 1.1 连接方式

| 用途 | 连接串 | 角色 |
| --- | --- | --- |
| 应用运行 | `POSTGRES_URL`（Neon pooled） | `app` → `app_rw`，受 RLS 约束 |
| 认证运行 | `AUTH_POSTGRES_URL`（Neon direct） | `auth_runtime` → 启动参数固定 `auth_service`；pooler 会拒绝该参数 |
| 迁移 / 运维 / 备份 | `POSTGRES_URL_DIRECT`（Neon direct） | 迁移角色，拥有 `BYPASSRLS` |

**所有运维写操作都用 `POSTGRES_URL_DIRECT`。** 用 `POSTGRES_URL` 会因为 RLS 与权限限制而失败，或只看到部分数据。变量清单与作用域以 `.env.example` 和 `lib/config.ts` 为准，本文不复制取值。

### 1.2 三条铁律

1. **先备份，再动手。** 任何写操作前先备份相关表；仓库没有应用层备份脚本，用 Neon 分支或 PITR。
2. **先查，再改。** 每一步先跑 `SELECT` 确认影响范围，再跑 `UPDATE`。
3. **走复核。** 生产库的写操作不允许单人直接执行，须有人复核并记录工单。

### 1.3 先确认隔离前提没被破坏

这是全系统最脆弱的隐含假设（理由在 `docs/adr/` 的 `0006`）：

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

返回 `rolbypassrls = false` 时**不要继续任何操作**，先恢复角色权限。注意区分：运行期角色 `app_rw` / `auth_service` 必须 `NOBYPASSRLS`（`verify:deploy` 逐项断言），而迁移 / 运维直连角色才需要 `BYPASSRLS`。两者不是同一条规则。

## 2. 发布与回滚

发布顺序、部署单元与「迁移为什么必须先于应用」在 `docs/architecture.md` 的部署形态，本层只记**值班要确认的开关、要跑的验证、以及什么时候回滚**，不重述顺序与理由。

**每次发布前**，改了 `lib/db/migrations/**` 就必须确认生产迁移 job 绿：`.github/workflows/migrate-production.yml` 在迁移文件合入 `main` 后触发，不可并发、不可被新提交取消，跑完立刻用同一份 journal 校验库结构，失败即红。漏掉这一步的后果见 RB-6。

**没有 down 迁移**。破坏性变更走三段式：加列（可空）→ 回填 → 加约束。因此「回滚」指**回滚应用版本**（Vercel 回退上一部署），不是回滚数据库；新列可空、新表未被读写时，旧版本能正常运行。数据层只有 Neon 分支 / PITR 恢复，没有应用层回滚脚本。

**明确不承诺**：没有 RPO / RTO 承诺，恢复从未演练，完整缺口在 `docs/nfr.md` §5。别把目标值当成已验证能力对外说。

| 阶段 | 验证方式 | 执行者 |
| --- | --- | --- |
| 迁移后 | `node scripts/verify-deployment.mjs --skip-http` 逐项 PASS/FAIL/SKIP | 迁移 job |
| 部署后 | `pnpm verify:deploy`（HTTP 健康 / 安全头 / 鉴权 + 库结构 / RLS / 角色） | CI 与值班 |
| 关键路径 | `pnpm test:e2e`，E2E 报告与截图 | CI |

## 3. 故障处置

每个场景给「判断 → 处置 → 验证」，不重复上文的三条铁律。表与列名以 `lib/db/schema/` 为准。

### RB-1 误删数据恢复

软删只写 `deleted_at`，不删行；业务查询默认过滤。**目前没有恢复 UI**，恢复靠运维直连。先确认是软删还是根本没录进去，按 `deleted_at` 找批次（同一事务的所有行时间戳完全相同）：

```sql
SELECT deleted_at, count(*) FROM node
WHERE deleted_at > now() - interval '7 days'
GROUP BY deleted_at ORDER BY deleted_at DESC LIMIT 20;
```

拿到候选后先 `SELECT` 看清删了什么、属于哪个组织，再恢复。**必须同时限定 `organization_id`**，否则跨组织误恢复：

```sql
BEGIN;
UPDATE node    SET deleted_at = NULL WHERE deleted_at = $1 AND organization_id = $2;
UPDATE lineage SET deleted_at = NULL WHERE deleted_at = $1 AND organization_id = $2;
UPDATE lineage l SET node_count = (
  SELECT count(*) FROM node n WHERE n.lineage_id = l.id AND n.deleted_at IS NULL
) WHERE l.id = $3;
COMMIT;
```

风险：恢复粒度是事务级，无法只恢复其中三个人；删的是云谱空间时要连子表一起恢复，否则数据「活着但看不见」；恢复可能撞唯一索引（`23505`），先查同名再决定改名或放弃。**事实层是一次单向回填的冻结快照，恢复只作用于 `node` / `lineage`，不要回写事实层**（`docs/roadmap.md` 的 `S5` 闸门之前它保持冻结）。事后记录工单；同组织重复误删，走 `S6` 讨论恢复入口，不要在这里临时改流程。

### RB-2 忘记密码 / 强制下线

M1 无邮件通道、无自助找回。先**线下验证身份**（家族联系人、邀请人、组织 owner 之一），没验证就不重置。密码存 `auth.account`（`provider_id = 'credential'`），不在 `auth.users`；运行时业务角色没有 `auth.*` 权限，此操作必须用直连：

```bash
node --input-type=module -e "import { hashPassword } from 'better-auth/crypto'; console.log(await hashPassword(process.argv[1]))" '临时密码'
```

```sql
BEGIN;
UPDATE auth.account a SET password = '<scrypt-hash>', updated_at = now()
  FROM auth.users u WHERE a.user_id = u.id AND a.provider_id = 'credential'
    AND lower(u.email) = lower('user@example.com');
DELETE FROM auth.session s USING auth.users u
 WHERE s.user_id = u.id AND lower(u.email) = lower('user@example.com');
COMMIT;
```

只「踢掉某用户全部会话」时只跑 `DELETE`，不动密码。通过可信渠道交付临时密码并要求登录后立即改密。

### RB-3 组织没有 owner

组织成员与邀请是**硬删除**，没有 `deleted_at`；「单组织最多一个 owner」有部分唯一索引，但「至少一个 owner」没有数据库约束，绕过服务层直写能造出这种状态：

```sql
SELECT o.id, o.name FROM organization o WHERE o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM organization_member m
                  WHERE m.organization_id = o.id AND m.role = 'owner');
```

修复：把某个 `admin` 提为 `owner`（`UPDATE organization_member SET role='owner' WHERE ... AND role='admin'`，包在事务里）。若已无任何有效成员，先按邀请流程加人再提 owner。触发器是兜底，不能替代预检。

### RB-4 轮换 `BETTER_AUTH_SECRET`

**轮换会让全量用户下次请求失去会话**（Cookie 签名失效，会话记录在 `auth.session`）。只在疑似泄露或经手范围变化时做：选低峰时段并提前公告 → `openssl rand -base64 48` 生成 → 在 Vercel 更新变量并重新部署 → 观察登录成功率，大面积失败就回滚环境变量。旧密钥在被覆盖前仍有效。轮换后如需立即清理旧会话，删 `auth.session` 记录即可。

### RB-5 连接池耗尽 / 数据库变慢

日志出现 `too many clients already` / `timeout exceeded when trying to connect`，页面 TTFB 突增但 CPU 不高：

```sql
SELECT usename, state, count(*) FROM pg_stat_activity GROUP BY 1,2 ORDER BY 3 DESC;
SELECT pid, usename, now() - query_start AS duration, left(query,120)
FROM pg_stat_activity WHERE state <> 'idle' ORDER BY duration DESC LIMIT 10;
```

有长事务占连接时 `SELECT pg_terminate_backend(<pid>)`（先确认不是迁移 / 备份）；连接数接近上限但无长查询时查 Vercel 实例数与每实例池上限；单个查询持续变慢就单独 `EXPLAIN (ANALYZE, BUFFERS)`。护栏已在迁移 `0006_statement_timeouts` 为运行期角色设置 `statement_timeout` / `idle_in_transaction_session_timeout` / `lock_timeout`——但 **`verify:deploy` 目前不断言 `rolconfig`**，别以为部署自检会替你发现这三个值被改掉。

### RB-6 所有页面报错（React #441 + digest）

浏览器 console 出现 `Minified React error #441` 紧跟 `Unhandled route error` digest，页面只剩错误边界；匿名页与 `/api/health` 都正常。`#441` 只说明某个 Server Component 渲染时抛错，生产构建把消息换成了 digest；`/api/health` 只跑 `select 1`，**它绿不能证明 schema 对得上**。

先对比生产库与 journal（注意表名是 `drizzle.__drizzle_migrations`，双下划线）：

```sql
SELECT count(*) FROM drizzle.__drizzle_migrations;
```
```bash
node -e "console.log(require('./lib/db/migrations/meta/_journal.json').entries.length)"
pnpm db:migrate                              # 用 POSTGRES_URL_DIRECT
node scripts/verify-deployment.mjs --skip-http
```

两个数字不等就是库落后于代码。迁移后带真实会话重试出错页面，确认 200 且 HTML 里没有 digest。**不要手抄当前迁移条数**——以 journal 为准，它会变。

### RB-7 迁移失败 / 需回滚发布

CI 阶段失败、未上生产：修 SQL 重跑，生产库未被触碰。已应用但应用启动失败：按 §2 回滚应用版本。写坏数据：用 Neon 分支或 PITR 恢复到迁移前时间点，在分支上验证新迁移。卡在锁等待：查 `pg_locks` + `pg_stat_activity`，`lock_timeout` 已由 `0006` 配为 5s。**没有演练过真实恢复**，季度演练从 PITR 恢复到临时分支 → 抽查核心表行数 → 记录实际耗时，否则恢复能力只是纸面数字。

### 巡检 SQL

```sql
-- 每张业务表是否都开了 RLS（应为 0 行）
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
  AND c.relname NOT LIKE '\_drizzle%';
-- 是否存在裸子查询式 RLS 策略（应为 0 行）
SELECT tablename, policyname FROM pg_policies
WHERE qual LIKE '%organization_member%' AND qual NOT LIKE '%has_org_role%';
```

## 4. 值班能看到的信号

结构化 JSON 日志由 `lib/logger.ts` 写 stdout/stderr。级别由 `instrumentation.ts` 在 Node 运行时调 `setLogLevel(resolveLogLevel())` 注入；`LOG_LEVEL` 未配置时**生产 `info`、开发 `debug`**（`lib/config.ts`）。`lib/logger.ts` 里那个 `'error'` 兜底**只作用于浏览器错误边界**——同一模块也被打进客户端包，读不到 server-only 配置，它不是服务端默认级别。

`request_id` 由 `lib/api.ts` 的 `withApiLogging` 经 `runWithRequestContext` 建立，只在 Route Handler 有；`addLogContext` 唯一写入的是 `user_id`（`lib/auth/context.ts`）。Server Action 没有 `request_id`——用户报错时若只有时间窗，只能靠 `user_id` 猜。`RequestLogContext` 里声明了 `org_id`，但全仓没有任何写入点，按组织聚合做不到。

`/api/health` 是唯一运行时探针，匿名可访问，只 `select 1`。**没有外部告警系统、没有 APM、没有分布式追踪**；能看的只有 Vercel 函数日志、Neon 指标、健康响应。信号缺口与阈值见 `docs/nfr.md` §5，本文不重列。

## 5. 新增 runbook 的结构

不预建空的 `deploy.md` / `rollback.md` / `troubleshoot-*.md`——没有触发过演练的空文件只会制造无人维护的副本。真出现新场景时，在本文加一节并包含：触发条件与影响面 → 前置检查 → 编号步骤（每步预期结果）→ 验证（冒烟用例 + 关键指标，回链 `docs/nfr.md`）→ 回滚阈值与数据兼容性 → 记录与复盘。复盘结论上传项目资料库，后续优化点创建事项。

## 6. 核对与待办

```bash
# 命令是否仍存在（清单以 package.json 为准）
node -e "console.log(Object.keys(require('./package.json').scripts).join('\n'))"
# 迁移基线以 journal 为准，别信文档里的数字
node -e "console.log(require('./lib/db/migrations/meta/_journal.json').entries.length)"
# 部署自检是否覆盖 rolconfig（RB-5 的缺口）
grep -n "rolconfig" scripts/verify-deployment.mjs
# 变量清单与作用域
cat .env.example
```

| 待办 | 触发条件 | 说明 |
| --- | --- | --- |
| 恢复演练 | 每季度一次 | 目前无 RPO / RTO 承诺、从未演练；`docs/roadmap.md` 的 `S7` 会补外部探针 |
| `verify:deploy` 断言 `rolconfig` | 技术负责人确认后 | RB-5 的三条超时护栏当前没有自动执行者 |
| `docs:check` 检查范围同步 | 新结构全部落地后 | 现有脚本按旧路径写死，不改会误报 |
| `S6` 恢复入口 | 排期确认后 | 在那之前软删恢复只有本文这条手工路径 |

写在文档里但拦不住的规则等于没有规则：部署自检、CI、季度演练是本层仅有的自动执行者，其余前置检查靠值班人复核。
