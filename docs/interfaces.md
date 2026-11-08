# 接口地图（Interfaces）

> **回答什么问题**：系统有几条通道、谁调谁、边界在哪、契约细节去哪找。
> **读者**：开发 · 前端 · AI Agent　**长度上限**：3 页
> **不写什么**：单个 Action 的入参 / 返回 / DTO / 状态码（`docs/contracts/`）、错误码全集与字段级错误模型（`docs/contracts/`）、权限矩阵（`docs/contracts/`）、表与列（`docs/data-model.md`）、系统分层（`docs/architecture.md`）、实现状态（`docs/roadmap.md`）。

本文件是**地图，不是清单**。跨 feature 共用的接口契约唯一真相源是 `docs/contracts/`；本文件只指路，不复制契约。feature 目录只放本 feature 新增或修改的那部分，其余引用，不另起一份。术语按 `docs/glossary.md`。

---

## 1. 四条通道

```text
浏览器
  │
  ├─ 首屏 ────→ RSC 页面（app/**/page.tsx）
  │              └─→ lib/db/queries/<domain>.ts ─→ PostgreSQL（app_rw + RLS）
  │
  ├─ 写 ──────→ Server Action（lib/<domain>/actions.ts · lib/auth/actions/）
  │              ├─ validatedAction*（Zod 入参 + SessionUser）
  │              ├─ withOrgWrite（事务内复权）→ *-services.ts → 查询层 → PostgreSQL
  │              └─ 成功 → revalidatePath / invalidateQueries → RSC 重新渲染
  │
  └─ 刷新 ────→ TanStack Query（queryKeys 工厂 + fetcher<T>）
                 └─→ GET Route Handler（app/api/**/route.ts）→ 查询层 → PostgreSQL
```

| 通道 | 谁发起 | 用途 | 授权入口 |
| --- | --- | --- | --- |
| RSC 页面 | 浏览器首次导航 | 首屏读，服务端直接查库、不发起客户端数据请求 | `requireOrgContext` / `requireProjectContext`（含会话与成员校验，失败 `notFound()`） |
| Server Action | 表单 `useActionState` | **唯一写通道**；写成功后的刷新也由它触发 | `validatedAction` / `validatedActionWithUser` + `withOrgWrite(..., '<permission>')` 事务内复权 |
| Route Handler | 客户端刷新、探活、图片字节 | 只读 JSON 刷新 + 健康检查 + 谱文图片通道 | `withApiLogging`（`lib/api.ts`）→ `getSessionUser()`，组织级再加 `getOrgRole` |
| TanStack Query | 客户端组件 | 缓存服务端状态，只调只读 Route Handler | 无独立授权：同一 Cookie，服务端仍按会话与成员关系判定 |

首屏数据通过 `dehydrate` / `HydrationBoundary` 注入缓存；`queryKey` 一律从 `lib/query-keys.ts` 的工厂取，不在组件里手写 `fetch` 或拼字符串 key。谱系画布的数据不走 TanStack Query，直接来自 RSC props 与 Action 返回值。

---

## 2. 边界与例外

**没有 REST 层，也没有公开接口**：没有第三方消费者、没有分享页、没有 `/api/auth/*`，认证类 handler 数量为 0。多维护一份 REST 契约（DTO、校验、鉴权、文档）而收益是零。认证与租户写只从 Server Action 调 `auth.api.*`，不引入浏览器 auth client。

**写只走 Server Action，但有例外**——例外必须带理由，否则就是退化：

| 例外 | 为什么必须例外 | 落点 |
| --- | --- | --- |
| 谱文图片字节走 3 条 `POST` Route Handler | 单张 10MB 图片同时超过 Server Action 的 1MB 请求体上限与 Vercel 函数的 4.5MB 上限，装不进去 | `app/api/blob/upload/route.ts`、`app/api/media/upload/route.ts`、`app/api/media/[...key]/route.ts` |
| 谱文 Action 收 **JSON 对象**而非 FormData | 正文是嵌套的 ProseMirror 文档，`Object.fromEntries(formData)` 那条通道装不下 | `validatedActionWithUserObject`（`lib/auth/middleware.ts`）、`lib/article/actions.ts` |

另外两条不能碰的规则：

- **Action 入参只用内部 UUID**（`orgId` / `projectId` / `lineageId` …）；20 位公开 `slug` / `ref` 只用于 URL 定位与成功返回值，**永不作为授权依据**。页面用 `require*Context` 把公开 ID 解析成 scope，事务内仍重新复核成员关系。
- **只返回显式 DTO，不返回整行**。`GET /api/user` 只给 `{ id, name, email }`，绝不序列化整行 `auth.user`；SQL 文本、堆栈、驱动错误、密码哈希一律不出服务端。

---

## 3. 通道与代码落点

