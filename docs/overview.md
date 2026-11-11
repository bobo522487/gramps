# 项目概览（Overview）

> **回答什么问题**：产品是什么、给谁用、明确不做什么、怎么算成功、技术栈是什么。
> **读者**：全员 · 新人第一份 · 产品 / 需求评审　**长度上限**：5 页
> **不写什么**：系统分层与部署（`docs/architecture.md`）、表与不变量（`docs/data-model.md`）、接口契约（`docs/api.md`、`docs/contracts/`）、可度量技术阈值（`docs/nfr.md`）、排期（`docs/roadmap.md`）。

## 1. 产品定位

**云谱（gramps）** 是面向家族修谱场景的在线谱牒编纂平台。一个组织（家族或修谱工作室）在云端创建「云谱空间」，在其中：

- 按**分类**组织谱系、谱文与谱书；
- 以**谱系树**录入世系人丁，保存姓名、字号、性别、生辰、忌辰、葬地等事实；
- 以**谱文**撰写家族文章，支持分页富文本与插图；
- 为后续的**谱书编目与排版**预留数据结构。

使用者是修谱主事人、修谱工作室与族内协作者。M1 的目标是「把信息结构化地存下来」，呈现与协作能力留到 M2 之后。

## 2. 范围边界

### 2.1 已交付能力（代码中存在完整读写链路）

| 能力 | 入口 | 状态 |
| --- | --- | --- |
| 邮箱密码注册 / 登录 / 登出 | `app/(login)`、`lib/auth/actions/session.ts` | 可用 |
| 账号资料与安全设置 | `app/(dashboard)/dashboard/(account)` | 可用（资料页为界面壳） |
| 组织创建、重命名、归档 | `lib/org/actions.ts` | 可用 |
| 成员邀请 / 接受邀请 / 移除 / 改角色 | `lib/org/invitations.ts`、`members.ts` | 可用 |
| 云谱空间（project）CRUD | `lib/project/actions.ts` | 可用 |
| 分类（folder）CRUD + 移动内容到未分类 | `lib/folder/services.ts` | 可用 |
| 谱系 CRUD、始祖 / 子女 / 兄弟 / 普通人丁录入 | `lib/lineage/*` | 可用 |
| 谱系画布、检索、人物检视、删除子树 | `components/lineage/*` | 可用 |
| 谱文 CRUD、分页、排序、自动保存 | `lib/article/*` | 可用 |
| 正文插图（本地 fs / Vercel Blob） | `app/api/media/*`、`app/api/blob/upload` | 可用 |
| 谱书列表页 | `app/.../books/page.tsx` | 仅占位空状态 |

### 2.2 明确不做

来自 `README.md` 与产品文档：

- 邮箱验证、找回密码、邮件发送、`/api/auth/*`；
- 后台任务、消息队列、独立缓存层；
- 匿名业务页、公开 API、分享；
- 回收站 UI（目标态数据层没有软删列，删除一律 `ON DELETE RESTRICT`）；
- 编辑锁、i18n、谱书编目编辑与成品排版（`book` 三表已落库但无写入口）。

### 2.3 已知限制（代码内显式说明）

- **谱系配偶**：`node_create_mode` 含 `spouse`，但事实层尚未接线；服务层直接返回 `not_supported`，界面提示“当前版本暂不支持该操作”。`family_*` 表已建模。
- **子树移动 / 同级重排**：`node_move_dialog` 已存在界面，但服务层因非 deferrable 外键暂不支持真正移动，直接返回 `not_supported`，不再用“目标无效”误导用户。
- **谱系删除**：会先删除该谱系全部 `node` 行，再删谱系；被谱书编目引用时拒绝。`person` 事实行不会级联删除。

## 3. 领域语言

术语定义与禁用同义词只在 [`docs/glossary.md`](glossary.md)；写规格与读代码前先读它，本文件不复制第二份。世次派生公式只在 `docs/data-model.md` §3 定义。

## 4. 技术栈

