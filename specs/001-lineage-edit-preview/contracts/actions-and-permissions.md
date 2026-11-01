# Phase 1 · 接口契约（交互命令 + Server Action + 权限矩阵）

> 本仓库的写入一律是 Server Action（返回 `ActionState`），没有对外 REST API 承载这些操作。本期**不新增 Action**，只改两个既有 Action 的权限/文案口径，并新增一套纯前端的命令表契约。

## 1. 节点命令表（`components/lineage/node-commands.ts`）

| 项 | 契约 |
|---|---|
| 导出 | `NODE_COMMANDS: readonly NodeCommand[]` + `enabledCommands(node, canWrite)` |
| 形状 | `{ id: 'add-child' \| 'add-sibling' \| 'add-spouse' \| 'move' \| 'delete'; label: string; icon: LucideIcon; isEnabled(node): boolean; isDestructive?: boolean }` |
| 触发面 | 底部快捷按钮条（`node-action-bar.tsx`）、节点右键菜单（`node-context-menu.tsx`） |
| 渲染前置 | `canWrite === false` 时两处都**不渲染**（不是渲染成禁用） |
| 始祖 | `add-sibling` / `move` / `delete` 三项禁用（`parentId == null`） |
| 身份提示 | 底部条显示「当前选中：<谱名> · 第 N 代」，随选中变化 |

## 2. 信息卡抽屉（`components/lineage/person-inspector.tsx`）

| 项 | 契约 |
|---|---|
| 打开条件 | `selectedNodeId != null` 才挂载 `Sheet`；否则不渲染任何右侧内容（无空占位） |
| 关闭 | 抽屉关闭按钮 / `Esc` / 关闭后 `setSelectedNode(null)` |
| 打开期间 | 画布仍可选中其他人丁，抽屉内容切换（不关闭重开） |
| 宽度 | 固定宽度（约 420px），**不再支持拖拽调宽**；`onResizeStart` / `isResizing` / `width` 三个 props 移除 |
| 写权限 | `canWrite === false` 时字段只读、保存按钮不出现（沿用既有行为） |

## 3. `deleteNodeAction` —— 契约不变，客户端确认口径要对齐

| 项 | 契约 |
|---|---|
| 入参 | `{ orgId, lineageId, nodeId }`（不变） |
| 服务端实际删除集合 | 该节点 + `path <@ target.path` 的血亲子树 + 这些血亲的全部配偶（`node-services.ts:583`，不变） |
| 成功 | `{ success: '已删除该人丁及其子孙，共 N 位' }`（不变） |
| 失败 | `root_forbidden` / `not_found` / `forbidden` |
| **客户端变更** | 仅改文案：「删除「X」及其子孙与配偶？共 N 位人丁会归档。」。N 的算法**不变**（`collectSubtreeIds` 抽到 `lib/lineage/subtree.ts` 后逻辑等价，已有配偶归并），本次抽出只为可单测 |

## 4. `deleteLineageAction` —— 权限收紧

| 项 | 变更前 | 变更后 |
|---|---|---|
| 权限串 | `lineage.write` | **`lineage.delete`** |
| 编辑者 | 可删 | **不可删**（`forbidden` → 「只有所有者或管理员可以删除谱系」） |
| 所有者 / 管理员 | 可删 | 可删（不变） |
| 入参 / 返回值 | 不变 | 不变 |
| 附带拦截 | 被谱书编目引用时 `referenced` | 不变 |

## 5. 权限矩阵（变更后全量）

| 权限串 | 所有者 | 管理员 | 编辑者 | 查看者 |
|---|---|---|---|---|
| `content.read` | ✅ | ✅ | ✅ | ✅ |
| `lineage.write`（建/改谱系与人丁、改档案、删人丁） | ✅ | ✅ | ✅ | — |
| **`lineage.delete`（删除谱系）** | **✅** | **✅** | **—** | **—** |
| `article.write` / `book.write` | ✅ | ✅ | ✅ | — |
| `project.write` | ✅ | ✅ | — | — |
| `member.invite` / `member.manage` | ✅ | ✅ | — | — |
| `org.settings` / `org.transfer` | ✅ | — | — | — |

## 6. 错误码

| 场景 | 返回 | 用户可见文案 |
|---|---|---|
| 非成员 / 无该权限 | `forbidden` | 见 `PERMISSION_DENIED_MESSAGES`，不泄露资源是否存在 |
| 谱系或人丁不存在（含跨组织） | `not_found` | 「谱系不存在」/「人丁不存在」 |
| 删除始祖 | `root_forbidden` | 「始祖不可删除，请删除整个谱系」 |
| 谱系被编目引用 | `referenced` | 既有文案，本期不改 |
