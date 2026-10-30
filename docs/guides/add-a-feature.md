# 如何新增一个业务实体

> **回答什么问题**：加一张表 / 一个功能，要走哪些步？每步的产物和验收是什么？
> **读者**：开发（尤其第一天加入的人）　**长度上限**：3 页
> **性质**：how-to。本文描述**当前仓库的真实做法**，不是目标设计。

---

## 0. 先判断：这是不是「新实体」

| 情况 | 做法 |
|---|---|
| 新表 + 新页面 + 新写入 | 走完整 10 步 |
| 给现有表加列 | 只走 2–4 + 9–10 |
| 只加一个查询 / 只加一个 Action | 走 5–9 |
| 只改 UI | 不走本文 |

---

## 1. 十条

### ① 写清不变量

动手前先回答三个问题，写进代码注释或 PRD §2 术语 + 本域 Zod schema：

- 这个实体属于哪个组织维度？（几乎总是 `organization_id`）
- 哪些字段组合是**非法状态**？（例如「配偶不能有 `path`」）
- 删除它时，谁跟着走？（级联软删 / 解绑 / 禁止删除）

> 不变量写不出来，说明还没想清楚，不要开始建表。

### ② 建表（Drizzle schema）

`lib/db/schema/<domain>.ts`（在 `lib/db/schema/index.ts` 汇总导出）。业务实体表必须包含这五列，缺一个都会在后面出问题：

```ts
export const things = pgTable('thing', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  orgId: uuid('organization_id').notNull(),
  // ...业务列
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  // 复合外键需要它：让子表能用 (organization_id, id) 引用
  unique('uk_thing_organization_id').on(t.orgId, t.id),
  foreignKey({
    columns: [t.orgId, t.projectId],
    foreignColumns: [projects.orgId, projects.id],
  }).onDelete('restrict'),
]);
```

**检查点**：

- [ ] `id` 用 `uuidv7()`，不用 `serial`
- [ ] 有 `organization_id`（隔离键）
- [ ] 有 `deleted_at`（软删）
- [ ] 有 `UNIQUE (organization_id, id)`（复合外键的前提）

### ③ 生成迁移

```bash
pnpm db:generate
```

产物在 `lib/db/migrations/NNNN_*.sql`。**人工 review 后提交**，不要直接 `drizzle-kit push`。

### ④ 手写 custom migration：RLS + 授权 + 索引

Drizzle 不生成 RLS 策略，必须另写一个 custom migration。**照抄 `0001_auth_rls.sql` 的 DO 块结构**，不要手写裸子查询。权威定义在 `0001_auth_rls.sql`；这里是新增表的最小模板。

```sql
ALTER TABLE thing ENABLE ROW LEVEL SECURITY;
ALTER TABLE thing FORCE ROW LEVEL SECURITY;

CREATE POLICY thing_select ON thing
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner','admin','editor','viewer']));

CREATE POLICY thing_insert ON thing
  AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner','admin','editor']));

CREATE POLICY thing_update ON thing
  AS PERMISSIVE FOR UPDATE TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner','admin','editor']))
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner','admin','editor']));

-- 唯一约束必须是部分索引
CREATE UNIQUE INDEX uk_thing_name ON thing (organization_id, project_id, name)
  WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON thing TO app_rw;   -- 不给 DELETE
```

**检查点**：

- [ ] `ENABLE` + `FORCE` 都写了
- [ ] SELECT 含 `viewer`，INSERT/UPDATE **不含**
- [ ] 策略体用 `auth.has_org_role(...)`，**不用**裸子查询
  —— 裸子查询会漏掉 `deleted_at IS NULL`，导致**已移除的成员仍能读到数据**
- [ ] 唯一索引带 `WHERE deleted_at IS NULL`
- [ ] `app_rw` 没有 `DELETE`

### ⑤ 写读函数

`lib/db/queries/<domain>.ts`。签名统一，第一参数是 `userId`，第二是 `orgId`：

```ts
export async function getThings(userId: string, orgId: string, projectId: string) {
  return withOrg(userId, (tx) =>
    tx.select().from(things).where(and(
      eq(things.orgId, orgId),
      eq(things.projectId, projectId),
      isNull(things.deletedAt),
    )).orderBy(asc(things.sort)),
  );
}
```

**检查点**：

- [ ] `where` 里有 `organization_id`（RLS 是兜底，不是唯一防线）
- [ ] `where` 里有 `deleted_at IS NULL`
- [ ] 列表查询有 `limit` 或按规模可控的条件——不要写无上限的全表读

### ⑥ 写 Zod schema

`lib/genealogy/schemas.ts` 或新建 `<domain>/schemas.ts`。所有入口的输入都从这里来，不信任客户端。

### ⑦ 写 Action

`lib/<domain>/actions.ts`。当前仓库统一用 `validatedActionWithUser` 包装，**不要手写校验/取用户**：

