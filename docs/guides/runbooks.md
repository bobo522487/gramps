# 运维 Runbook

> **回答什么问题**：出事了按哪几步做？误删怎么恢复？密钥怎么换？连接池满了怎么办？
> **读者**：运维 / 值班　**长度上限**：4 页
> **性质**：how-to。所有命令与表名对应**当前实现**。

---

## 0. 通用前置

### 0.1 连接方式

| 用途 | 连接串 | 角色 |
|---|---|---|
| 应用运行 | `POSTGRES_URL`（Neon pooled） | `app`（继承 `app_rw`，受 RLS 约束） |
| 认证运行 | `AUTH_POSTGRES_URL`（Neon direct） | `auth_runtime` → 启动参数固定 `auth_service`；pooler 不支持该参数 |
| 迁移 / 运维 / 备份 | `POSTGRES_URL_DIRECT`（Neon direct） | 迁移角色（拥有 `BYPASSRLS`） |

**所有运维操作都用 `POSTGRES_URL_DIRECT`。** 用 `POSTGRES_URL` 会因为 RLS 与权限限制而失败或只看到部分数据。

```bash
psql "$POSTGRES_URL_DIRECT"
```

### 0.2 三条铁律

1. **先备份，再动手。** 任何写操作前先 `pg_dump` 相关表。
2. **先查，再改。** 每一步都先跑 `SELECT` 确认影响范围，再跑 `UPDATE`。
3. **走工单。** 生产库的写操作不允许开发直接执行，必须有人复核。

### 0.3 先确认 RLS 前提没被破坏

这是全系统最脆弱的一个隐含假设（见 [ADR-0006](../decisions/0006-rls-isolation.md)）：

```sql
-- 迁移角色必须 BYPASSRLS，否则注册触发器与所有 RLS 策略会同时失效
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

若返回 `false`，**不要继续任何操作**，先恢复角色权限。

---

## RB-1 误删数据恢复

### 症状

用户报告「某一支人丁不见了」「谱系被删了」。

### 判断

软删不删数据，只在 `deleted_at` 上写时间戳。先确认是软删还是真的没录进去：

```sql
-- 查最近的删除批次（同一事务的 deleted_at 完全相同）
SELECT deleted_at, count(*) AS rows
FROM node
WHERE deleted_at > now() - interval '7 days'
GROUP BY deleted_at
ORDER BY deleted_at DESC
LIMIT 20;
```

拿到候选 `deleted_at` 后，**先看它删了什么、属于哪个组织**：

```sql
SELECT
  'node'    AS tbl, organization_id, lineage_id, count(*)
FROM node    WHERE deleted_at = $1 GROUP BY 1,2,3
UNION ALL
SELECT 'lineage', organization_id, id, count(*)
FROM lineage WHERE deleted_at = $1 GROUP BY 1,2,3
UNION ALL
SELECT 'article', organization_id, project_id, count(*)
FROM article WHERE deleted_at = $1 GROUP BY 1,2,3
UNION ALL
SELECT 'book',    organization_id, project_id, count(*)
FROM book    WHERE deleted_at = $1 GROUP BY 1,2,3;
```

### 恢复

```sql
BEGIN;

-- 关键：必须同时限定 organization_id，否则会跨组织误恢复
UPDATE node
   SET deleted_at = NULL
 WHERE deleted_at = $1
   AND organization_id = $2;

UPDATE lineage
   SET deleted_at = NULL
 WHERE deleted_at = $1
   AND organization_id = $2;

-- 恢复后重算冗余计数
UPDATE lineage l
   SET node_count = (
     SELECT count(*) FROM node n
      WHERE n.lineage_id = l.id AND n.deleted_at IS NULL
   )
 WHERE l.id = $3;

