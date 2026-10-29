# 0016. 租户列不可变：UPDATE 不得改归属列

- **状态**：已接受
- **日期**：2026-10-29
- **可逆性**：双向门（`DROP TRIGGER` 即回到原状——但那等于重新打开越权路径，见「重估触发条件」）
- **相关**：[data-model §12](../data-model.md) · [ADR 0006](./0006-rls-isolation.md) · [ADR 0004](./0004-soft-delete-forever.md) · 迁移 `lib/db/migrations/0015_forbid_tenant_move.sql` · `tests/integration/tenant-immutability.test.ts` · 蓝图 §7.5

## 背景

`withOrg` 里业务以 `app_rw` 执行，而 `app_rw` 对每张业务表都有 `UPDATE`。RLS 的 `UPDATE` 策略分两半，各自只看一行：

- `USING` 看到的是 **旧行**，用来判断「你能不能碰这一行」；
- `WITH CHECK` 看到的是 **新行**，用来判断「改完的结果你是否仍然有权持有」。

同时属于两个组织的用户，在旧行上满足 `USING`（他是 A 组织成员），在新行上也满足 `WITH CHECK`（他是 B 组织成员）。于是下面这句在迁移前**成功返回**：

```sql
-- withOrg(userId) 内，user 同时是 A、B 的 owner
update project set organization_id = 'B 的 id' where id = 'A 的项目';
```

三条移动用例（project → 另一组织、lineage → 另一项目、node → 另一谱系）在写测试时全部「通过」——失败信息是 `promise resolved "[]" instead of rejecting`，即真的搬走了。这不是理论风险，是已发布代码里的 P0 越权路径。

危害不只是「看到别人的数据」，而是**归属被改写**：行搬走后原组织的成员看到它凭空消失；目标组织凭空多出一份自己没建过的谱系；`activity_logs`、软删批次、审计追溯全部指向错误组织。三层防护（应用层 `WHERE`、RLS、复合外键）的根都是 `organization_id`，根一旦可改，上面三层同时失效。

## 决策

每张带租户列的表挂一个 `BEFORE UPDATE ... FOR EACH ROW` 触发器，调用同一个函数 `app.forbid_tenant_move()`，要钉住的列名从 `TG_ARGV` 传入：

```sql
CREATE OR REPLACE FUNCTION app.forbid_tenant_move() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION 'column %.% is immutable', TG_TABLE_NAME, col
        USING ERRCODE = '42501',
              HINT = 'tenant and ownership columns cannot be reassigned; create a new row instead';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
```

用 `IS DISTINCT FROM` 而不是 `<>`：`activity_logs.organization_id` 对账号级事件是 `NULL`，而 `NULL <> NULL` 是 `NULL`，会让 `NULL → 某组织` 的搬运悄悄通过。

### 为什么用触发器，而不是收紧 policy

`USING` 只能看旧行，`WITH CHECK` 只能看新行，**policy 表达不了「比较两行」**。要在 policy 里做到等价效果，只能塞子查询或再写一个 `SECURITY DEFINER` 辅助函数按主键回查旧行——既绕、又慢（每次 UPDATE 多一次回查）、还要在 10 个策略块里重复。触发器是 PostgreSQL 里唯一同时拿到 `OLD` 和 `NEW` 的地方，而且它是**兜底**：直接 SQL、`psql`、将来的脚本都绕不过去，符合「RLS 是兜底，不是替代品」的立场。

### 为什么列清单是「归属列」，不是「全部外键列」

决定「这行属于谁」的列才钉住：`organization_id`，加上它的上一级容器（`project_id`、`lineage_id`、`book_id`）。结构关系列是**合法的可变状态**，钉住它们会把正常功能变成 500：

| 列 | 为什么不钉 |
|---|---|
| `node.parent_id` / `node.spouse_of_id` | 移动人丁、改父、挂配偶都是产品功能（`lib/lineage/node-services.ts`） |
| `folder.parent_id` | 文件夹可以换父 |
| `lineage` / `article` / `book` 的 `folder_id` | 重新归类；删除文件夹时 `deleteFolderInTransaction` 会把内容解除归类（`folder_id = NULL`） |
| `book_catalog` 的排序、`node.sort` / `path` / `depth` / `generation` | 排版与路径重算 |

`folder_id` 这一条是**实测出来的**：按「所有外键都钉住」写完后，`tests/integration/folders-lineages.test.ts` 有 3 条用例变红（`column lineage.folder_id is immutable`、SQLSTATE `42501`）——「删除文件夹 → 内容解除归类」是产品行为，不是越权。所以 `folder_id` 保持可写，`project_id` / `lineage_id` / `book_id` 钉住。

### 受保护的 10 张表

| 表 | `TG_ARGV` |
|---|---|
| `organization_member` | `'organization_id'` |
| `invite` | `'organization_id'` |
| `project` | `'organization_id'` |
| `folder` | `'organization_id', 'project_id'` |
| `lineage` | `'organization_id', 'project_id'` |
| `node` | `'organization_id', 'lineage_id'` |
| `article` | `'organization_id', 'project_id'` |
| `book` | `'organization_id', 'project_id'` |
| `book_catalog` | `'organization_id', 'book_id'` |
| `activity_logs` | `'organization_id'` |

