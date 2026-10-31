# 0013. Next.js 16 / React 19 运行层：首屏只查一遍，其余等实测

- **状态**：已接受
- **日期**：2026-10-28
- **可逆性**：双向门
- **相关**：[ADR 0008（只读 Route Handler）](./0008-read-only-route-handlers.md) · [ADR 0012（编译器开关：同一套「先测再改」）](./0012-typescript7-compiler-flags.md) · [10-24 架构评审 P1-8 / P1-9](../reviews/2026-10-24-linus-architecture-review.md) · [实现状态 §1](../implementation-status.md) · [setup §5](../setup.md)

## 背景

要求是「用 Linus 哲学优化 Next.js 16.4.3 + React 19.3.1」。和 [ADR 0012](./0012-typescript7-compiler-flags.md) 一样，先测再决定优化什么。测下来结论分两半：**一处确实在白烧的钱，和四件「看起来很该做、前提却不存在」的事。**

约束：本机 Playwright 跑不起来（`chrome-headless-shell` 缺 `libasound.so.2`），所以下面凡涉及浏览器内观测量的是库源码与 node 端实验，不是页面点数——这条限制写在《负面》里，不假装它不存在。

## 1. 实测

**客户端 JS**（起 production server，从 HTML 里取实际下发的 script 清单再量体积）：

| 路由 | script 数 | raw | gzip |
|---|---:|---:|---:|
| `/` | 14 | 643 KiB | 201 KiB |
| `/sign-in` | 14 | 652 KiB | 205 KiB |
| `/dashboard` | 14 | 652 KiB | 205 KiB |

`.next/static` 合计 1.6 MiB / 206 个 chunk。最大的一个 240 KiB 是 `@xyflow/react`（谱系画布），而它**不在上面任何路由的下发清单里**——Next 已经按路由把它切走了。

**渲染模式**：`pnpm build` 的 21 条路由**全部** `ƒ (Dynamic)`，`○ (Static)` 为 0；`prerender-manifest.json` 的 `routes` 只有 `/_global-error` 与 `/favicon.ico`，`dynamicRoutes` 为 0。原因是根布局读会话与组织列表（实现状态第 13 条）。

**缓存失效**：25 处写入 Action 全部调用 `revalidateWholeConsole()`；`lib/lineage/revalidate.ts` 里按子树收窄的两个 helper **零调用者**。

**首屏重复查询**（关键的一条，node 端直接驱动 `QueryObserver` 复现）：

```
refetchOnMount='always'  | 已 hydrate 数据 isStaleByTime(30_000)=false | queryFn 调用 1 次
refetchOnMount 未设置      | 同上                                        | queryFn 调用 0 次，data 保持服务端那份
```

`app/layout.tsx:41-42` 已经把 `queryKeys.user` 与 `queryKeys.orgs` 塞进 dehydrated state，而 `components/console/console-scope.tsx:50` 与 `hooks/use-session-user.ts:12` 各自写着 `refetchOnMount: 'always'`。按 query-core 的 `shouldFetchOn`，`'always'` 会**绕过新鲜度判断**直接重拉——于是每次硬加载控制台，`/api/user` 与 `/api/orgs` 各打一遍，而这两个 handler 又各自跑一遍 `lib/db/queries` 里同一个函数。兄弟查询 `useConsoleProjects` 从来没有这个 flag，说明它不是策略，是遗留。

## 决策

1. **删掉那两处 `refetchOnMount: 'always'`**：首屏数据以 RSC `dehydrate` 为唯一来源，新鲜度交给客户端唯一的 `staleTime: 30_000` 策略；三个查询 key 从此走同一条规则。`components/query-provider.tsx` 的 `createQueryClient` 改为导出，新增 `tests/first-paint-data.test.ts` 用**同一个工厂**锁住这套语义（含一例源码守卫：任何 hook 里出现 `refetchOnMount` 就红）。
2. **不加 `next/dynamic`、不做 bundle 瘦身**：证据是 §1——重库已经按路由切分，公开路由 201 KiB gzip 基本就是 React + Next 运行时的底。手工分包在这里没有对象可分。
3. **不把 `/` 静态化**（10-24 评审 P1-9 的那条验收标准「`/` 标为 `○ (Static)`」本轮**判为不做**）：让营销页动态的正是「读会话与组织列表」这个设计选择，而按 [架构总览](../architecture/01-架构总览.md) 的边界，M1 没有匿名业务数据页、分享页或公开 API。静态化要先拆根布局的会话读取，换来的是一个**没有观众的页面**少一次渲染。等真的有公开入口再说。
4. **不接线 scoped `revalidateProject` / `revalidateOrg`**（P1-8 从「已在产生成本的债务」降级）：没有任何预渲染路由，就没有「整树失效」能炸掉的服务端 HTML 缓存；整树失效的代价落在客户端 Router Cache（下次导航重取 RSC payload），而写入后本来就该重取。本轮只把**说法**改对：`lib/lineage/revalidate.ts` 文档注释重写成现状、`tests/revalidate-paths.test.ts` 改成描述真实调用图并钉住「scoped helper 尚未接线」、实现状态第 14 条与 `docs/api.md` 的代码样例改正（样例里的 `revalidateProject()` 是无参旧签名，照抄不能编译）。
5. **不动画布的 `computedNodes`**：`genealogy-canvas.tsx` 的那个 memo 依赖里确实有 `lineage-detail.tsx:660-678` 传下来的行内箭头，但同一个依赖里还有 `selectedNodeId`——每个节点的 `data.isSelected` 就是从它算的，所以「选中即重建整个节点数组」是**构造性的**，不是引用稳定性造成的。把箭头换成 `useCallback` 不会改变这一点。而单次重建的真实代价取决于人丁数量，本仓库连「谱系规模 < 5000 节点」这个假设都还没测（10-25 评审 §9）。

