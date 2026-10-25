# 创建谱系（新建谱系）功能设计

> **状态**：待人类伙伴确认 · 2026-10-25
> **范围**：短版设计（一次范围明确的功能改造，不是新模块）
> **相关**：`docs/prd.md` FR-LIN-1 · `docs/data-model.md` §6.1 · `docs/implementation-status.md` §3.4

## 1. 意图与理由

云谱空间（`project`）定义「谁家」：主题名、姓氏、地区在创建项目时确定。谱系（`lineage`）定义「这一支」：一个项目下可以有多本谱系分册。

所以创建谱系时，**主题名与姓氏继承自项目，不在这一层改动**；编修者只需要决定三件事——这本谱系叫什么、归到哪个分类、覆盖哪个地区——再可选填郡望堂号与备注，然后**直接进入录入始祖**。

这次改造的原因是：现有「新建谱系」弹窗把姓氏做成可编辑（与项目姓氏不一致就能造出矛盾数据）、没有地区与备注、名称上限 100 字、提交后停在空画布还要用户自己找「录入始祖」。截图规格把这套心智定清楚了，本文按它重排。

## 2. 目标 / 非目标 / 反目标

**目标**

- 字段、必填关系、占位文案、只读态与截图一致。
- 名称 ≤ 24 字；所属分类、地区必填；地区默认带出项目地区。
- 主题名、姓氏只读，旁边提供「修改所属项目基本信息」入口。
- 创建成功后进入画布并能一眼看到「录入始祖」。
- 同一套字段规则贯穿**创建**与**编辑**。

**非目标**

- 地区做省市级联选择（继续自由文本，示例文案「中国/北京/东城」只作占位）。
- 在创建弹窗里内联编辑项目信息。
- 跨谱系关联（联宗）、谱书编目接入、人丁自定义字段。

**反目标**

- 出现「技术上做完了但用户卡死」的路径：例如项目一个分类都没有时，创建弹窗无法完成。
- 创建与编辑两处规则不一致（一处能改姓氏、一处不能）。

## 3. 已定决策（人类伙伴已确认）

1. **字辈移出创建弹窗**，只在「编辑谱系」里维护。理由：字辈是长篇结构化数据（最多 40 字），混在 7 字段表单里打断「快速开一本」的节奏；`updateLineageSchema` 已支持该字段。
2. **「所属分类」指谱系分类树（`folder.kind = 0`）**，创建时必填。
3. **地区为自由文本**，默认值取 `project.countries_regions`。

## 4. 字段规格

| 顺序 | 字段 | 控件 | 必填 | 数据来源 | 服务端校验 | 备注 |
|---|---|---|---|---|---|---|
| 1 | 谱系名称 | 单行文本 | 是 | 用户输入 | 1–24 字；项目内唯一（`uk_lineage_name`） | 占位「请输入谱系名称，限长24个字」；实时计数 `n/24` |
| 2 | 所属分类 | 下拉（三级缩进） | 是 | 项目谱系分类树 | 必须存在、属于本项目、`kind=0`、未软删 | 默认选中第一个；空树时提供「+ 新建分类」 |
| 3 | 主题名 | 只读文本 | —（见 §5） | `project.theme_name` | 不接收该字段 | 灰色禁用态 +「项目信息」标签 |
| 4 | 姓氏 | 只读文本 | —（见 §5） | `project.surname` | 不接收该字段；写库取项目值 | 同上 |
| 5 | 地区 | 单行文本 | 是 | 用户输入（默认项目地区） | 1–100 字 | 占位「例如：中国/北京/东城」 |
| 6 | 郡望堂号 | 单行文本 | 否 | 用户输入 | ≤ 60 字 | 占位「请输入郡望堂号」 |
| 7 | 备注 | 多行文本 | 否 | 用户输入 | ≤ 500 字 | 占位「请输入谱系备注」 |

底部操作区：左「取消」（`outline`），右「确定」（`brand`）。

## 5. 关于截图里「必填却只读」的矛盾

截图给主题名与姓氏打了红色星号（必填），但两者是只读的。它们靠项目已有值保证非空，星号只会让用户以为自己漏填了东西。

**决定（构建者的判断，人类伙伴可在评审时推翻）**：去掉这两个星号，改标「项目信息」小标签；字段语义仍是「不可为空的继承值」。

