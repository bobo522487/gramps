# 03 · 目录结构

## 1. 顶层

```text
gramps/
├── app/                    Next.js App Router：页面、布局、Route Handler
├── components/             React 组件（console 框架 / 谱系 / 谱文 / UI 原语）
├── hooks/                  客户端 hooks（自动保存、会话、移动端、可拖拽）
├── lib/                    业务域、数据访问、基础设施（无 JSX）
│   ├── auth/               认证、会话、权限矩阵、Better Auth 配置
│   ├── org/                组织、成员、邀请
│   ├── project/            云谱空间
│   ├── folder/             分类
│   ├── lineage/            谱系与人丁
│   ├── genealogy/          谱系表单 schema 与枚举常量
│   ├── article/            谱文、分页文档、媒体存储
│   ├── console/            控制台横切（缓存失效）
│   ├── db/                 连接、事务、表定义、查询、迁移、种子
│   ├── server/             请求上下文（AsyncLocalStorage）
│   ├── api.ts              Route Handler 日志包装
│   ├── config.ts           唯一环境变量入口
│   ├── errors.ts           Action 错误码
│   ├── logger.ts           JSON 日志
│   ├── ids.ts              公开 ID 生成
│   ├── fetcher.ts          客户端 fetch 封装
│   └── query-keys.ts       TanStack Query key 工厂
├── public/                 静态资源
├── scripts/                架构与数据校验脚本
├── tests/                  单元 / 集成 / E2E
├── docs/                   项目长期文档（产品、架构、契约、ADR、runbook）
├── .specify/               治理层：constitution + 模板
├── specs/                  交付层工作产物（当前为空）
├── instrumentation.ts      启动时环境校验
├── proxy.ts                轻量边缘中间件（cookie 乐观检查）
├── next.config.ts          Next 配置
├── drizzle.config.ts       Drizzle Kit 配置
├── biome.json              lint / format / 依赖方向规则
├── vitest*.config.*        测试配置
└── playwright.config.ts    E2E 配置
```

## 2. `app/` 路由树

```text
app/
├── layout.tsx                         根布局：读取 session + 组织列表，注入 Query/Theme Provider
├── error.tsx                          路由级错误边界
├── global-error.tsx                   根级错误边界
├── not-found.tsx                      404
│
├── (marketing)/
│   ├── layout.tsx                     营销页布局
│   └── page.tsx                       首页（已登录可直接跳转控制台）
│
├── (login)/
│   ├── sign-in/page.tsx               登录页
│   ├── sign-up/page.tsx               注册页（支持邀请链接）
│   └── join/page.tsx                  接受邀请入口
│
├── (dashboard)/
│   └── dashboard/
│       ├── (account)/
│       │   ├── layout.tsx             账号设置布局
│       │   ├── page.tsx               账号首页：无组织时空状态，否则跳第一个组织
│       │   ├── general/page.tsx       资料（界面壳）
│       │   └── security/page.tsx      安全（界面壳）
│       ├── join/page.tsx              登录态下接受邀请
│       ├── org/[orgSlug]/
│       │   ├── layout.tsx             requireOrgContext + 项目列表
│       │   ├── page.tsx               云谱空间列表
│       │   ├── team/page.tsx          成员与邀请
│       │   └── settings/page.tsx      组织设置 / 归档
│       └── project/[projectRef]/
│           ├── layout.tsx             requireProjectContext + 项目列表
│           ├── page.tsx               项目概览
│           ├── settings/page.tsx      项目设置 / 删除
│           ├── lineages/
│           │   ├── layout.tsx         谱系导航数据（分类 + 谱系）
│           │   ├── page.tsx           谱系列表
│           │   └── [lineageId]/page.tsx  谱系画布详情
│           ├── articles/
│           │   ├── page.tsx           谱文列表
│           │   └── [articleId]/page.tsx 谱文编辑器
│           └── books/page.tsx         谱书（占位）
│
└── api/
    ├── health/route.ts                GET 健康检查
    ├── user/route.ts                  GET 当前用户
    ├── orgs/route.ts                  GET 当前用户组织
    ├── orgs/[orgId]/projects/route.ts GET 组织下项目
    ├── media/upload/route.ts          POST 本地上传（fs 模式）
    ├── media/[...key]/route.ts        GET 私有图片读取代理
    └── blob/upload/route.ts           POST Vercel Blob 直传 token
```