```ts
'use server';

export const createThingAction = validatedActionWithUser(
  createThingSchema,
  async (data, _formData, user) => {
    const result = await createThingInTransaction({
      userId: user.id,
      orgId: data.orgId,
      projectId: data.projectId,
      ...data,
    });

    if (!result.ok) {
      return actionError('FORBIDDEN', '没有编辑权限。');
    }

    revalidatePath(`/dashboard/project/${data.projectRef}/things`);
    return { success: '已创建' };
  }
);
```

**检查点**：

- [ ] 用 `validatedActionWithUser` / `validatedAction`
- [ ] Action 使用内部 UUID（`orgId`/`projectId`），不使用 `orgSlug` 作为授权依据
- [ ] 事务服务内部 `withOrg` + 事务内复核权限
- [ ] 写后 `revalidatePath`（目标是最窄路径；当前若只有整树 helper，登记到 implementation-status）
- [ ] 失败返回 `actionError(code, message)`，**不 throw**
- [ ] 成功返回 `ActionState`

### ⑧ 写页面

`app/(dashboard)/dashboard/project/[projectRef]/<x>/page.tsx`。RSC 直读，首屏不发起客户端请求。

```tsx
export default async function Page({ params }: Props) {
  const { projectRef } = await params;
  const ctx = await requireProjectContext(projectRef);
  const things = await getThings(ctx.userId, ctx.organizationId, ctx.projectId);
  return <ThingsView things={things} />;
}
```

### ⑨ 写测试

至少三条集成测试，缺一条就等于没测：

| 用例 | 断言 |
|---|---|
| 正常路径 | 写入成功，字段正确，`node_count` 类冗余计数同步 |
| 跨组织 | 用另一个组织的 id 查询/写入 → **0 行 / 被拒** |
| 只读角色 | `viewer` 写入 → 被拒（403 或策略拒绝） |

放 `tests/integration/<domain>.test.ts`。纯计算逻辑（布局、排序、派生字段）另加单测。详见 [testing.md](./testing.md)。

### ⑩ 更新状态

- `docs/implementation-status.md`：改对应模块行（这是**唯一**的状态来源）

---

## 2. 读路径：一个渲染单元一个事务

**布局与页面由 Next 独立渲染，不共享事务。** 不要用 AsyncLocalStorage 把事务跨渲染周期传递，否则事务会长时间占着连接。

`withOrg()` 每调用一次开一个事务，至少 5 个往返（BEGIN / SET LOCAL ROLE / `set_config` / 查询 / COMMIT）。目标做法：同一页面内的多个查询提供 `*Tx` 变体，在页面层合并到一个事务；不同布局/页面各自开事务是可以接受的。当前代码只有 `logActivityInTx` 等少数 `*Tx` 变体，存量页面仍可能各自开事务（见 2026-10-24 评审 P0-2）。

```ts
// 好：同一渲染单元内一个事务，一个快照
const { lineage, nodes, folders } = await withOrg(user.id, async (tx) => ({
  lineage: await getLineageByIdTx(tx, orgId, lineageId),
  nodes: await getNodesTx(tx, orgId, lineageId),
  folders: await getNavFoldersTx(tx, orgId, projectId),
}));
```

跨事务读会落在不同快照上：`lineage.node_count` 是冗余计数，如果计数查询和节点列表查询分属两个事务，并发写入时会出现「标题写 128 人、列表 127 人」。

**约定**：`lib/db/queries/*` 提供接受 `userId` 自开事务的函数（供单点调用）与接受 `tx` 的 `*Tx` 变体（供页面组合）。新代码优先用 `*Tx` 变体组合；`*Tx` 变体只接收已有事务，不再开新事务。

---

## 3. 一个反例

以下写法在 review 中应被拒绝：

```ts
// ❌ 1. 组织从 body 来，可以伪造
const orgId = input.orgId;

// ❌ 2. 没有 organization_id 条件，全靠 RLS 兜底
await db.select().from(things);

// ❌ 3. 没有 deleted_at 条件，已删数据会出现在列表里
await db.select().from(things).where(eq(things.orgId, orgId));

// ❌ 4. 每个查询各开事务
const a = await getA(userId, ...);
const b = await getB(userId, ...);

// ❌ 5. service 里自己开事务（会嵌套）
export async function createThing() { return withOrg(...) }

// ❌ 6. throw 代替 actionError（UI 会拿到 500 错误页）
if (!ok) throw new Error('conflict');
```

---

## 4. 验收清单

一条命令跑完：

```bash
pnpm check && pnpm typecheck && pnpm test:coverage
```

全部通过，且满足：

- [ ] 新表有 RLS 三策略 + 部分唯一索引 + 无 `DELETE` 授权
- [ ] 读函数都带 `organization_id` 与 `deleted_at` 条件
- [ ] 同一渲染单元合并事务（布局与页面不共享事务）
- [ ] 三条集成测试（正常 / 跨组织 / 只读角色）
- [ ] `implementation-status.md` 已更新

> **Action 契约**：统一为 `ActionState`；见 [api.md §4.2](../api.md#42-出口一server-action--actionstate)。