| 层 | 选型 | 版本 | 说明 |
| --- | --- | --- | --- |
| 运行时 | Node.js | 24.22.2（`.nvmrc`） | Vercel Fluid Compute 兼容 |
| 框架 | Next.js App Router | 16.4.6 | RSC + Server Actions + Route Handlers |
| UI | React | 19.3.1 | 服务端组件优先 |
| 语言 | TypeScript | 7.0.2 | `strict` |
| 样式 | Tailwind CSS | 4.3.3 | `@tailwindcss/postcss` |
| 组件库 | Radix UI | 1.8.1 | 无样式可访问原语 |
| 数据访问 | Drizzle ORM | 0.45.4 | 类型安全 SQL，事务 API |
| 数据库 | PostgreSQL | 18 | ltree、RLS、SECURITY DEFINER |
| 驱动 | `postgres.js` / `pg` | 3.4.9 / 8.23.1 | 本地用 postgres.js，Vercel 用 pg Pool |
| 认证 | Better Auth | 1.7.20 | Drizzle adapter + 自定义 access control |
| 服务端状态 | TanStack Query | 5.107.1 | RSC 注入 `initialData` |
| 客户端状态 | Zustand | 5.1.0 | 谱系画布视图状态 |
| 谱系画布 | `@xyflow/react` | 12.12.1 | 自定义节点 / 边 / 布局 |
| 富文本 | TipTap | 3.33.1 | StarterKit + 自定义图片、字号、对齐扩展 |
| 对象存储 | `@vercel/blob` | 2.9.0 | 生产图片直传 |
| 校验 | Zod | 4.6.7 | 所有 Action 边界 |
| 质量 | Biome / Vitest / Playwright | 2.6.6 / 5.1.0 / 1.65.0 | lint+format / 单测+集成 / E2E |

## 5. 架构风格与不可协商原则

项目在 `.specify/memory/constitution.md` 中定义了治理原则，代码层面可观察到以下硬约束：

1. **模块化单体**：单应用、单数据库；跨域通过 `lib/*` 的公开函数协作，不引入服务间 RPC。
2. **写走 Action、读走 RSC / Query**：Server Action 只做「校验 → 事务 → 失效」，不做展示逻辑；页面只读查询。
3. **作用域即安全边界**：任何组织数据访问必须处于 `withOrg()` 事务内，由 RLS + 事务内权限复核双重保护。
4. **边界校验**：所有写入口使用 Zod schema（`lib/*/schemas.ts`），Service 层信任已校验输入。
5. **依赖方向受 Biome 限制**：客户端组件不得直接 import ORM / 数据库；`lib/db` 不得反向依赖 Next 运行时；查询层不得依赖 Action 层（详见 [architecture.md](architecture.md#9-依赖方向)）。
6. **文件规模上限 F6**：`app/ components/ lib/ hooks/` 下普通文件 ≤ 400 行，超限需显式豁免（`scripts/check-file-size.mjs`）。
7. **配置单一入口 F7**：只有 `lib/config.ts` 可以读取 `process.env`（`scripts/check-env-access.mjs`）。

## 6. 运行时形态

```
浏览器 ──HTTPS──> Vercel（Next.js 16）
                    ├─ RSC 渲染 ──> Neon PostgreSQL（业务连接 genealogy_app）
                    ├─ Server Actions ──> 同上（事务 + RLS）
                    ├─ Route Handlers ──> 同上 + Vercel Blob（图片）
                    └─ Better Auth 端点 ──> Neon PostgreSQL（认证连接 auth_service）
```

本地开发时数据库可用 Docker 启动（`lib/db/setup.ts` 会生成 `docker-compose.yml`）。图片存储由 `BLOB_READ_WRITE_TOKEN` 是否配置决定：未配置走本地文件系统，配置后走 Vercel Blob（`lib/config.ts` 的 `getMediaMode()`）。

## 7. 目标用户与成功度量

| 用户 | 核心诉求 | 典型场景 |
| --- | --- | --- |
| 修谱主事人 | 把纸质、口述与聊天记录里的信息结构化存下来 | 建云谱空间、录始祖与各房人丁、核对世次 |
| 修谱工作室 | 一个账号服务多个家族，数据互不串 | 按客户建组织、切换项目、交付前检查编目 |
| 族内协作者 | 只改自己那一支，不怕改坏别处 | 录入本房人丁、补字辈与配偶关系 |

上线 6 个月目标：激活率 ≥ 40%、次月留存 ≥ 50%、单组织人丁中位数 ≥ 200、单条人丁录入中位耗时 < 15 秒、保存失败率 < 0.1%。指标采集尚未全部落地，当前是目标而非已验证承诺。

## 8. 约束与前提

| 类别 | 约束 |
| --- | --- |
| 团队 | 1–3 人全栈，无专职运维 / DBA，靠 CI 门禁兜底 |
| 托管 | 只用 Vercel + Neon，不自建数据库与中间件 |
| 运行 | 零常驻进程，允许分钟级发布中断 |
| 数据合规 | 租户数据不出组织；日志不记录密码、token、身份证、完整住址 |
| 界面 | 全简体中文、桌面优先，不引入 i18n 框架 |
