# Implementation Plan: 谱文录入与多页编辑

**Branch**: `002-article-authoring`（仅规格目录名，不创建 git 分支） | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md)

**Input**: 规格 [spec.md](./spec.md) —— 44 条功能需求（37 P0 / 5 P1 / 2 P2）、4 个用户故事（28 条验收场景）、11 条成功标准、14 条边界情况、6 个实体；范围已重定：**模板套用整体移出本期**（FR-042）。

**Note**: 执行计划只维护一份，放 `docs/superpowers/plans/`；本文件是设计输入，不另起任务清单（任务拆分由 `/speckit-tasks` 生成后并入该计划）。设计决策的依据见 [research.md](./research.md)，数据结构见 [data-model.md](./data-model.md)，接口契约见 [contracts/actions-and-permissions.md](./contracts/actions-and-permissions.md)，验证路径见 [quickstart.md](./quickstart.md)。

## Summary

本期把「谱文」从「功能尚未开放」的占位页变成真正能用的写作线：**三区编辑器（左分类树 / 中单页画布 / 右页缩略图 + 顶栏）+ 多页 + 正文插图 + 2 秒自动保存**，并按规格**不交付任何版式能力**。

改动集中在 12 处：

1. **依赖**：安装 TipTap 3 六包（`@tiptap/react`、`@tiptap/core`、`@tiptap/pm`、`@tiptap/starter-kit`、`@tiptap/extension-text-style`、`@tiptap/extension-image`）与 `@vercel/blob`（≥2.3，私有存储）。同批提交：删 `docs/decisions/0010` 的「尚未安装」状态句并同步 `docs/decisions/README.md` 的 ADR-12 行（**保留 `决策 ≠ 现在安装` 字面串**，依赖黑名单断言随之自动跳过，`tests/docs-consistency.test.ts` 的无条件断言仍绿），并在 `biome.json` 把 `@tiptap/*` 限制在 `lib/article/**` 与 `components/article/editor/**`。
2. **数据语义（零迁移）**：`article.content` 从「单文档」改为分页文档包 `{ schemaVersion: 1, pages: [{ id, doc }] }`；页序 = 数组顺序；页 `id` 由服务端生成；`plain_text` 仍由内容派生。**不新建 `article_page` 表、不加冗余计数列、不设正文字数上限**（research.md §2、§8）。
3. **校验与派生层**：新增 `lib/article/schemas.ts`（Zod 入参与文档白名单）与 `lib/article/doc.ts`（`parseArticleContent` / `derivePlainText` / `countImages` / `isReferenced`），是节点白名单与派生字段的**唯一**实现处。
4. **写路径**：新增 `lib/article/actions.ts`（**8 个** Server Action）与 `lib/article/services.ts`（单事务读改写、`SELECT … FOR UPDATE`、`book_catalog` 引用检查、活动日志）。
5. **媒体存储抽象**：新增 `lib/article/media/{store,blob-store,fs-store}.ts`，由 `lib/config.ts` 一处判定 `mediaMode`；文档只存 `pathname`，**读取统一走服务端代理** `/api/media/<pathname>`（每请求重新授权，不签发带能力的 URL）。
6. **通道**：`POST /api/blob/upload`（blob 模式，`handleUpload` 只给 `onBeforeGenerateToken`）、`POST /api/media/upload`（fs 模式，同样校验 MIME/体积/前缀）、`GET /api/media/[...key]`（**两种模式都注册**的读取代理）；全部 `withApiLogging` + 显式 DTO + 鉴权失败一律 404。
7. **Action 通道扩展**：`lib/auth/types.ts` 的 `ActionState` 增加可选 `data`；`lib/auth/middleware.ts` 新增 `validatedActionWithUserObject`（既有 `validatedActionWithUser` 读 `Object.fromEntries(formData)`，撑不住嵌套 `doc` / `pageIds` / `null`）。
8. **权限口径不变**：谱文读写仍用 `content.read` / `article.write`；**谱文分类的写权限仍是 `project.write`**（FR-036 禁止本期改变能力矩阵），编辑者看不到分类管理入口，默认分类由 `createArticleAction` 事务内自动创建（research.md §9）。
9. **查询层**：新增 `lib/db/queries/articles.ts`（列表带页数、分类篇数、单篇打开、删除预览、引用检查），全部经 `withOrg` 带 `orgId`；分类删除确认框改用 `getFolderDeletePreview`（不改 `deleteFolderAction` 的返回契约）。
10. **页面**：替换 `articles/page.tsx` 占位为「分类树 + 列表 + 新建」；新增 `articles/[articleId]/page.tsx` 编辑器页与 `components/article/**`；云谱空间概览页加「新建谱文」入口（FR-008）。
11. **离开保护**：应用内离开 `await` 保存后导航（失败停留）；关闭标签/刷新用 `beforeunload` 原生确认（research.md §14，FR-003/FR-016）。
12. **文档与测试**：新增 `docs/decisions/0019-media-storage.md`、更新 `04-数据视图` 的 `content` 结构说明、`05-接口与集成设计` §6.6 映射、`11-需求与实现状态` 谱文状态、`AGENTS.md` 的「尚未实现」清单；补单测 / 真实 PG 集成测试 / E2E 主链路（含 20 页 40 图夹具）。

