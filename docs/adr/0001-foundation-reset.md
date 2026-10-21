# ADR 0001：基础层重置（Phase 3）

| 项 | 值 |
|---|---|
| 状态 | 已接受，已完成基础层实现 |
| 日期 | 2026-10-21（执行完成 2026-10-22） |
| 决策人 | 项目维护者 |
| 相关文档 | [数据模型](../data-model.md) · [架构](../architect.md) · [实现状态](../implementation-status.md) · [部署蓝图](../ops-target.md) |

---

## 1. 背景

当前仓库是组织/项目控制台脚手架：6 张表、`serial` 主键、`owner/member` 两种角色、应用层隔离、无 RLS。目标设计是家谱 M1：10 张业务表 + `auth.users`、UUIDv7、4 角色、软删、RLS + `app_rw`、复合外键。

Phase 0/1/2 已完成测试安全网、P0 修复与架构接缝。仓库只有演示种子数据，没有生产部署配置或生产数据证据。

## 2. 决策

采用**基础层重置**（路线 B）：

1. **不迁移旧数据。** 旧表与演示数据直接丢弃，由新的基线迁移重建；本地库需要重置。
2. **保留并复用**：认证语义（JWT + `token_version`）、20 位公开 ID、UI/设计系统、结构化日志、测试工具与文档纪律。
3. **URL 不变**：`organization.slug` 与 `project.ref` 继续是 20 位 `[0-9a-z]` 公开 ID；目标文档已与当前实现一致，不需要重定向。
4. **迁移 squash**：删除 `0000`–`0006`，生成新的基线迁移；不保留旧迁移历史。RLS、角色、函数、触发器、扩展写入独立的 custom migration。
5. **一次性引入目标基础层**：
   - UUIDv7（PostgreSQL 18 `uuidv7()`）作为全部主键；
   - `auth` schema + `auth.users`，`app_rw` 无表权限，认证读写走 `SECURITY DEFINER` 函数；
   - 10 张业务表、软删、部分唯一索引、复合外键；
   - 4 角色与权限字符串矩阵；
   - `withOrg`：事务内 `SET LOCAL ROLE app_rw` + `set_config('request.jwt.claims', ...)`，所有组织级查询都经过它；
   - 邀请一次性 token（SHA-256 存储）+ 7 天过期，禁止邀请 `owner`。
6. **`activity_logs` 保留**为产品活动流（D7），不当作审计表；作为第 11 张组织级表启用 RLS，账号级事件的 `organization_id` 为空。

## 3. RLS 成员管理缺口的修复

目标 `data-model.md §12.4` 的 `own_membership` 只允许用户读写自己的成员行，admin 无法管理其他成员。本 ADR 采用以下策略落地：

- 新增 `auth.has_org_role(org_id uuid, roles text[])`（`SECURITY DEFINER`，固定 `search_path`），供 RLS 策略判断调用者角色；函数属主绕过 RLS，因此 `organization_member` 策略不再自引用。
- `organization_member` 的 SELECT：组织内任意成员可读；INSERT/UPDATE/DELETE：`owner`/`admin`。服务层继续禁止移除或降级最后一个 owner，并禁止 admin 操作 owner。
- `organization`：成员可读；INSERT 允许已登录用户（用于新建组织）；UPDATE 仅 `owner`。
- `invite`：`owner`/`admin` 可读写；接受邀请通过 `auth.accept_invite` 的 `SECURITY DEFINER` 路径完成，调用者不需要预先成为成员。
- 内容表（`project`、`folder`、`lineage`、`node`、`article`、`book`、`book_catalog`）：成员可读；写操作要求 `owner`/`admin`/`editor`；`project` 的创建/删除要求 `owner`/`admin`。
- `activity_logs`：用户只能读自己的记录；写入要求 `user_id = auth.uid()` 且组织归属通过成员校验。

这套策略替代目标文档中的 `own_membership`，并在集成测试中覆盖：非成员 0 行、viewer 写入被拒、admin 可管理成员、跨组织引用被复合外键拒绝。

## 4. 迁移顺序

```text
0000_baseline.sql     扩展 + auth schema + 11 张表 + 标准索引（Drizzle 生成，人工加入 CREATE EXTENSION）
0001_auth_rls.sql     角色 app_rw、auth 函数、注册触发器、GRANT、RLS 策略、trgm/GiST 索引（custom migration）
```

约束：

- 迁移内不写数据修复；演示数据由 `pnpm db:seed` 重建。
- `POSTGRES_URL` 在本地/CI 使用可 `SET ROLE app_rw` 的迁移角色；生产按 [ops-target.md](../ops-target.md) 分离 `app`（运行时）与迁移角色。
- CI 在空库执行全部迁移，并断言 `public` 下业务表全部启用 `relrowsecurity`。

## 5. 影响

| 项 | 影响 |
|---|---|
| 本地开发 | 需要 `DROP SCHEMA public CASCADE` 后重新迁移与 seed |
| 公开 ID | 不变；项目不再有可读 `slug`，URL 使用 `ref` |
| 项目字段 | `region/status/health` 移除，改为 `primary_name`、`primary_surname`、`countries_regions`、`hall_code` |
| 邀请 | 从记录式改为一次性 token；UI 需展示可复制链接 |
| 角色 | `owner/member` → `owner/admin/editor/viewer`；业务代码改用权限字符串 |
| 删除 | 业务表全部软删；不提供回收站 UI |
| 事务 | 组织级查询与写入统一走 `withOrg`，连接池不再直接执行组织级 SQL |

## 6. 不在本次范围

- 谱系/谱文/谱书的业务 UI 与 Action（Phase 4）。
- 媒体、分享、回收站、编辑锁、审计表（M2+）。
- 生产 Neon/Vercel 的实际部署验证。
