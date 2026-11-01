# Phase 0 · 研究记录

> 只记录**会改变实现形状**的 8 个决策，每个都给「放弃的方案」与理由。无遗留 NEEDS CLARIFICATION。

## R1 · 信息卡用什么形态

- **Decision**: 用既有 `components/ui/sheet.tsx`（Radix Dialog 封装）做右侧抽屉；未选中节点时不渲染任何东西；抽屉宽度固定，删除调宽逻辑。
- **Rationale**: 仓库已有 Sheet 基元（`components/ui/sheet.tsx`，`SheetContent` 支持 `side`），零新依赖。抽屉是覆盖层，画布不必为它让出宽度，因此「拖拽调宽」（`hooks/use-resizable.ts` 在 `lineage-detail.tsx:368` 的用法）失去意义——一并删掉，顺手减 40 行。
- **Alternatives considered**: ① 保留常驻面板、未选中时折叠成窄条：仍占位，与「未选中不显示」冲突；② 自写一个抽屉：重复造 Radix 已有的焦点陷阱与 Esc 关闭。

## R2 · 操作入口怎么组织

- **Decision**: 新增 `components/lineage/node-commands.ts` 作为**唯一命令表**（id、文案、图标、启用条件、所需权限），底部快捷条与右键菜单各写一个薄渲染器共用它。
- **Rationale**: 命令集只有 5 项（加子女/加兄弟/加配偶/移动/删除），但每项都带「始祖禁用」「无写权限隐藏」两条条件。写两套逻辑必然漂移；写成数据表则一处定义、两处画。
- **Alternatives considered**: 把两处渲染合进一个组件用 `variant` 切换——两者容器语义差别大（固定底栏 vs 浮层定位），合并后分支比分开更绕。

## R3 · 删掉卡片菜单后，「查看档案」与「移动」去哪

- **Decision**: 「查看档案」取消——选中节点即打开抽屉，该命令的语义被选中动作吸收；「移动」保留，进入命令表（底部条与右键菜单都有）。删除同理保留，但始祖禁用。
- **Rationale**: 删一个入口的前提是它的能力有着落。若不搬「移动」，用户将失去纠正父辈关系的手段，而规格明确本期不提供其他改结构入口（Clarifications 第 6 条）。
- **Alternatives considered**: 把「移动」只放右键菜单——移动端会丢；只放底部条——画布上原地右键更符合直觉，且两条路径成本几乎相同。

## R4 · 出生地为什么删掉

- **Decision**: 不录出生地，`node` 不加列，本期**零 schema 变更**。
- **Rationale**: 用户本轮明确要求去掉。它原本是上一版唯一的表结构变更与事实层映射改动（`birth_place` + `planEvents` 的 birth 地点映射），删掉之后本期没有任何迁移，风险与工期都显著下降。
- **Alternatives considered**: 保留列但不在 UI 暴露——「为以后留一列」是典型的过早设计，且会立刻带来「这列谁维护」的问题。

## R5 · 删除确认怎么改（事实更正）

- **Decision**: 只改**文案**：`删除「X」及其子孙与配偶？共 N 位人丁会归档。`；同时把 `lineage-detail.tsx:90` 的 `subtreeIds` 抽到 `lib/lineage/subtree.ts`（改名 `collectSubtreeIds`）以便单测与腾行数，**逻辑不改**。
- **Rationale（含事实更正）**: 先前记录说「前端只数血亲、人数少算」——**这是错的**。`subtreeIds` 在血亲广度遍历之后还有一段配偶归并（`lineage-detail.tsx:109-119`：`role === 'spouse' && ids.has(spouseOfId)`），与服务端 `deleteNodeInTransaction`（`node-services.ts:583-641`）的「血亲子树 + 这些血亲的配偶」集合一致。**真正缺的只有措辞**：数字对，但没告诉用户配偶也会一起归档。抽出纯函数是为了让「集合与措辞一致」这条能被单测钉住。
- **Alternatives considered**: 服务端 dry-run 计数——多一次往返，且 dry-run 与实际删除之间仍有竞态；现有纯前端集合已与服务端一致，不必引入。

## R6 · 「编辑者不能删谱系」怎么落地

- **Decision**: 新增权限串 `lineage.delete`（owner/admin 有，editor/viewer 无），`deleteLineageInTransaction` 的 `withOrgWrite(..., 'lineage.write')` 改为 `'lineage.delete'`。
- **Rationale**: 仓库权限判断一律走 `hasPermission(role, '<permission>')`（`AGENTS.md` §5.2 禁止直接比较角色）。加一个串是既有机制的正常用法，权限矩阵文档、测试、UI 的 `canWrite` 都能复用同一套词汇。
- **Alternatives considered**: ① 在 Action 里比较角色——违反仓库约定，且造成权限矩阵与代码两处真相；② 新增角色——为一条规则造一个角色，权限矩阵立刻膨胀；③ 只隐藏按钮——`AGENTS.md` §8 明列越权风险。

## R7 · 400 行棘轮怎么过

- **Decision**: 靠**删代码**腾空间，而不是加抽取层：`lineage-detail.tsx` 删 `NodeActions`（约 85 行）与 inspector 调宽接线（约 10 行）；`person-inspector.tsx` 删 `EmptyInspector`（约 15 行）与调宽参数（约 8 行）。新增的 3 个文件都是小文件（命令表 ~60 行、两个渲染器各 ~70 行）。
- **Rationale**: 上一版计划要靠三次「只搬不改」的抽取才敢加字段；本轮改动本身就是「删旧换新」，净行数是下降的，棘轮自然通过。
- **Alternatives considered**: 提前抽 `person-life-fields.tsx`——没有新增字段需求，抽了就是为抽象而抽象。

## R8 · 右键菜单的可发现性与可达性

- **Decision**: 右键菜单只在**选中节点后**、在节点上触发时弹出（右键未选中的节点会先选中它）；底部快捷条始终随选中态出现，作为右键的等价兜底；画布空白处右键保持浏览器默认行为，不接管。
- **Rationale**: 触屏与部分触控板没有右键；若只做右键，核心操作在平板上不可达。底部条同时充当「当前选中是谁」的提示（FR-030），解决抽屉遮挡时的误操作。
- **Alternatives considered**: 全局拦截 `contextmenu` 做画布菜单——会抢掉浏览器/辅助功能的默认菜单，属于可访问性倒退。