**不做**（本期明确排除，违反即视为缺陷）：模板套用与版式库、对齐辅助、自定义模板、全文检索（P2 后置）、正文引用人丁、图片裁剪与自由缩放、加粗/斜体/颜色/表格/列表等富文本、导出/分享/发布、后台任务与队列、任何新表或迁移、任何权限枚举或能力矩阵变更。

## Technical Context

**Language/Version**：TypeScript 7.0.2（`strict` + 4 条实测零报错的额外检查，见 ADR 0012）、Node.js 24 LTS、React 19.3.1、Next.js 16.4.3 App Router；包管理 pnpm 12。

**Primary Dependencies**：新增 `@tiptap/react`、`@tiptap/core`、`@tiptap/pm`、`@tiptap/starter-kit`、`@tiptap/extension-text-style`、`@tiptap/extension-image`、`@vercel/blob`（≥2.3）。复用既有：`drizzle-orm` 0.45（钉次版本）、`zod` 4、`radix-ui`、`lucide-react`、`class-variance-authority`。**不引入**：编辑器外的状态库（zustand 仍只用于谱系工作区）、SWR、任何图片处理库（不做裁剪）。

**Storage**：正文与页序存 PostgreSQL `article.content`（jsonb，单行）；图片字节存 Vercel Blob 私有 store（生产）或 `.data/media`（本地/CI，`fs` 驱动）；数据库只记 `pathname`；读取永远经 `/api/media/...`。**无新表、无新迁移**。

**Testing**：Vitest 单测（`lib/article/**` 的派生与校验、保存状态机、错误文案）+ 真实 PostgreSQL 集成测试（权限、`FOR UPDATE` 保存、页序、引用阻止、跨组织 404、媒体读取鉴权）+ Playwright E2E（建谱文 → 写字 → 加页 → 插图 → 刷新一致）。既有测试影响：`tests/docs-consistency.test.ts` 第 162 行的 `决策 ≠ 现在安装` 断言**保持不变**，依赖黑名单只在 ADR 含「尚未安装」时生效（删状态句后自动跳过）；`tests/schema-barrel.test.ts`（21 张表）与 `tests/dependency-pins.test.ts`（只钉 drizzle）不受影响；`tests/arch-check`（≤400 行）对新文件生效；`vitest.coverage.config.ts` 需核对 `lib/article/**` 是否被覆盖率门槛纳入（按现有 include 规则调整）。

**Target Platform**：Vercel（Node 运行时）+ Neon PostgreSQL 18；本地 Docker PostgreSQL + `next dev`；浏览器为现代常青版（桌面优先，窄屏折叠两侧栏）。

**Project Type**：Next.js 全栈单体（Server Component 读 + Server Action 写 + 少量 Route Handler），不是前后端分离工程。

**Performance Goals**：切页 <300ms（SC-003）；20 页 / 40 图滚动 ≥45fps；保存 p95 <800ms；停止输入 2 秒内出现「已保存」；200 篇列表打开到可搜索 p95 <1s。

**Constraints**：零迁移；零后台任务/队列/定时器（ADR 0005）；单文件 ≤400 行（`pnpm arch:check`）；只在 `lib/config.ts` 读 `process.env`（F7）；界面全简体中文、无裸色值；新依赖必须按 ADR 0009 §1 记账；非成员一律 404；`app_rw` 无 DELETE 权限，删除一律软删；**不设正文字数上限**（规格要求超长正文完整保存）。

