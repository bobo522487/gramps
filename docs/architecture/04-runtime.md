# 运行时视图与前端架构

> **回答什么问题**：一次读/写请求怎么走？前端怎么渲染？状态放在哪？画布为什么这么设计？
> **读者**：开发　**长度上限**：4 页
> **来源**：原 `architect.md` §5 · §6（编号保持不变）
> **目标 vs 现状**：本文描述目标架构。差异见 [实现状态](../implementation-status.md)。

---

## 5. 运行时视图

### 5.1 读请求（RSC）

```
GET /{orgSlug}/{projectRef}/lineages/{lineageId}
  │
  ├─ proxy.ts           验签会话 Cookie，剩余 < 6h 时滑动续期
  ├─ [orgSlug]/layout  解析组织 → 查 organization_member → 注入 OrgContext
  ├─ [projectRef]/layout  解析项目（组织内）
  ├─ page.tsx          lineageQuery.getGraph(ctx, lineageId)
  │     └─ withOrg()   SET LOCAL ROLE app_rw + 注入 claims
  │           └─ repo  SELECT ... WHERE organization_id = $1（RLS 兜底）
  └─ RSC 直出 HTML（首屏数据作为 TanStack Query 的 initialData）
```

**首屏不发起客户端数据请求**。页面数据由 RSC 在服务端读取完成，并以 `initialData` 或 `dehydrate` + `HydrationBoundary` 注入 TanStack Query 缓存；交互工作区需要刷新或失效时，由 TanStack Query 的 `queryFn` 调用服务端读函数，不新增 REST 读接口。

**读路径的两条性能约束**（设计意图，非现状）：

| 约束 | 为什么 |
|---|---|
| 一次页面渲染只开**一个事务** | `withOrg` 每开一次事务至少 4 个往返（BEGIN / SET LOCAL ROLE / `set_config` / 查询 / COMMIT）。多个查询各开事务会让 TTFB 随查询数线性膨胀，且跨快照读会让 `node_count` 与节点列表不一致 |
| 上下文解析合并为**一次查询** | 会话校验、成员关系、项目 scope 本质是同一个 join。分三次查是三个往返换零收益 |

具体做法见 [guides/add-a-feature](../guides/add-a-feature.md) 的「读路径」一节。

### 5.2 写请求（Server Action）

```
用户提交表单
  │
  ├─ action.ts        Zod 校验 → 得到 input
  ├─ requireOrgContext(orgSlug)   未登录 401 / 非成员 404
  ├─ assertPermission(ctx, 'xxx.write')
  ├─ withOrg(ctx, tx => ...)
  │    └─ xxxService.xxx(tx, ctx, input)      业务
  ├─ revalidateTag(`lineage:${id}`)
  └─ return { ok: true, data }       失败返回 { ok: false, error }
```

M1 只有两步：**业务 → 失效缓存**。M2 引入编辑锁后，前面会插入「锁校验」一步。

