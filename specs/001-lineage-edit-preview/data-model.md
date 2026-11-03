# Phase 1 · 数据模型

> **本期零表结构变更、零迁移。** 唯一的数据层改动是代码内的权限枚举。表结构与约束的权威文档仍是 `docs/architecture/04-数据视图-数据架构.md`（本期不动它）。

## 1. 变更总览

| 对象 | 变更 | 类型 | 影响面 |
|---|---|---|---|
| 数据库表 / 列 / 索引 / 约束 | **无** | — | — |
| 权限枚举 | 新增 `lineage.delete` | 代码内枚举（非表） | `deleteLineageInTransaction`、权限矩阵文档、权限测试 |
| 前端命令集 | 新增节点命令表（常量） | 代码内常量（非表） | 底部快捷条、右键菜单 |

明确**不做**的：不加 `node.birth_place`（出生地设计本轮删除）、不建出生地/事件读写层、不加 `node.attributes`（该列已在迁移 `0010_redundant_iron_man.sql` 删除）、不改 `family_child`、不加索引。

## 2. 节点命令表（`components/lineage/node-commands.ts`，常量而非表）

| id | 文案 | 启用条件 | 所需权限 | 动作 |
|---|---|---|---|---|
| `add-child` | 加子女 | 血亲（`node.role === 'blood'`；配偶不能当父级） | `lineage.write` | 打开添加子女弹窗（既有 `openCreate('child')`） |
| `add-sibling` | 加兄弟 | 非始祖（`node.parentId != null`） | `lineage.write` | 打开添加兄弟弹窗 |
| `add-spouse` | 加配偶 | 血亲（`node.role === 'blood'`） | `lineage.write` | 打开添加配偶弹窗 |
| `move` | 移动 | 非始祖 | `lineage.write` | 打开既有 `node-move-dialog` |
| `delete` | 删除 | 非始祖（血亲与配偶都可删） | `lineage.write` | 二次确认 → `deleteNodeAction` |

- 无 `lineage.write` 时**整条命令表不渲染**（底部条与右键菜单都不出现），与既有 `canWrite` 判断一致。
- 「查看档案」不在表内：选中节点即打开抽屉，该命令被选中动作吸收。
- 命令表是唯一真相；底部条与右键菜单只是两种画法，禁止各自维护条件。

## 3. 权限枚举变更

`lib/auth/access-control.ts`：

| 位置 | 变更 |
|---|---|
| `statement.lineage` | `['write']` → `['write', 'delete']` |
| `roles.owner.lineage` / `roles.admin.lineage` | 加 `'delete'` |
| `roles.editor.lineage` | 保持 `['write']`（**不能删谱系**） |
| `roles.viewer` | 不变（无 lineage 权限） |
| `ORG_PERMISSIONS` | 加 `'lineage.delete'` |
| `PERMISSION_REQUESTS` | `'lineage.delete': { lineage: ['delete'] }` |
| `PERMISSION_DENIED_MESSAGES` | `'lineage.delete': '只有所有者或管理员可以删除谱系'` |

`lib/lineage/services.ts:deleteLineageInTransaction` 的 `withOrgWrite(userId, orgId, 'lineage.write', …)` 改为 `'lineage.delete'`；人丁级写（`withLineageWrite`）与删除人丁的权限**不变**（编辑者仍可删人丁）。

## 4. 不变的部分（防止顺手改坏）

- `node` 表结构、`path` ltree 世系路径、`generation` 推导规则：不变。
- 删除人丁的服务端集合（血亲子树 + 其配偶）：不变；只改前端确认文案与计数口径。
- 事实层回填 `lib/db/backfill/fact-layer-rules.ts`：**不动**（没有新字段要映射）。
- `node_count` 维护、活动日志写入：不变。

## 5. 需要同步的文档

| 文档 | 同步点 |
|---|---|
| `docs/architecture/11-需求与实现状态.md` | 权限矩阵：删除谱系与删除内容分行，`admin` 含 `lineage.delete`（`owner` 是 `['*']`，`editor` 不含）。2026-11-03 起，抽屉、底部条 + 右键、`lineage.delete` 已计入交付；状态只写该文件 |
| `docs/architecture/04-数据视图-数据架构.md` | **不动**（无表结构变更） |