**Scale/Scope**：单项目 ≤200 篇谱文、单篇 ≤100 页、每页 ≤6 张图、单图 ≤10MB；正文长度不设上限（受页数上限间接约束）。本期新增 2 个页面与约 30 个新文件（其中约 11 个在 `components/article/**`，6 个测试文件）。

## Constitution Check

*GATE：Phase 0 之前判定一次，Phase 1 设计后复核一次。*

| 门 | 判定 | 依据 |
|---|---|---|
| I 组织隔离与服务端授权 | 通过 | 所有读写经 `withOrg` / `withOrgWrite` 带 `orgId`；权限用 `hasPermission(role,'article.write')`；公开 ID 只用于 URL，非成员返回 404（contracts §0） |
| II 认证与连接分离 | 通过 | 不新增 `/api/auth/*`，不碰 `auth.*`；三个 Route Handler 只 `getSessionUser()` + `getOrgRole`，写业务数据走 `withOrgWrite`（`app_rw`） |
| III 写路径单事务 | 通过 | 保存页/加页/删页/重排/删除谱文都在 `lib/article/services.ts` 的单个 `withOrgWrite` 事务内，事务内 `FOR UPDATE` 锁定读；`23505/23514/23503` 转中文 `ActionState` |
| IV 先失败测试后实现 | 通过（计划） | 每个 Action 先写失败的单测/集成测试再实现；SQL 与隔离相关必须补真实 PG 集成测试；完成以 `pnpm check && pnpm typecheck && pnpm test` 输出为证 |
| V 单一事实来源与最小改动 | 通过 | 页序只由数组顺序表达；`plain_text` 只在 `lib/article/doc.ts` 派生；`mediaMode` 只在 `lib/config.ts` 判定；不新增冗余计数列；不改 `lib/lineage/**`；编辑器依赖限制在 `lib/article/**` 与 `components/article/editor/**` |
| 附加：软删语义 | 通过 | 谱文删除是 `deleted_at` 软删；查询默认 `isNull(deletedAt)`；无回收站 UI |
| 附加：迁移纪律 | 通过 | 本期零迁移，`_journal.json` 不变，漂移检查自然通过 |
| 附加：简体中文与设计系统 | 通过 | 全部文案中文；颜色只用 `components/ui` 与 `lib/ui/status.ts` 的语义 token |
| 附加：零后台任务 | 通过 | 图片删除在事务提交后同步执行（尽力而为），不引入队列、定时器或孤儿清理任务（research.md §3 记为已知限制） |
| 附加：能力矩阵不变（FR-036） | 通过 | 权限枚举与角色矩阵零变更；分类写权限保持 `project.write`（research.md §9） |

**Phase 0 结论**：无违例，可进入设计。**待观察项**：新增 7 个运行期依赖（ADR 0009 §1 需在 PR 描述记账）、新增媒体存储基础设施（需新 ADR 0019）、图片读取经函数代理带来带宽成本（research.md §3 已记账并给出重估触发）。

### 设计后复核（Phase 1 结束）

| 门 | 复核结论 |
|---|---|
| I 组织隔离与服务端授权 | 仍通过。三个 Route Handler 都先 `getSessionUser()` 再按 `orgId` 校验成员；`pathname` 前缀 `articles/<orgId>/<articleId>/` 由服务端校验（data-model §2 不变量 8）；读取代理每请求重新授权，URL 不含能力（FR-035） |
| II 认证与连接分离 | 仍通过。上传令牌只签 `put` 且前缀由服务端决定；读取不签发任何带能力的 URL，也不把存储令牌交给客户端 |
| III 写路径单事务 | 仍通过。删除谱文的「引用检查 → 软删 → 活动日志」在同一事务；字节删除放在提交后（跨系统，无法进事务），失败只记日志不回滚 |
| IV 先失败测试后实现 | 仍通过。`research.md` §12 已列出依赖记账表，测试清单写进执行计划 |
| V 单一事实来源与最小改动 | 仍通过。`content` 结构、派生规则、`mediaMode`、错误文案各只有一处实现；`ActionState` 只加一个可选字段；未改 `lib/lineage/**`；Complexity Tracking 记录 3 处有意取舍 |
| 附加：零后台任务 | 仍通过。无队列、无定时器；孤儿字节接受为已知限制，重估触发写在 research.md §3 |
| 附加：自动保存与 RSC 边界 | 新增判定：保存页/加删页/重排页**不 revalidate**，编辑器只在首次挂载用 RSC 数据初始化，避免 2 秒级刷新覆盖正在编辑的文档（research.md §6） |

