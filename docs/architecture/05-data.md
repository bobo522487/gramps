# 数据架构

> **回答什么问题**：数据存在哪？怎么隔离？怎么保持一致？规模上限是多少？
> **读者**：开发 · 运维　**长度上限**：4 页
> **来源**：原 `architect.md` §8（编号保持不变），另加 §8.5（新增）
> **表结构、索引、RLS 策略的完整定义**在 [data-model.md](../data-model.md)；本文只写**架构层面**的取舍。

---

## 8. 数据架构

### 8.1 存储模型

| 数据 | 位置 | 说明 |
|---|---|---|
| 结构化数据 | PostgreSQL 18+ | 10 张业务表 + `auth.users` |
| 富文本 | PostgreSQL `jsonb` | ProseMirror 文档 |
| 会话 | `session` Cookie（jose JWT HS256） | 应用签发与校验；`token_version` 撤销 |
| 图片字节 | 无对象存储 | M1 不上传媒体，M2 再定 |

### 8.2 隔离

三层防护，缺一不可：

| 层 | 机制 |
|---|---|
| 应用层 | 所有查询 `WHERE organization_id = $1` |
| 数据库层 | RLS `organization_isolation`，`FORCE ROW LEVEL SECURITY` |
| Schema 层 | 复合外键 `(organization_id, project_id)` 阻止跨组织引用 |

RLS 策略基于 `organization_member` 子查询，**组织不写进 JWT**。详见 [data-model §12](../data-model.md#12-隔离与-rls) 与 [ADR-0006](../decisions/0006-rls-isolation.md)。

> **一个必须显式记录的前提**：RLS 策略与 `SECURITY DEFINER` 函数（含注册触发器）成立的前提是**迁移角色拥有 `BYPASSRLS`**。若运维为「最小权限」把迁移角色降成普通角色，注册与所有策略会同时失效，且报错信息（`infinite recursion detected in policy`）指不到根因。该前提应作为部署校验项断言，见 [07-quality](./07-quality.md)。

### 8.3 连接

| 项 | 值 |
|---|---|
| 驱动（本地） | `postgres.js` + `drizzle-orm/postgres-js`；直连 `localhost:5432`，无 pooler，可用默认 prepared statements |
| 驱动（生产） | `pg` 的 `Pool` + `drizzle-orm/node-postgres`；模块级单例，并调用 `@vercel/functions` 的 `attachDatabasePool` |
| 连接方式 | `POSTGRES_URL` 指向 Neon pooled endpoint |
| 连接数 | 生产每个 Vercel 函数实例 pool = 1–5 |
| 直连 | 迁移、备份与运维使用 `POSTGRES_URL_DIRECT`（Neon direct） |
| 迁移 | CI 里用直连 URL，与应用运行期分离 |
| 类型边界 | 驱动工厂导出 `db` 与 `Db` 类型；仓储层只 import 这两者，不直接 import `pg` 或 `postgres` |

`postgres.js` 只在本地使用；生产不要用它连接 Neon 事务池，也不需要为生产设置 `prepare: false`。`pg` 默认不创建命名 prepared statements，与 pooled endpoint 兼容。

### 8.4 一致性策略

| 数据 | 策略 |
|---|---|
| 人丁数展示 | 读 `lineage.node_count`（冗余计数），写入时同事务维护 |
| 编目引用 | 真外键 + `ON DELETE RESTRICT` |
| 树路径 | 写入时重算受影响子树（移动节点时批量 `UPDATE ... SET path = ...`） |
| 软删分组 | 同一事务的所有软删行共享 `deleted_at`（`now()` 取事务开始时间），供运维整组恢复 |

### 8.5 容量口径（新增）

原文档只有「单组织人丁 ≤ 50 万」一个数字，无法判断它约束的是哪一层。三种规模对应三种完全不同的技术承诺，必须分开：

| 口径 | 上限 | 约束的是什么 |
|---|---|---|
| 组织内人丁总量 | 50 万（跨全部谱系） | 存储与索引规模；决定是否需要外部搜索索引 |
| 单谱系人丁数 | 5 万 | 单次读取与画布内存；决定按代加载的窗口策略 |
| 画布同时可见节点 | 2000 | 帧率（≥45fps）；决定渲染窗口与 `onlyRenderVisibleElements` |

**为什么必须分开**：`prd.md` §7 的 50 万是组织级上限，而 `G2` 的「十万级」与「1000 节点 45fps」说的是画布体验。三者混用会让「1000 节点达标」被误读为「50 万人丁也达标」——后者在浏览器端不可能成立。

### 8.6 数据生命周期（缺口）

当前设计对「数据活多久」只有一个答案：**软删，永不物理删除**（[ADR-0004](../decisions/0004-soft-delete-forever.md)）。这对误删保护是正确的，但它同时意味着：

- 账号注销后，该组织的全部人丁信息永久保留；
- 家谱包含**在世人口**的姓名、性别、生卒、葬地、行传，属于个人信息；
- 数据主体是族人，而账号所有者是组织/修谱人——**用户与数据主体不是同一人**。

因此需要一个明确的数据分级与保留期策略，以及一条物理删除路径。这是当前架构**已知的空白**，不影响 M1 录入功能，但在对客户承诺数据处置能力之前必须补齐。见 [08-evolution](./08-evolution.md) 风险 R18。
