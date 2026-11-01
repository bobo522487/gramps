# Implementation Plan: 谱系录编与实时预览

**Branch**: `001-lineage-edit-preview`（仅规格目录名，不创建 git 分支） | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: `/specs/001-lineage-edit-preview/spec.md`（6 轮澄清后 30 条 FR / 4 个用户故事 / 8 条 SC）

**Note**: 本文件是 `/speckit-plan` 的设计记录。按 `.specify/memory/constitution.md` §2，**执行计划只在 `docs/superpowers/plans/` 维护一份**；`/speckit-tasks` 的产物落地时合并进那份计划，不并行两套清单。

## Summary

澄清后的增量是**四处改动，全部是「删旧换新」，没有一处需要动数据库**：

1. **信息卡改成抽屉**（FR-012/FR-014）：未选中不显示，选中后从右侧滑出。用仓库已有的 `components/ui/sheet.tsx`（Radix Dialog），不引入新依赖；同时删掉 `person-inspector.tsx` 的 `EmptyInspector`（「未选择族人」占位）与整条「拖拽调宽」逻辑（`hooks/use-resizable.ts` 的 inspector 用法）——抽屉是覆盖层，调宽没有意义。
2. **操作入口从「卡片菜单」搬到「选中态」**（FR-028/029/030）：删掉 `lineage-detail.tsx` 的 `NodeActions` 下拉菜单（85 行），改为**一份命令表 + 两个渲染器**——底部快捷按钮条与右键菜单，命令集相同（加子女 / 加兄弟 / 加配偶 / 移动 / 删除）。
3. **删除确认说全**（FR-018 / SC-004）：集合已经对（`subtreeIds` 已归并配偶，与服务端一致），缺的只是**措辞**——弹窗不说配偶会一起归档。抽成 `lib/lineage/subtree.ts` 的纯函数以便单测钉住「集合与措辞一致」，逻辑不改。
4. **删除谱系收紧为仅所有者/管理员**（FR-003 / SC-005）：新增权限串 `lineage.delete`，`deleteLineageInTransaction` 改判新串。

**不做**：出生地（上一版设计，本轮删除）、表结构变更（0 列）、导出导入、房支、撤销、结构编辑、快捷键。

## Technical Context

**Language/Version**: TypeScript 7.0.2（strict + 4 条额外检查）· React 19.3.1 · Next.js 16.4.3 App Router · Node.js 24 LTS

**Primary Dependencies**: 既有 UI 基元（`components/ui/sheet.tsx`、`dropdown-menu.tsx`、`button.tsx`）、Zod、Drizzle ORM、TanStack Query 5、Better Auth access-control（权限串）。**不新增 npm 依赖**。

**Storage**: PostgreSQL 18。**本期零 schema 变更、零迁移**；只改代码内的权限枚举。

**Testing**: Vitest 单测 + 真实 PostgreSQL 集成测试 + Playwright E2E（交互形态变了，补一条「选中→底部条→弹窗」的 E2E）

**Target Platform**: Web 控制台（桌面优先；窄屏抽屉覆盖画布）

**Project Type**: Next.js 单体（Server Components + Server Actions，无独立后端）

**Performance Goals**: 保存后画布与抽屉 ≤200ms 更新（SC-002）；1000 人丁 ≥45fps（SC-003）；抽屉开合不触发画布重排或缩放跳变

**Constraints**: 单文件 ≤400 行（`pnpm arch:check`，豁免只许缩）；不写裸色值；提交前 `pnpm check && pnpm typecheck && pnpm test` 全绿

**Scale/Scope**: 单谱系 1000 人丁可用、5000 为目标上限；本期改动 4 处行为 + 3 个新文件 + 1 个权限串 + 1 份文档同步（`docs/prd.md` 权限矩阵）

**既有测试影响**: 已 grep 确认 `tests/` 中**没有**断言被移除的 UI（`人丁操作` / `未选择族人` / `查看档案` 均 0 命中），所以本期不需要改写既有测试；只需为两条新入口补 1 条 E2E 与 2 个单测。

## Constitution Check

*GATE: 设计前与设计后各评估一次。原则正文见 `AGENTS.md`（本仓库唯一来源）。*