## 后果

### 正面

- 每次硬加载控制台少 2 个 HTTP 往返与它们各自的查询；RSC 首屏注入这个既有设计第一次真正成为唯一来源。
- 首屏策略变成可执行的约束（`tests/first-paint-data.test.ts`），不再靠约定。
- 两份文档不再描述不存在的代码，且新增的测试会在「文档再次声称已收窄」时先红。
- 两条被当作债务挂着的技术栈条目（P1-8、P1-9）各自拿到「为什么现在不做」的证据。

### 负面（必须诚实写）

1. **「少 2 个请求」没有在浏览器里数过。** 它来自 query-core `shouldFetchOn` 的源码语义 + node 端 `QueryObserver` 实验；本机 Chromium 缺 `libasound.so.2`，`pnpm test:e2e` 全量跑不起来。补数前，这条是推导而非观测。
2. 未测 `revalidatePath` 整树失效的导航代价（同样需要浏览器观察 Router Cache 命中）。
3. `staleTime: 30_000` 现在同时是「跨标签页/协作变更」的最大可见延迟；org 列表与会话名在别的会话被改动后，本标签页最长 30 秒才自发对齐（`refetchOnWindowFocus` 默认真 + 挂载时过期判断仍生效）。写这条时它已经是既有策略，本轮只是把它推广到三个 key 而不是两个。
4. **已知真 bug 本轮未修**：`components/project/project-workspace.tsx:44-76` 的 `DeleteProjectButton` 既无 `invalidateQueries` 也无 `router.refresh()`，删掉的项目在选择器里滞留到 30 秒后才 404。10-27 计划已确认并移交为独立 fix；没有浏览器就无法验证交互结果，所以不在本轮夹带。
5. 画布「选中即重建」的代价仍未量化，本文只是拒绝在没有数据时改它。

### 中性

`tsconfig` 未变；`next.config.ts` 未变；新增导出 1 个（`createQueryClient`），删除 2 行选项，业务代码 0 行改动。

## 放弃的方案

- **给三个 key 分别设 `staleTime` / 用 `staleTime: 'static'`**：策略散到调用点，正是本次要消掉的那类重复。
- **把 `refetchOnMount: 'always'` 换成 `refetchOnWindowFocus: 'always'`**：同样绕过新鲜度，只是换个触发时机。
- **拆掉根布局的会话读取以静态化 `/`**：为一个没有观众的页面重排认证链路，方向反了。
- **顺手接上 scoped revalidate（ widening 12 个 Zod schema + 六个对话框）**：前提（服务端有缓存可保）不存在，却要在同一个 PR 里动接口契约。
- **手工 `next/dynamic` 分包**：没有可分的对象。

## 重估触发条件

- 装好 Chromium（`libasound.so.2`）→ 立刻用浏览器点数，验证《负面》第 1 条，并顺手修掉第 4 条那条真 bug。
- 启用 `cacheComponents` / `use cache` / PPR，或任何路由变成 `○ (Static)` → §1 的「没有服务端缓存可炸」前提失效，**P1-8 立刻升回优先级**，接线 scoped 失效。
- 出现匿名可访问页（分享、公开谱书）→ 重开 P1-9 静态化。
- 真实谱系规模分布测出来了（`lineage.node_count`）→ 再决定画布 memo 是否值得重构；在此之前不要凭感觉动。
- 跨标签页协作出现真实投诉（别人改了组织列表，我这 30 秒看不到）→ 重议 `staleTime`，而不是重新塞回 `refetchOnMount`。