| 要找什么 | 去哪 |
| --- | --- |
| 页面入口与首屏取数 | `app/**/page.tsx`；scope 解析在 `lib/server/`、`lib/auth/context.ts` |
| 写操作清单 | `lib/<domain>/actions.ts`（`article` / `folder` / `lineage` / `org` / `project`）；认证域是目录 `lib/auth/actions/`，按主题分文件 |
| 入参校验 | `lib/auth/schemas.ts`（认证 / 组织 / 项目）、`lib/genealogy/schemas.ts`（家谱，文件名是历史原因） |
| 包装器与 `ActionState` | `lib/auth/middleware.ts`、`lib/auth/types.ts` |
| 事务编排 | `lib/<domain>/*-services.ts`、`lib/db/write.ts` 的 `withOrgWrite()` |
| 缓存失效 | `lib/console/revalidate.ts` 的 `revalidateWholeConsole()` |
| Route Handler | `app/api/**/route.ts`；统一包装在 `lib/api.ts` 的 `withApiLogging()` |
| 客户端读 | `lib/fetcher.ts` 的 `fetcher<T>()`、`lib/query-keys.ts` 的 key 工厂 |
| 错误模型 | `lib/errors.ts`（`ActionErrorCode`）、`lib/auth/errors.ts`（`mapAuthError`）、`lib/lineage/lineage-errors.ts`、谱文业务文案在 `lib/article/constants.ts` |
| 接口集成测试 | `tests/integration/api-auth.test.ts`、`tests/integration/media.test.ts`、`tests/action-channel.test.ts` |
| **契约正文** | `docs/contracts/` |

新增 Route Handler 的顺序：`withApiLogging` 导出 → `getSessionUser()`（未登录 401）→ Zod 校验路径参数与 body → 组织资源先 `getOrgRole`（非成员 403/404）→ 查询带 `orgId` → 返回显式 DTO → 补集成测试覆盖 401 / 403 / 404 / 成功。**不要复制 Server Action 的逻辑**，能复用查询就复用。

---

## 4. 错误怎么表达

只写形状，全集留给 `docs/contracts/`——同一个码表写两处必然漂移。

| 出口 | 形状 | 约定 |
| --- | --- | --- |
| Server Action | `ActionState`（`lib/auth/types.ts`） | 恒为返回值、**永不 throw**；`error` / `success` 是给用户的中文文案，`code` 是稳定机器码，`fieldErrors` 是字段级错误，成功时带内部 ID 供 UI 导航。**没有 `ok` 字段**，判断成败看 `error` 是否存在 |
| Route Handler | 英文 JSON + 显式状态码 | 非 2xx 形如 `{ "error": "Unauthorized" }`，需要机器码时加 `code`；`request_id` 进响应头与日志；未捕获异常由 `withApiLogging` 转成 JSON 500 而不是 HTML 错误页 |

三层原则：**Action 不 throw**（throw 会变成 500 错误页，UI 分不清「同名冲突」和「校验失败」）；**用户看中文、日志与客户端看机器码**；**不泄露内部细节**。用户可见文案只从 `ActionState.error` 取，不要把 `error.message` 或数据库错误直接展示。

---

## 5. 契约归属与变更规则

**唯一真相源**：`docs/contracts/`，按域分文件（Action 签名与权限、Route Handler 的 DTO 与状态码、错误码全集与前端映射）。本文件与 `docs/architecture.md` 都只指路。契约正文改动后跑 `pnpm docs:check --strict`。

| 变更 | 处理 |
| --- | --- |
| 新增可选入参 | 直接改，兼容 |
| 新增必填入参 | 禁止；改为可选 + 服务端默认值 |
| 删除 / 重命名字段 | 禁止直接删；先标废弃，两个版本后移除 |
| 修改 Action 语义 | 必须新开 Action，不改旧的 |
| 错误码语义变更 | 禁止；新增可以自由，但前端映射表要有兜底分支 |

内部接口**没有版本号**，契约由 TypeScript 类型保证，破坏性变更在编译期就会被发现。

---

## 6. 以代码为准

适用范围：本节只对 [现状] 成立；[目标] 以 `docs/data-model.md` 为准，裁决顺序见 `CONTRIBUTING.md` §2「权威口径」。

> 本文件**不写「当前有 N 个 Action / N 条 Route Handler」**。汇总数字会随代码变化，一旦在两处各写一遍就会打架；想知道数量，跑命令比读文档可靠。

| 想知道什么 | 以哪为准 |
| --- | --- |
| 有哪些 Route Handler | `find app/api -name route.ts` |
| 有哪些 Action、签名是什么 | `lib/*/actions.ts` 与 `lib/auth/actions/` 的 `export` |
| 错误码全集 | `lib/errors.ts` 的 `ActionErrorCode` |
| DTO 与状态码 | `docs/contracts/` |
| 某条契约有没有测试 | `tests/` |

改文档前先跑：

```bash
find app/api -name route.ts | sort
ls lib/*/actions.ts lib/auth/actions/*.ts
grep -n "ActionErrorCode" lib/errors.ts
```