**新增组织级表必须挂这个触发器**，否则它静默不受保护。`tests/integration/tenant-immutability.test.ts` 断言的是这 10 张表的**精确集合**（不是子集），所以加表忘挂触发器会让测试变红——这是 ADR-24「约束必须有执行者」的应用。

### 授权：两个运行期角色都给，且不 `REVOKE FROM PUBLIC`

`app_rw` 与 `auth_service` 都拿到 `USAGE ON SCHEMA app` 与 `EXECUTE ON FUNCTION app.forbid_tenant_move()`。`organization` / `organization_member` / `invite` 的写权限属于 `auth_service`（Better Auth 的 organization 插件会 `UPDATE` 它们改角色名、组织名）。

**实测修正**：PostgreSQL 18 在 `CREATE TRIGGER` 时检查函数 `EXECUTE` 权限，触发器**触发时不再检查**。把 `auth_service` 的 `EXECUTE` 撤掉后重跑 `tests/integration/better-auth.test.ts`，29 个用例仍然全绿。所以这份授权今天是**双保险而不是必需**——保留它是因为：迁移角色一旦不是超级用户（托管平台、CI 用受限角色），创建触发器时就会因缺少 `EXECUTE` 报错，而那种失败只在部署时出现；冗余授权的代价远低于漏授。

不 `REVOKE ALL ... FROM PUBLIC`：这个函数只读 `NEW` / `OLD` 并可能 `RAISE`，没有可被滥用的能力，而漏授一个角色会让成员管理在生产上失败。

## 后果

### 正面

- 越权路径关闭：三条移动用例从「UPDATE 成功」变成 `42501` + 明确 hint。
- 单函数 + `TG_ARGV`：新增表是一行 `CREATE TRIGGER`，不是 20 行几乎相同的 PL/pgSQL。
- 报错自带表名与列名（`column lineage.lineage_id is immutable`），日志和排障不需要猜。
- 与 RLS、复合外键、软删正交：不改变任何合法路径，`pnpm test:integration` 全绿（15 文件 / 147 用例）。

### 负面

- **合法的数据搬迁被一并禁止**：把项目/谱系真正迁到另一个组织，现在必须「建新行 + 软删旧行」，运维脚本不能 `UPDATE organization_id`。这是有意为之——但意味着将来做「迁移到别的组织」功能时要写显式服务，而不是一句 UPDATE。
- 每行 `UPDATE` 多一次 plpgsql 调用与若干次 `to_jsonb` 构造；批量更新（如整支人丁重算 `path`）有可见但很小的开销。
- 触发器集合是**手写清单**：新表忘挂不会报错，只能靠那条精确集合断言的测试发现；如果将来表数超过 ~20 张，值得改成从 schema 元数据生成。
- 需要 `CREATE SCHEMA` 权限（迁移角色已具备；托管平台若限制建 schema，函数要挪到 `public`）。

### 中性

- 函数放在新的 `app` schema，与 `auth`（成员判断）分开；`app` 不属于任何租户，只有函数，没有表。
- 只拦 `UPDATE`。`INSERT` 仍由 RLS `WITH CHECK` 与复合外键把关——往错误的组织插入本来就被挡住，触发器不重复做这件事。

## 放弃的方案

| 方案 | 为什么不够好 |
|---|---|
| 收紧 RLS 策略 | `USING` 只看旧行、`WITH CHECK` 只看新行，policy 表达不了「这一列不许变」；等价写法要回查旧行，慢且要在 10 处重复 |
| 只给 `app_rw` 列级 `UPDATE` 权限（`GRANT UPDATE (name, …)`） | 列级授权是静态清单，10 张表 × 十几个列要逐个维护；新增列默认不可写，每次加列都得改授权；也不区分「谁在改」 |
| 只保护 `organization_id`，放过 `project_id` / `lineage_id` | 同组织内跨项目、跨谱系搬运同样越权：复合外键只保证「引用成立」，不保证「容器没变」 |
| 在应用层（move 服务）断言 | 只保护走过服务的路径；直接 SQL、未来脚本、新代码都能绕，且与「RLS 是兜底」的立场冲突 |
| 用视图 + `INSTEAD OF` 触发器暴露可写列 | 要重写所有查询与写入路径，代价远超收益 |
| 让 `app_rw` 失去 `UPDATE`、全部改写走 `SECURITY DEFINER` 函数 | 等于把整个写路径重做成存储过程，与 Drizzle 的用法冲突 |

## 重估触发条件

1. **出现「把谱系/项目迁到另一个组织」的产品需求** → 写成「建新行 + 软删旧行」的显式服务（保留审计与活动日志），而不是放松触发器。
2. **组织合并 / 家族合并**（把 A 组织整体并入 B）→ 需要一条受审计的例外路径与新 ADR；不要靠临时 `ALTER TABLE ... DISABLE TRIGGER`。
3. **受保护表超过 ~20 张** → 触发器清单改为从 schema 元数据生成，避免手写清单与 schema 漂移。
4. **托管平台不允许创建 `app` schema** → 函数迁到 `public`，同时更新授权与迁移注释。