COMMIT;
```

### 风险

- **恢复粒度是事务级**：一次删除操作的所有行共享 `deleted_at`，无法只恢复其中三个人。
- 若删除的是 `project`，其下的 `lineage`/`node` 也会带同一个 `deleted_at`；只恢复子表而不恢复 `project`，数据会「活着但看不见」。
- 恢复可能撞唯一索引：删除后有人建了同名对象，`UPDATE` 会报 `23505`。先查同名再决定改名还是放弃恢复。

### 事后

- 记录工单：谁、何时、删了什么、恢复范围。
- 若同一组织重复误删，考虑把回收站从 M2 提前。

---

## RB-2 用户忘记密码 / 强制下线

### 症状

用户无法登录，且没有自助找回（M1 无邮件通道，见 R7）。

### 步骤

1. **验证身份**（线下确认：家族联系人、邀请人、组织 owner 之一）。没有验证就不重置。

2. 生成 Better Auth 兼容的 scrypt 哈希（与应用一致，复用 `better-auth/crypto`）：

```bash
node --input-type=module -e "import { hashPassword } from 'better-auth/crypto'; console.log(await hashPassword(process.argv[1]))" '临时密码'
```

3. 更新 `auth.account.password` 并删除该用户的全部数据库会话：

```sql
BEGIN;

UPDATE auth.account a
   SET password = '<scrypt-hash>',
       updated_at = now()
  FROM auth.users u
 WHERE a.user_id = u.id
   AND a.provider_id = 'credential'
   AND lower(u.email) = lower('user@example.com');

DELETE FROM auth.session s
 USING auth.users u
 WHERE s.user_id = u.id
   AND lower(u.email) = lower('user@example.com');

COMMIT;
```

4. 通过可信渠道把临时密码告知用户，并要求其登录后立即改密。

### 注意

- 运行时业务角色 `app_rw` **没有** `auth.*` 的表权限，此操作必须用 `POSTGRES_URL_DIRECT` 或 `auth_service` 连接。
- Better Auth 的密码记录在 `auth.account`（`provider_id = 'credential'`），不在 `auth.users`。
- 只想「踢掉某用户所有会话」时，只执行上面的 `DELETE FROM auth.session`，不动密码。

---

## RB-3 组织没有 owner

### 症状

组织内所有成员都无法修改设置 / 邀请成员，或组织切换器显示异常。

### 判断

```sql
SELECT o.id, o.name, o.slug
FROM organization o
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM organization_member m
     WHERE m.organization_id = o.id
       AND m.role = 'owner'
  );
```

数据库有「单组织仅一个 owner」的部分唯一索引，但没有「至少一个 owner」的数据库约束；`trg_org_member_last_owner_delete` / `trg_org_member_last_owner_update` 会阻止通过 Better Auth 删除或降级最后一个 owner，但直接绕过服务层写库仍可造出这种状态（已知风险）。`organization_member` 是硬删除，没有 `deleted_at`。

### 修复

把某个 `admin` 提升为 owner：

```sql
BEGIN;
UPDATE organization_member
   SET role = 'owner'
 WHERE organization_id = $1
   AND user_id = $2
   AND role = 'admin';
COMMIT;
```

若组织内已无任何有效成员，需先按邀请流程重新加入一个成员，再提 owner。

---

## RB-4 轮换 `BETTER_AUTH_SECRET`

### 现状（重要）

Better Auth 用 `BETTER_AUTH_SECRET` 签名 Cookie，但会话记录保存在 `auth.session` 表。轮换密钥会让现有 Cookie 无法通过校验：

> **轮换 `BETTER_AUTH_SECRET` 会让全量用户在下次请求时失去会话。**

这是已知限制（见 [13-风险与演进规划 R6 / R20](../architecture/13-风险与演进规划.md)）。

### 什么时候必须轮换

- 密钥疑似泄露（出现在日志、截图、代码仓库、第三方工具里）。
- 人员变动导致密钥经手范围变化。

### 步骤

1. 选一个低峰时段（例如当地凌晨），并提前公告「所有用户需重新登录」。
2. 生成新密钥（≥ 32 字节）：

```bash
openssl rand -base64 48
```

3. 在 Vercel 更新 `BETTER_AUTH_SECRET` 环境变量，重新部署。
4. 观察登录成功率；若大面积失败，回滚环境变量（旧密钥仍有效，直到被覆盖）。
5. 轮换后如需立即清理旧会话，可删除 `auth.session` 中的记录；会话删除后用户必须重新登录。

### 改进方向

加 `kid` + 双密钥（当前 + 上一把），轮换变成「加新 → 保留 1 天 → 删旧」，零登出。约 15 行代码，见 [13-风险与演进规划 R20](../architecture/13-风险与演进规划.md)。

---

## RB-5 连接池耗尽 / 数据库变慢

### 症状

- 大量请求 500，日志出现 `too many clients already` / `timeout exceeded when trying to connect`。
- 页面 TTFB 突增，但 CPU 不高。

### 判断

```sql
-- 按角色与状态看连接占用（生产应用角色是 app）
SELECT usename, state, count(*)
FROM pg_stat_activity
GROUP BY 1, 2
ORDER BY 3 DESC;