| 门 | 判定 | 依据 |
|---|---|---|
| 组织隔离：查询带 `orgId` 且经 `withOrg` | PASS | 不新增查询入口，只改 UI 形态与权限串 |
| 软删除语义 | PASS | 不改删除语义；确认弹窗数字与服务端集合对齐 |
| 多步写单事务 | PASS | 不改事务边界 |
| 权限用权限串，禁止直接比较角色 | PASS | 新增 `lineage.delete` 串并走 `withOrgWrite` |
| 禁止清单：不新增表 / 不加后台任务 / 不用裸色值 | PASS | 零迁移；抽屉用既有 Sheet 基元 |
| F6 行数棘轮（豁免只许缩） | PASS（靠**删代码**腾空间） | `lineage-detail.tsx` 865/865、`person-inspector.tsx` 606/606 都顶格；本期各删 85 / 40 行左右，净变小 |
| 迁移与业务代码分开提交 | PASS | 本期无迁移 |
| 文档同步（权限矩阵） | PASS | `docs/prd.md` §3.2/§3.3（CRLF，按字节回写）；表结构未变故 `docs/data-model.md` 不动 |

设计后复核：同上，无新增违例；`pnpm arch:check`、`pnpm docs:check --strict` 为完成判据。

## Project Structure

### Documentation (this feature)

```text
specs/001-lineage-edit-preview/
├── spec.md              # 需求（30 FR / 4 故事 / 8 SC）
├── source-prd.md        # 用户提供的权威 PRD 原件（只读留档）
├── plan.md              # 本文件
├── research.md          # Phase 0：8 个决策与放弃的方案
├── data-model.md        # Phase 1：零表结构变更 + 权限枚举变更
├── contracts/
│   └── actions-and-permissions.md  # Phase 1：命令表契约 + 权限矩阵 + 错误码
├── quickstart.md        # Phase 1：可执行验证剧本
├── checklists/
│   └── requirements.md  # 规格质量清单
└── tasks.md             # /speckit-tasks 产出（本命令不创建）
```

### Source Code (repository root)

```text
components/lineage/
├── node-commands.ts          # 【新增】节点命令表：id / 文案 / 图标 / 启用条件 / 所需权限
├── node-action-bar.tsx       # 【新增】底部快捷按钮条（选中态出现，含当前人丁身份提示）
├── node-context-menu.tsx     # 【新增】右键菜单（与上者共用 node-commands）
├── person-inspector.tsx      # 改为抽屉内容：删 EmptyInspector 与调宽逻辑，去掉 onResizeStart/isResizing
├── lineage-detail.tsx        # 删 NodeActions 下拉菜单；抽屉用 Sheet 承载；确认文案含配偶
└── canvas/
    ├── genealogy-canvas.tsx  # 透传 onContextMenu（右键定位到节点）与底部条所需回调
    └── nodes/book-person-node.tsx  # 节点卡片：移除操作按钮，保留选中与拖拽

lib/
├── lineage/subtree.ts        # 【新增】collectSubtreeIds（血亲 + 其配偶），从 lineage-detail 抽出
├── lineage/services.ts       # deleteLineageInTransaction：权限串换 lineage.delete
└── auth/
    ├── access-control.ts     # + lineage.delete（statement/roles/ORG_PERMISSIONS/PERMISSION_REQUESTS）
    └── permissions.ts        # + PERMISSION_DENIED_MESSAGES['lineage.delete']

tests/
├── lineage-subtree.test.ts   # 【新增】子树收集含配偶
├── node-commands.test.ts     # 【新增】命令启用条件（始祖禁用三项、无写权限全禁用）
├── permissions.test.ts       # + lineage.delete 矩阵
├── access-control.test.ts    # + lineage.delete 请求映射
└── e2e/lineage-*.spec.ts     # + 选中→底部条→弹窗；未选中时右侧无面板
```

**Structure Decision**: 沿用仓库现状（`app/` + `components/` + `lib/` + `hooks/` + `tests/`）。三个新文件都是**薄壳**：`node-commands.ts` 是纯常量表（无 React），两个渲染器只是它的两种画法；`subtree.ts` 是纯函数。这样「命令集只写一次」，避免底部条与右键菜单各自漂移。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 抽屉替换常驻面板（删掉 `useResizable` 的 inspector 用法） | 未选中时右侧不该占位；抽屉是覆盖层，拖拽调宽随之失去意义 | 保留常驻面板 + 折叠：仍会在未选中时留下一条可见的空槽，与 FR-012 冲突 |
| 一份命令表两个渲染器 | 底部条与右键菜单若各写一套，加一个命令要改两处、启用条件会漂移 | 只做右键菜单：移动端没有右键，等于把核心操作藏起来；只做底部条：与参考产品的「右键即菜单」直觉不符，且画布上更快的路径是原地右键 |
| 三个新文件（`node-commands.ts` / `node-action-bar.tsx` / `node-context-menu.tsx`） | `lineage-detail.tsx` 顶在 865/865，任何新增都会触发 `arch:check` 失败；抽出去的同时净减少行数 | 全部塞进 `lineage-detail.tsx`：立刻超 400 行棘轮，且该文件已经在做布局、渲染、交互三件事 |