## 3. `lib/` 模块地图

```text
lib/
├── auth/
│   ├── better-auth.ts          Better Auth 实例（Drizzle adapter / session / cookie）
│   ├── access-control.ts       资源-动作权限语句 + owner/admin/editor/viewer 矩阵
│   ├── permissions.ts          hasPermission / getOrgRole / getOrgRoleInTx
│   ├── context.ts              getSessionUser / requireUser / requireOrgContext / requireProjectContext
│   ├── middleware.ts           validatedActionWithUser（session + Zod）
│   ├── errors.ts               Better Auth / PG 错误 → 中文文案 / ActionState
│   ├── rate-limit.ts           内存滑动窗口限流
│   ├── schemas.ts              认证/组织/项目表单 Zod schema
│   ├── types.ts                SessionUser / ActionState
│   └── actions/
│       ├── session.ts          注册、登录、登出
│       └── account.ts          改密码、改资料
│
├── org/
│   ├── actions.ts              创建/重命名/归档组织，邀请/移除/改角色
│   ├── invitations.ts          邀请 token、join state、接受邀请
│   └── members.ts              成员列表与角色查询
│
├── project/
│   ├── actions.ts              创建/更新/删除云谱空间
│   ├── services.ts             事务实现 + 子表引用检查
│   └── constants.ts            主题、状态、重要度枚举
│
├── folder/
│   ├── actions.ts              分类增删改
│   └── services.ts             同名冲突、删除时内容迁移到未分类
│
├── lineage/
│   ├── actions.ts              谱系与人丁 Server Actions
│   ├── services.ts             谱系 CRUD、删除前置条件
│   ├── node-services.ts        人丁三表写入、路径分配、子树删除
│   ├── lineage-write.ts        withLineageWrite / withCreateWrite（行锁 + 权限）
│   ├── subtree.ts              子树 ID 收集与删除确认文案
│   ├── auto-root.ts            空谱系是否自动弹始祖录入
│   ├── constants.ts / nav.ts / create-form.ts / lineage-errors.ts
│   └── schemas.ts（在 lib/genealogy/）  谱系与人丁 Zod schema
│
├── article/
│   ├── actions.ts              谱文 CRUD、页保存、加删页、重排
│   ├── services.ts             谱文结构操作事务
│   ├── page-services.ts        页级保存（行锁 + 整篇校验）
│   ├── mutations.ts            内容校验、图片路径提取、结构变更
│   ├── doc.ts                  ArticleContent 序列化 / 解析 / 空文档
│   ├── doc-view.ts             纯文本摘要派生
│   ├── save-state.ts           自动保存状态机
│   ├── schemas.ts              文档 / 图片节点 / 页数限制
│   ├── constants.ts            页数、图片数、字号、宽度等限制
│   ├── nav.ts                  侧边栏导航缓存查询
│   ├── flatten-lists.ts        列表扁平化
│   └── media/
│       ├── path.ts             pathname 四段规则与 MIME
│       ├── store.ts            fs / blob 存储抽象
│       ├── fs-store.ts         本地文件系统实现
│       ├── blob-store.ts       Vercel Blob 实现
│       ├── token.ts            Blob token 校验
│       └── read-url.ts         读取 URL / 302 重定向
│
├── genealogy/
│   ├── constants.ts            性别、节点类型、世次等枚举
│   └── schemas.ts              谱系与人丁表单 schema
│
├── console/
│   └── revalidate.ts           revalidateWholeConsole()
│
├── db/
│   ├── drizzle.ts              连接池 + withOrg() + queryRows()
│   ├── auth-db.ts              独立认证连接（auth_service）
│   ├── write.ts                withOrgWrite()
│   ├── guards.ts               requireOrgPermission()
│   ├── errors.ts               PG 错误识别（唯一/外键/RAISE/sqlstate）
│   ├── schema/                 Drizzle 表定义（按域拆分）
│   ├── queries/                只读查询（org/project/folder/lineage/node/article）
│   ├── migrations/             0000_target_schema.sql（唯一基线）
│   ├── setup.ts                交互式本地环境初始化
│   └── seed.ts                 演示数据
│
├── server/request-context.ts   AsyncLocalStorage 请求上下文
├── api.ts / config.ts / logger.ts / errors.ts / ids.ts / fetcher.ts / query-keys.ts
```