-- 找出跑得最久的查询
SELECT pid, usename, state,
       now() - query_start AS duration,
       left(query, 120) AS query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY duration DESC
LIMIT 10;
```

### 处置

| 情况 | 动作 |
|---|---|
| 有长事务占着连接 | `SELECT pg_terminate_backend(<pid>);`（先确认该 pid 不是迁移/备份） |
| 连接数接近上限但无长查询 | 检查 Vercel 实例数是否异常增长；确认每实例 `pool.max` 为 1–5，且已调用 `attachDatabasePool` |
| 某个查询持续变慢 | 单独 `EXPLAIN (ANALYZE, BUFFERS)`；多半是缺索引或统计信息过期 |

### 根治（已配置）

迁移 `0006_statement_timeouts` 已为运行期角色设置：

```sql
ALTER ROLE app_rw SET statement_timeout = '10s';
ALTER ROLE app_rw SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_rw SET lock_timeout = '5s';
ALTER ROLE auth_service SET statement_timeout = '10s';
ALTER ROLE auth_service SET idle_in_transaction_session_timeout = '30s';
```

这是成本最低、收益最高的一条护栏；`verify:deploy` 尚未断言 `rolconfig`（评审 P1-11 验收项）。

---

## RB-6 迁移失败 / 需要回滚发布

### 原则

**没有 down 迁移。** 破坏性变更一律用三段式：加列（可空）→ 回填 → 加约束。所以「回滚」通常指**回滚应用版本**，而不是回滚数据库。

### 判断迁移是否已应用

```sql
SELECT id, hash, created_at FROM drizzle._drizzle_migrations ORDER BY created_at DESC LIMIT 5;
```

### 处置

| 情况 | 动作 |
|---|---|
| 迁移在 CI 阶段失败，未上生产 | 修 SQL，重跑。生产库未被触碰 |
| 迁移已应用，应用启动失败 | **回滚应用版本**（Vercel 即时回滚到上一版本）。新列是可空的、新表未被读写，旧版本可以正常运行 |
| 迁移写坏了数据 | 用 Neon 分支或 PITR 恢复到迁移前时间点，再在分支上验证新迁移 |
| 迁移卡住（锁等待） | 查 `pg_locks` + `pg_stat_activity`；`lock_timeout` 已由 `0006` 配置为 5s（迁移/备份连接可能例外） |

### 恢复演练

RPO ≤ 1 天、RTO ≤ 4 小时是承诺（[08-非功能性设计 §5](../architecture/08-非功能性设计.md)）。**每季度做一次真实恢复演练**，否则这个承诺只是纸面数字。演练内容：从 PITR 恢复到临时分支 → 抽查三张核心表行数 → 记录实际耗时。

---

## 附：常用巡检 SQL

```sql
-- 1. 每张业务表是否都开了 RLS（应为 0 行）
SELECT c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND NOT c.relrowsecurity
  AND c.relname NOT LIKE '\_drizzle%';

-- 2. 是否存在裸子查询式 RLS 策略（应为 0 行，见 ADR-0006）
SELECT tablename, policyname FROM pg_policies
WHERE qual LIKE '%organization_member%' AND qual NOT LIKE '%has_org_role%';

-- 3. 软删数据量（评估是否需要归档）
SELECT 'node' t, count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted, count(*) AS total FROM node;

-- 4. 无 owner 的组织（应为 0 行）
SELECT o.id, o.name FROM organization o
WHERE o.deleted_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM organization_member m
   WHERE m.organization_id = o.id AND m.role = 'owner'
);
```