M1 **不写审计表**：关键业务动作写结构化日志，作为运维追溯入口（[data-model §9](../data-model.md#9-审计与追溯)）。

### 5.3 组织解析

URL 是组织的唯一来源。

```typescript
export async function requireOrgContext(orgSlug: string): Promise<OrgContext> {
  // 验签 JWT → auth.get_session_user(sub)：校验 token_version 与 deleted_at
  const user = await requireUser();

  const membership = await withOrg({ userId: user.id }, (tx) =>
    orgMemberQuery.findByOrgSlug(tx, user.id, orgSlug),
  );
  if (!membership) throw new NotFoundError('organization', orgSlug);

  return {
    userId: user.id,
    organizationId: membership.organizationId,
    organizationSlug: orgSlug,
    role: membership.role,
  };
}
```

| 特性 | 说明 |
|---|---|
| 无状态 | 不存 Cookie、不存 session 变量。多标签页天然一致 |
| 可分享 | 链接发给同事，对方看到的组织与发送者一致 |
| 切换成本 | 切换组织 = 点一个 `<Link>`，无 Action、无 `revalidate` |
| 失败语义 | 非成员返回 **404** 而不是 403，避免泄露组织是否存在 |

项目上下文由 `requireProjectContext(orgSlug, projectRef)` 解析：先得到 `OrgContext`，再在 `withOrg` 内按 `project.ref = projectRef` 查询；非成员或项目不存在都返回 404。返回值携带内部 `projectId`；`ref` 只用于路由，Action 一律使用 `projectId`。

### 5.4 注册与默认组织

注册由应用层发起、数据落在自建 `auth.users`，组织创建必须放在**数据库触发器**里，这是唯一能保证「有账号必有组织」的位置。

```
用户提交邮箱密码
  │
  ├─ Zod 校验 + bcrypt 哈希
  ├─ auth.sign_up()                     SECURITY DEFINER 函数
  │    └─ INSERT INTO auth.users
  ├─ 触发器 handle_new_user()          ← 同一事务
  │    ├─ INSERT organization（slug 由 public.generate_public_id() 默认生成）
  │    └─ INSERT organization_member（role = owner）
  ├─ 立即签发 JWT、写 session Cookie
  └─ 直接进入 /{默认组织 slug}
```

| 关注点 | 处理 |
|---|---|
| 原子性 | 触发器与 `auth.users` 插入在同一事务。组织建失败 → 注册失败，不产生半残账号 |
| 绕过 RLS | 触发器函数是 `SECURITY DEFINER`，属主为迁移/超级用户，可写受 RLS 保护的表 |
| `search_path` | 函数上强制 `SET search_path = public`，防注入 |
| 幂等 | 一个 `auth.users` 行只触发一次 |
| 可改 | 组织名可由 owner 修改；`slug` 是随机公开 ID，不可修改（FR-ORG-7） |
| 无验证邮件 | 注册成功即登录；不存在「等待验证」状态 |

详见 [data-model §4.4](../data-model.md#44-注册触发器默认组织)。

### 5.5 并发编辑（M1 不做保护）

M1 **没有编辑锁**。两个用户同时打开同一谱系并保存，后提交的覆盖先提交的。

```
T0  用户 A 打开谱系，载入节点 #5 的姓名「元英」
T1  用户 B 打开谱系，把 #5 的姓名改成「元瑛」并保存
T2  用户 A 把 #5 的生卒年填上并保存 → 提交的是整行，姓名被写回「元英」
T3  结果：B 的修改丢失
```

| 阶段 | 机制 |
|---|---|
| M1 | 无保护。UI 提示「建议一人编辑完再换人」 |
| M2 | 资源锁（`resource_lock` + fencing token），编辑期独占 |
| 触发提前 | 客户反馈覆盖问题影响使用时，把锁提前到 M2 首批 |

这是 PRD §6.3 的缺口 3，是**已知并接受**的风险，不是遗漏。决策记录见 [ADR-0002](../decisions/0002-no-edit-lock.md)。

---

## 6. 前端架构

### 6.1 渲染策略

| 页面类型 | 策略 | 理由 |
|---|---|---|
| 登录 / 邀请接受 | SSR（动态） | 需要会话 |
| 内部页面 | RSC 动态渲染 | 数据强一致，无 loading 闪烁 |
| 谱系画布 | 客户端组件 + TanStack Query 缓存 | 需要交互与视口计算；首屏数据由 RSC 注入 |

M1 **没有公开页面**（没有落地页、定价页、分享页），所以不需要 SSG/CDN 与「公开页 + 缓存头」这一层设计。这些页面最早在 M2 引入分享时再补。

### 6.2 状态管理

| 状态类型 | 方案 |
|---|---|
| 服务端数据（首屏） | RSC 直接读取并直出，以 `initialData` 或 `dehydrate` / `HydrationBoundary` 注入 TanStack Query，并设置 `staleTime` / `initialDataUpdatedAt` 避免水合后立即重取 |
| 服务端数据（客户端缓存） | TanStack Query：统一 `queryKey`；`queryFn` 调用只读 Route Handler，`mutationFn` 调用 Server Action；写后 `invalidateQueries` 或精确更新缓存，禁止组件内手写 `fetch` |
| 表单 | React Hook Form + Zod |
| 乐观更新 | TanStack Query mutation 的 `onMutate` / `onError` / `onSettled`（仅用于排序、改名等可回滚操作） |
| 画布视口 | React Flow 内部管理；工作区 UI 状态入 Zustand |
| 全局 UI 状态 | 谱系工作区使用 Zustand：仅客户端、仅 UI 状态（视图、选中、折叠、搜索、筛选、渲染窗口、侧栏宽度），不存数据库实体、不做持久化；其余场景不引入 Redux/Jotai |
| 数据边界 | TanStack Query 只缓存服务端数据，Zustand 只存本地 UI 状态；同一实体不得同时维护两份可写副本 |

TanStack Query 是客户端缓存层，不改变「RSC 首屏直读 + Server Action 写入」的边界，也不为它新增 REST 读接口。Zustand 不保存谱系/人丁实体，实体数据始终以 TanStack Query 缓存和 Server Action 结果为准。`queryKey` 统一由 `lib/query-keys.ts` 的 `queryKeys` 工厂生成（如 `queryKeys.projects(orgId)`），禁止在组件内拼字符串。

两套缓存各司其职：RSC 侧继续用 `revalidateTag` / `revalidatePath` 失效服务端渲染缓存，客户端用 `invalidateQueries` 失效 TanStack Query 缓存；同一次写操作后按需同时触发。

> **三次失效机制的代价**：`revalidateTag` + `invalidateQueries` + 组件内局部状态更新，一个写操作最多要维护三处。建议在 `lib/query-keys.ts` 旁增加一份 **tag ↔ queryKey 对照表**，让「写 X 之后要失效哪些」成为一处可查的映射，而不是散落在 30 个 Action 里。

### 6.3 谱系画布

| 关注点 | 方案 |
|---|---|
| 渲染 | `@xyflow/react`（React Flow）受控画布 |
| 布局 | 自定义 `book_ltr` 欧式书本布局（左→右世代列、世代表头、正交父子线）；**不做卡片树、union 节点或 ELK/dagre 自动排版** |
| 大数据 | `onlyRenderVisibleElements` + 横向渲染窗口：超过 500 人时首屏 5 世，向右平移或点按钮每次追加 5 世 |
| 节点组件 | 自绘书本节点，不用 React Flow 默认节点；配偶在节点内以「配 王氏」小字展示，完整管理走右侧检查器 |
| 连线 | 自定义正交边（方形线帽）；拖拽连线可改父，坐标始终由布局计算、不持久化 |
| 状态同步 | 谱系/人丁数据由 RSC 首屏注入 TanStack Query 缓存；视图/选中/折叠/搜索/筛选/渲染窗口由 Zustand store 管理；画布不持有数据库实体，也不维护第二份服务端数据源。写操作经 Server Action 后失效对应 `queryKey` |

**布局为什么在 React Flow 之外算**：React Flow 的定位是「交互 + 渲染」。布局由纯函数 `components/lineage/canvas/layout/book-ltr.ts` 计算，输入是谱系索引、折叠集合、世代上限与字辈，输出节点/边/总尺寸，便于单测和替换。

> **渲染窗口 ≠ 传输窗口**：上表的「按代渲染」只减少 DOM 与绘制，不减少传输与内存。若一次读取整个谱系（数千至数万人丁），浏览器端仍需持有全部节点对象，帧率与内存都会随规模崩塌。**按代加载必须在服务端也生效**（按 `depth` 取窗口），见 [07-quality](./07-quality.md) 与 [08-evolution](./08-evolution.md) 风险 R17。

### 6.4 组件分层

```
components/
├── ui/            基础组件（Button / Input / Dialog），来自 shadcn/ui
├── form/          表单域组件，绑定 RHF
├── layout/        页面骨架、侧栏、面包屑
└── domain/        领域组件（LineageCanvas、NodeCard、CatalogTree）
```

`components/ui` 之外不允许直接写 Tailwind 原子类拼组件——先看 `ui/` 里有没有。