## 4. `components/` 组件地图

| 目录 | 关键组件 | 职责 |
| --- | --- | --- |
| `components/console/` | `ConsoleFrame`、`ConsoleNavbar`、`ConsoleSidebar`、`ConsoleScopeProvider`、`OrgPicker`、`ProjectPicker`、`PageHeader`、`EmptyState`、`RouteError`、`UserMenu` | 控制台框架与作用域切换 |
| `components/org/` | `CreateOrgDialog`、`OrgSettingsPanel`、`MembersPanel`、`AcceptInvitePanel` | 组织与成员管理 UI |
| `components/project/` | `ProjectWorkspace`、`CreateProjectDialog`、`ProjectSettingsPanel` | 云谱空间 UI |
| `components/lineage/` | `LineageShell`、`LineageWorkspace`、`LineageDetail`、`LineageSidebar`、`PersonInspector`、`NodeCreateDialog`、`NodeMoveDialog`、`NodeContextMenu`、`canvas/GenealogyCanvas` | 谱系编辑与画布 |
| `components/article/` | `ArticleWorkspace`、`ArticleEditorShell`、`ArticleFolderTree`、`ArticleList`、`PageStrip`、`SaveStatus`、`editor/TipTapEditor`、`editor/Toolbar` | 谱文列表与编辑器 |
| `components/ui/` | shadcn 风格原语（button、dialog、select、table、toast…） | 无业务的基础组件 |

## 5. `scripts/` 与 `tests/`

| 脚本 | 用途 |
| --- | --- |
| `check-file-size.mjs` | F6：普通文件 ≤ 400 行（有显式豁免名单） |
| `check-env-access.mjs` | F7：仅 `lib/config.ts` 可读 `process.env` |
| `check-docs.mjs` | 校验文档链接与结构 |
| `provision-roles.mjs` | 创建/更新 `genealogy_app`、`auth_service`、`auth_runtime` |
| `verify-target-schema.mjs` | 独立测试库重建目标态：DDL、约束、RLS、TS/SQL parity、EXPLAIN |
| `verify-deployment.mjs` | 部署后校验连接、角色、schema、关键函数 |
| `reset-target-db.mjs` | 清空目标库（仅显式重建模式） |
| `diagnose-*.mjs` | 数据库 / 角色 / 连接诊断 |

```text
tests/
├── unit/           纯函数与 schema（无数据库）
├── integration/    真实 PostgreSQL：RLS、事务、查询、Action
├── e2e/            Playwright：登录 → 组织 → 项目 → 谱系/谱文主流程
└── README.md       分层边界、命令、覆盖率门槛
```

## 6. 文档与治理目录

| 目录 | 作用 |
| --- | --- |
| `docs/vision.md` | 产品意图、成功度量、明确不做 |
| `docs/glossary.md` | 全项目唯一术语表 |
| `docs/architecture.md` | 系统边界、技术栈、部署 |
| `docs/interfaces.md` | 接口地图（谁调谁） |
| `docs/data-model.md` | 目标态数据模型规格 |
| `docs/nfr.md` | 性能/安全/可用性阈值 |
| `docs/contracts/` | 跨 feature 接口契约（唯一真相源） |
| `docs/adr/` | 决策记录（只写为什么） |
| `docs/roadmap.md` | 切片顺序、范围、依赖、状态 |
| `docs/runbooks/` | 上线、排障、回滚 |
| `.specify/memory/constitution.md` | 不可协商原则 |
| `.agents/`、`.claude/` | AI 协作技能配置 |