## 6. 交互流程

**入口**（三处共用同一弹窗组件）

- 谱系列表页「新建谱系」按钮。
- 左侧谱系管理侧栏的「+」。
- 文件夹行内「在此文件夹下新建谱系」——预选该文件夹。

**默认值**

- 分类：行内入口预选该文件夹；否则选第一个分类；无分类则选中「+ 新建分类」。
- 地区：`project.countries_regions ?? ''`。
- 名称：空（**不做自动生成**，避免与用户预期不符）。

**校验**

- 客户端：名称、分类、地区任一为空（含纯空白）时「确定」置灰；名称超 24 字即时提示。
- 服务端：Zod 权威校验，任何客户端绕过都返回中文字段错误。

**「修改所属项目基本信息」**

- 有 `project.write`：点击后跳 `/dashboard/project/[projectRef]/settings`（弹窗先关闭）。
- 无 `project.write`：按钮置灰，`title` 与无障碍描述为「只有所有者或管理员可以修改项目基本信息」。
- 已接受的现实：项目的 `surname` / `theme_name` **创建后不可修改**，所以这个入口主要价值是「去看一眼并确认」。不在本期为项目设置页新增编辑能力。

**关闭与草稿**

- X、Esc、点遮罩、取消：有内容时二次确认「放弃已填内容？」，空内容直接关。
- 统一改用 `components/ui/dialog.tsx` 的 `Dialog`（Radix），替换现有 `createPortal` 手写弹窗，一次性获得焦点管理与 Esc 行为。

**落点**

- 创建成功 → 跳转 `/dashboard/project/[ref]/lineages/[id]`，空谱系页已有「录入始祖」空态卡片。
- 本期在该页加**一次性自动弹出**「录入始祖」：仅在 `nodeCount === 0` 时触发，用内存标记防重复，不写在 URL 上（URL 里没有 `?new=1` 这类伪装成可分享状态的标记）。

## 7. 数据变更

`lineage` 表新增两列：

```sql
ALTER TABLE lineage ADD COLUMN region text;
ALTER TABLE lineage ADD COLUMN notes  text;
```

- 两列**均可空**：历史谱系没有地区与备注，设为 `NOT NULL` 会让已有数据迁移失败，也会让空库迁移与漂移检查出现不一致。
- 长度上限在 Zod 层（region ≤ 100、notes ≤ 500），不加 `CHECK`，与 `project.countries_regions` / `notes` 现有做法一致。
- 迁移由 `pnpm db:generate` 生成（预计 `0007_*.sql`），人工 review 后单独提交；不新增索引、不改 RLS、不改复合外键。
- `folder_id` **在库里保持可空**（历史「未分类」谱系仍可存在），「必填」只是创建契约。

## 8. 服务端契约

`lib/genealogy/schemas.ts` → `createLineageSchema`

- `name`：1–24 字（新常量 `MAX_LINEAGE_NAME_LENGTH = 24`，放在 `lib/lineage/constants.ts`，与 `lib/project/constants.ts` 对称）。
- `folderId`：由 `optionalUuid` 改为**必填 UUID**（「请选择分类」）。
- `region`：必填文本，≤ 100 字。
- `notes`：可选文本，≤ 500 字。
- **删除 `surname`**：客户端传了也不读，避免伪造。

`updateLineageSchema`（用于编辑谱系）

- 新增 `region`（可清空）、`notes`（可清空）两个可空字段。
- **删除 `surname`**：姓氏不可变，编辑弹窗改为只读展示，与创建规则一致。

`lib/lineage/services.ts` → `createLineageInTransaction`

- 在事务内读取项目行，取 `surname`、`countriesRegions` 作为姓氏来源；项目姓氏为空时返回新失败原因 `project_surname_missing`，Action 映射为「项目未填写姓氏，请先完善项目基本信息」。
- 写入 `region`、`notes`。
- 参数签名去掉 `surname` 入参，避免上层再传。

`lib/lineage/actions.ts`

- `createLineageAction` 不再传 `surname`；新增错误文案映射。
- `updateLineageAction` 不再读 `data.surname`，新增 `region` / `notes` 白名单。

## 9. 连带改动清单

