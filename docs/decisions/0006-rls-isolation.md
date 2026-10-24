# 0006. RLS 三层隔离，组织不入 JWT

- **状态**：已接受
- **日期**：2026-10-21（原始决策）· 2026-10-22（补记为 ADR）
- **可逆性**：**单向门**（隔离模型是全系统安全假设；换掉等于重做权限体系）
- **相关**：[data-model §12](../data-model.md) · [05-data §8.2](../architecture/05-data.md) · [07-quality §11.2](../architecture/07-quality.md) · [ADR 0001](./0001-foundation-reset.md) · [ADR 0007](./0007-self-hosted-better-auth.md)

> **2026-10-23 修订**：租户写权限（`organization` / `organization_member` / `invite`）已改由 [`auth_service`](./0007-self-hosted-better-auth.md) 承担，`app_rw` 不再拥有这些表的写权限；`SECURITY DEFINER` 函数属主改为 `auth_service`，因此「迁移角色必须 BYPASSRLS」不再是运行前提。**组织不入 JWT、三层隔离的结论仍然有效**，且 Better Auth 的数据库会话同样不含组织声明。

## 背景

家谱包含在世人口信息，跨组织泄露是不可接受的。同时，应用是单库多租户：所有组织的业务表在同一个 `public` schema 里，靠 `organization_id` 区分。

单层防护都有已知的绕过路径：

- 只靠应用层 `WHERE organization_id = $1`：一个被篡改或拼接错的参数就能跨组织；
- 只靠 RLS：用户会同时看到自己所属**所有**组织的数据，无法表达「当前在哪个组织」；
- 只靠外键：外键只防跨组织**引用**，不防跨组织**读取**。

## 决策

**三层同时存在，缺一不可：**

| 层 | 机制 | 防什么 |
|---|---|---|
| 应用层 | 所有查询 `WHERE organization_id = $1` | 查错组织 |
| 数据库层 | RLS `organization_isolation` + `FORCE ROW LEVEL SECURITY`，运行期 `SET LOCAL ROLE app_rw` | 参数注入跨组织 |
| Schema 层 | 复合外键 `(organization_id, project_id)` / `(organization_id, lineage_id)` | 跨组织引用 |

配套的四条关键设计：

1. **组织不写进 JWT**。策略基于 `organization_member` 子查询，URL 决定当前组织。换组织不重签 token，改权限立即生效。
2. **用 `SECURITY DEFINER` 的 `auth.has_org_role(org_id, roles[])` 判角色**，解开 `organization_member` 策略自引用导致的 `infinite recursion detected in policy`。
3. **读/写策略拆开**：SELECT 含 `viewer`，INSERT/UPDATE 不含。
4. **`app_rw` 没有 `auth.users` 表权限**，注册、登录查询、会话校验、改密、邀请接受全部走 `SECURITY DEFINER` 函数。

## 后果

### 正面

- 应用层的任何参数错误都被 RLS 兜住；跨组织访问在数据库层不成立。
- 切换组织零成本（点一个 `<Link>`，无 Action、无 token 重签）。
- 成员被移除后，权限变更立即生效（不需要等 token 过期）。
- 权限矩阵集中在策略里，新增角色只需改 `ARRAY[...]` 参数。

### 负面

- **隐含一个未断言的前提：迁移角色必须拥有 `BYPASSRLS`**。理由：
  - 注册触发器 `handle_new_user()` 是 `SECURITY DEFINER`、属主是迁移角色，它要往开了 `FORCE RLS` 的 `organization` 写数据；
  - `auth.has_org_role()` 同样是 `SECURITY DEFINER`，它要读 `organization_member`，而该表的策略又调用它——**若函数属主受 RLS 约束，这里就是无限递归**。

  今天能跑，是因为迁移角色（本地超级用户 / Neon `neondb_owner`）恰好有 `BYPASSRLS`。若运维为「最小权限」把它降级，**注册与所有策略会同时失效，且报错指向不到根因**。这一条必须作为部署校验项断言，见 [07-quality §11.2](../architecture/07-quality.md) F3 扩展。
- 每个请求多一次 `organization_member` 查询（组织解析）。这是「切组织零成本」的对价，且它是全库最热的索引。
- 策略写错会导致**全表**递归报错，影响面是整个应用而不是某张表。改动策略前必须在真库跑隔离测试。
- RLS 只隔离**组织**，不区分**角色**。角色粒度靠策略里的 `ARRAY[...]`，写错就是把 `viewer` 放进来写。

### 中性

- RLS 策略的子查询在每个被检查的行上求值，依赖 `STABLE` 函数与索引；`has_org_role` 声明为 `STABLE` 是性能要求，不是风格偏好。

## 放弃的方案

| 方案 | 为什么不够好 |
|---|---|
| 只做应用层过滤 | 单层可被绕过；一次拼接错误就是跨组织泄露 |
| 组织写进 JWT | 换组织要重签 token；前端要处理 token 竞态；改权限要等过期 |
| 每个组织一个 schema 或一个数据库 | 隔离最强，但迁移要对 N 个 schema 执行，连接池与运维复杂度爆炸 |
| 用外部认证服务（自带 RLS 集成） | 引入外部 IdP 与供应商依赖；M1 自建成本更低 |
| 视图层隔离（每组织一个 view） | 视图数量随组织数增长，不可维护 |

## 重估触发条件

1. **运维调整迁移角色权限** → 立即验证注册与策略仍可用（这是本 ADR 最脆弱的点）。
2. 需要**字段级权限**（例如「族内读者只能看已故人口」）→ RLS 表达不了，需要视图或列级授权。
3. 出现**跨组织协作**需求（联宗、多个工作室共修）→ 隔离边界从 `organization` 变成「组织集合」，模型要改。

> **落地检查清单**（新增表时逐条对照，见 [guides/add-a-feature](../guides/add-a-feature.md)）：
> - [ ] `ENABLE` + `FORCE ROW LEVEL SECURITY`
> - [ ] SELECT / INSERT / UPDATE 三条策略，写策略不含 `viewer`
> - [ ] 策略体用 `auth.has_org_role(...)`，**不用裸子查询**（裸子查询会漏掉 `deleted_at IS NULL`，让已移除成员仍可读）
> - [ ] `app_rw` 不授 `DELETE`
> - [ ] 有 `organization_id` 的复合外键