## Project Structure

### Documentation (this feature)

```text
specs/002-article-authoring/
├── spec.md                  # 规格（已重定范围）
├── source-prd.md            # 附件 PRD 原样副本（sha256 b70e02ca…）
├── plan.md                  # 本文件
├── research.md              # Phase 0：15 节决策与放弃方案
├── data-model.md            # Phase 1：content 结构、不变量、派生字段、权限矩阵
├── quickstart.md            # Phase 1：本地验证路径
├── contracts/
│   └── actions-and-permissions.md   # 8 个 Action + 2 个预览查询 + 3 个 Route + 媒体接口 + 界面契约
├── checklists/
│   └── requirements.md      # 规格质量清单（16/16）
└── tasks.md                 # 由 /speckit-tasks 生成（本阶段尚未产出）
```

配套文档改动（同批提交，按 `pnpm docs:check --strict` 校验）：

```text
docs/decisions/0019-media-storage.md      【新增】媒体存储决策（私有 Blob + 服务端代理读取 + fs 兜底）
docs/decisions/README.md                  索引加 ADR-29 行 + §2 表格加 0019 行
docs/decisions/0010-rich-text-editor-selection.md   只改状态句（「尚未安装」→「本期安装」，保留 `决策 ≠ 现在安装` 字面串）
docs/architecture/04-数据视图-数据架构.md  §10.1 补 article.content 结构说明（不改 DDL）
docs/architecture/11-需求与实现状态.md     §5.5 谱文状态、§1.5.2「M1 不插图片」口径、§5.5 FR-ART-1 的「类型」改「分类」
docs/architecture/05-接口与集成设计.md     §6.6 从「[目标] 未导出」改为已实现清单（映射见 contracts §1.11）
AGENTS.md                                  §1「尚未实现」清单移除谱文编辑器与图片
docs/superpowers/plans/                    【新增】本期执行计划（唯一一份，含 tasks.md 的任务）
```

### Source Code (repository root)

```text
lib/
├── article/                                  【新增】
│   ├── schemas.ts                            Zod 入参 + 文档白名单（节点/mark/不变量）
│   ├── doc.ts                                parseArticleContent / derivePlainText / countImages / isReferenced
│   ├── constants.ts                          ARTICLE_ERRORS 中文文案、上限常量（100 页 / 6 图 / 10MB）
│   ├── services.ts                           单事务读改写（保存页 / 加删重排页 / 删除谱文 / 引用检查）
│   ├── actions.ts                            8 个 Server Action（'use server' + validatedActionWithUserObject）
│   └── media/                                【新增】
│       ├── store.ts                          MediaStore 接口（mode / read / delete）+ getMediaStore()
│       ├── blob-store.ts                     Vercel Blob 私有 store（服务端 get / del）
│       └── fs-store.ts                       本地 .data/media 驱动（开发与 CI）
├── db/
│   └── queries/articles.ts                   【新增】列表（含页数）/ 单篇 / 分类篇数 / 删除预览 / 引用检查
├── auth/
│   ├── types.ts                              改：ActionState 增加可选 data
│   └── middleware.ts                         改：新增 validatedActionWithUserObject（对象入参）
└── config.ts                                 改：新增可选 BLOB_READ_WRITE_TOKEN 与 mediaMode 判定

app/
├── api/blob/upload/route.ts                  【新增】handleUpload（blob 模式，非 blob 模式返回 404）
├── api/media/upload/route.ts                 【新增】fs 驱动上传（fs 模式，含 MIME/体积/前缀校验）
├── api/media/[...key]/route.ts               【新增】双模式读取代理（每请求校验会话 + 成员）
└── (dashboard)/dashboard/project/[projectRef]/
    ├── page.tsx                              改：加「新建谱文」入口（FR-008）
    └── articles/
        ├── page.tsx                          改：占位 → 分类树 + 列表 + 新建
        └── [articleId]/page.tsx              【新增】编辑器页（三区）

components/article/                           【新增】
├── article-editor-shell.tsx                  三区布局 + 顶栏状态汇总 + 离开保护
├── article-title-input.tsx                   顶栏标题（1–60 字，失焦提交）
├── save-status.tsx                           保存中 / 已保存 / 失败重试
├── article-folder-tree.tsx                   左：分类树 + 篇数（分类管理入口按 project.write 显隐）
├── article-list.tsx                          列表（倒序、页数、标题搜索）
├── new-article-dialog.tsx                    新建弹窗（标题 + 分类 + 只读地区）
├── page-thumbnails.tsx                       右：页缩略图 + 添加页 + 拖拽排序
└── editor/
    ├── tiptap-editor.tsx                     单页编辑器（受控，禁用的节点集在此配置）
    ├── article-image-node.tsx                自定义 articleImage 节点（三档宽度）
    ├── toolbar.tsx                           插入图片 + 字体/字号（P2 白名单）
    └── paste-filter.ts                       粘贴清洗（去格式、丢外链图）

tests/
├── article-doc.test.ts                       【新增】派生与白名单单测
├── article-schemas.test.ts                   【新增】入参与不变量单测
├── article-save-state.test.ts                【新增】保存状态机单测
├── integration/articles.test.ts              【新增】权限 / FOR UPDATE / 页序 / 引用阻止 / 跨组织
├── integration/media.test.ts                 【新增】fs 驱动上传与读取鉴权
└── e2e/article-authoring.spec.ts             【新增】主链路（含 20 页 40 图夹具）

vitest.coverage.config.ts                     改：核对覆盖率 include 是否覆盖 lib/article/**
.gitignore                                    改：加 .data/（本地媒体落盘目录，fs 驱动用）
```