| 位置 | 改动 |
|---|---|
| `components/lineage/create-lineage-dialog.tsx` | 按 §4 重写；保留同名导出，改为 Radix `Dialog`；删除字辈字段 |
| `components/lineage/lineage-edit-dialog.tsx` | 姓氏只读；新增地区、备注 |
| `components/lineage/lineage-workspace.tsx` | 列表卡片展示地区；类型加 `region` / `notes` |
| `app/(dashboard)/.../lineages/page.tsx` | 透传 `region`、`notes`、`projectThemeName`、`projectCountriesRegions`、`canProjectWrite` |
| `components/lineage/lineage-sidebar.tsx` | 透传同样的 props 给弹窗 |
| `components/lineage/lineage-tree.ts` | 搜索匹配纳入 `region`（`notes` 不参与，避免长文本噪声） |
| `components/lineage/lineage-detail.tsx` | 空谱系一次性自动打开「录入始祖」 |
| `components/lineage/lineage-shell.tsx` / `layout.tsx` | 如侧栏需要新 props，一并透传 |
| `tests/lineage-schemas.test.ts` | 新增 `createLineageSchema` 用例（24/25 字、分类必填、地区必填、surname 被剥离） |
| `tests/integration/folders-lineages.test.ts` | 补：地区/备注落库、姓氏继承项目、项目无姓氏时失败、编辑不含姓氏 |
| `tests/e2e/critical-path.spec.ts` | 更新选择器与文案（`#lineage-surname` 消失），补地区填写 |
| `docs/implementation-status.md` | `FR-LIN-1` 行为更新 |

## 10. 约束

- 组织级读写仍走 `withOrg` / `app_rw`；不碰 `auth.*`。
- 面向用户文案全部简体中文；数据库/日志保持英文。
- 不新增裸色值（`tests/design-system.test.ts`）；沿用 `button.tsx` 的 `brand` 变体。
- 迁移与业务代码分开提交。
- 每次提交前 `pnpm check && pnpm typecheck && pnpm test` 全绿。

## 11. 验收标准

- [ ] 弹窗字段顺序、必填标记、占位文案与 §4 一致。
- [ ] 名称 24 字可提交、25 字前后端都拒绝。
- [ ] 分类、地区为空时「确定」禁用，服务端也拒绝。
- [ ] 项目无分类时可在弹窗内新建分类并继续创建，不出现死路。
- [ ] 姓氏/主题名在 UI 不可编辑；伪造 `surname` 表单字段不影响落库值。
- [ ] 无 `project.write` 的用户得到中文权限提示，而非越权失败。
- [ ] 编辑谱系能改地区与备注，不能改姓氏。
- [ ] 历史谱系（无地区/备注/未分类）在列表、画布、世系表、打印视图均正常。
- [ ] 创建成功后进入画布，「录入始祖」自动弹出且只弹一次。
- [ ] `pnpm check && pnpm typecheck && pnpm test` 全绿；`test:integration`、`test:e2e` 同步通过。

## 12. 考虑过但没选的做法

| 做法 | 为什么放弃 |
|---|---|
| 地区做省市区级联 | 需要引入行政区划数据与组件，是独立规模的工作；项目地区本来就是自由文本，两边规则要一致 |
| 弹窗内嵌套编辑主题名/姓氏 | 与「创建后不可修改」的规则直接冲突，用户改完也会被拒绝 |
| 用 `?new=1` 触发自动录入始祖 | 把一次性 UI 状态写进可分享 URL，刷新或转发都会重复触发 |
| 用 sessionStorage 保存创建草稿 | 为一次五分钟内就能重填的表单增加状态机与过期清理，复杂度不值 |
| 分类允许留空（保持现状） | 截图明确必填；但库里保持可空以兼容历史数据 |
| 字辈留在创建弹窗（折叠区） | 人类伙伴已选 A 方案，且编辑弹窗已能维护 |

## 13. 留给构建者决定的部分

- 具体组件拆分（是否把只读字段抽成 `components/lineage/readonly-project-field.tsx`）。
- 「+ 新建分类」在下拉里以何种形态出现（下拉项 / 旁边小按钮），以及创建后的聚焦行为。
- 名称计数、错误文案的具体排版。
- 二次确认「放弃已填内容？」用 `confirm` 还是自绘确认层——**倾向自绘**，`confirm` 在部分浏览器里样式突兀且不可测。
