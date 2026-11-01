# Phase 1 · 验证剧本（quickstart）

> 目的：用最短路径证明四处改动真的生效。契约见 [contracts/actions-and-permissions.md](./contracts/actions-and-permissions.md)，命令表见 [data-model.md](./data-model.md) §2。

## 前置

```bash
cd /home/bobo/project/gramps
pnpm db:setup                    # 本地 PostgreSQL + 迁移（本期无新迁移）
pnpm dev                         # http://localhost:3000
```

## 1. 静态门（每次提交前，必须全绿）

```bash
pnpm check && pnpm typecheck && pnpm test
pnpm arch:check                  # F6：两个被瘦身的文件必须变小
pnpm docs:check --strict
```

**期望**：全部 0 issue。`arch:check` 里 `lineage-detail.tsx` < 865、`person-inspector.tsx` < 606（棘轮只许缩）。

## 2. 抽屉（FR-012 / FR-014 / SC-008）

```bash
pnpm test -- lineage-view-types
```

**手工路径**：

1. 进入任一谱系，**不选中任何节点** → 右侧**完全空白**，没有「未选择族人」占位，画布占满宽度。
2. 点任一节点 → 右侧抽屉滑出，显示该人丁档案；**不刷新**即可编辑保存。
3. 按 `Esc` → 抽屉关闭，画布恢复全宽，右侧仍无占位。
4. 抽屉打开时点画布上另一个节点 → 抽屉内容切换，不闪退、不重开。
5. 抽屉打开时缩放/拖动画布 → 无跳变（抽屉是覆盖层，不挤压画布）。

## 3. 操作入口（FR-028 / FR-029 / FR-030 / SC-008）

```bash
pnpm test -- node-commands
pnpm test:e2e -- lineage
```

**手工路径**：

1. 选中一个人丁 → **底部出现快捷按钮条**，显示「当前选中：<谱名> · 第 N 代」，按钮为 加子女 / 加兄弟 / 加配偶 / 移动 / 删除。
2. 点「加子女」→ 弹出既有添加弹窗（2 步内到达）。
3. 在同一节点上**右键** → 弹出菜单，命令集与底部条**完全一致**。
4. 选中**始祖** → 「加兄弟」「移动」「删除」三项禁用（灰掉而非消失）。
5. **节点卡片上不应再有「⋯」操作按钮**（旧的 查看档案/加子女/加兄弟/加配偶/移动/删除 下拉菜单已移除）。
6. 用 `viewer` 账号 → 底部条与右键菜单**都不出现**；直接调 Action 也被服务端拒绝。
7. 平板/触屏（或用 DevTools 模拟）→ 底部条可用（右键不可用时仍有完整路径）。

## 4. 删除确认说实话（FR-018 / SC-004）

```bash
pnpm test -- lineage-subtree
```

**手工路径**：选一位有 2 个子女、其中 1 个子女有配偶的人丁 → 点「删除」。

**期望**：弹窗为「删除「X」及其子孙与配偶？共 N 位人丁会归档。」，**N = 血亲 3 + 配偶 1 = 4**（计数算法本来就对，本次只补措辞）；确认后谱系总人数下降 4。

## 5. 编辑者不能删谱系（FR-003 / SC-005）

```bash
pnpm test -- permissions access-control
pnpm test:integration -- lineages
```

**手工路径**：

1. `editor` 账号 → 谱系列表里删除入口不可用。
2. 集成测试直接调 `deleteLineageAction` → `forbidden` + 「只有所有者或管理员可以删除谱系」。
3. `admin` 账号 → 删除正常，仍弹「共 N 位人丁会归档」。

## 6. 回归检查（不该变的东西）

```bash
pnpm test:coverage
pnpm test:e2e
```

**期望**：既有录入 E2E 全绿；`design-system.test.ts` 无裸色值；添加子女/兄弟/配偶弹窗行为不变；删除人丁的权限对编辑者**仍然可用**（只有删谱系被收紧）。

## 7. 文档同步检查

```bash
git diff --stat docs/
```

**期望**：只 `docs/prd.md`（权限矩阵 1 行拆分 + `ROLE_PERMISSIONS` 1 行）。**该文件是 CRLF**：脚本改写后必须 `data.replace(b"\n", b"\r\n")` 写回，否则整文件重写。