**Structure Decision**：沿用仓库现有单层布局（`app/` + `components/` + `lib/` + `tests/`），不引入 `src/modules`。域代码集中在 `lib/article/**`（服务端：schema、派生、事务、Action、媒体）与 `components/article/**`（客户端：编辑器与界面），与既有 `lib/lineage/**` + `components/lineage/**` 的划分方式一致；Route Handler 只做媒体通道，不复制 Action 逻辑；`lib/folder/**` 与 `lib/lineage/**` 本期不改。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 新增 7 个运行期依赖（6 个 TipTap 包 + `@vercel/blob`） | ADR 0010 已把编辑器边界定在 ProseMirror JSON，安装是兑现既有决策；图片必须有字节存储，仓库当前无任何对象存储（`06-部署视图:55`「没有对象存储」） | 自写 contenteditable：撤销栈、输入法组合态、粘贴清洗是高风险逻辑，远超 ADR 0009 §1 的「≥100 行」记账门槛；自建图片存储：等于在本期重做上传、授权与生命周期，且没有运维面 |
| 新增媒体存储基础设施（与「M1 不含媒体上传」的既有口径冲突） | 规格把图片定为 P0（FR-025–FR-029），没有字节存储就无法交付；口径冲突用 ADR 0019 与 `11-需求与实现状态` 同步修正 | 只做外链图片（让用户贴 URL）：违反 FR-025「从本地上传」与 FR-035 的跨组织约束，且外链会失效 |
| 图片读取经本函数代理（带宽与函数时长成本） | FR-035 要求每个请求重新授权；逐 pathname 签发签名 URL 需要 40 次控制面往返（威胁 SC-003），退化成通配前缀又等于把整库读权限发给浏览器 | 公有桶 + 不可猜 URL：能力 URL 一旦转发即永久可读；图片 base64 塞进 `content`：单篇文档膨胀到数十 MB，列表与保存都会被拖垮 |
| 编辑者看不到分类管理入口（FR-036 的代价） | FR-036 明令本期不改变能力矩阵，而 `editor` 没有 `project.write`；默认分类由服务端事务内自动创建，编辑者仍能建谱文 | 把分类写权限换成 `article.write`：等于给编辑者新增能力，违反 FR-036；新增 `article.folder` 权限串：同样改矩阵且多一处文档同步 |
| 图片字节删除放在事务提交之后（跨系统操作不进事务） | Blob 与 PostgreSQL 无法共享事务；把字节删除放进事务只会制造「事务回滚但字节已删」的坏状态 | 引入队列/定时器做最终一致清理：违反 ADR 0005（零后台任务），本期不做 |
