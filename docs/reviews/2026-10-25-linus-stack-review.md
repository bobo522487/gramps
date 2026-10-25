# 用 Linus 的尺子看技术栈选型

> **评审对象**：`package.json` / `pnpm-lock.yaml` 的依赖面、`tsconfig.json`、`biome.json`、`next.config.ts`、`lib/db/*` 的驱动与连接、`lib/auth/rate-limit.ts`、`docs/architecture/*` 与 `docs/decisions/*` 里的选型口径
> **评审日期**：2026-10-25　**评审基线**：`bba78ac`（最新稳定版本升级完成之后）
> **性质**：评审记录，**不是规范**。按 [`docs/README.md`](../README.md) §5.1（决策只进 `docs/decisions/`），本文的结论在转成 ADR 之前不具备约束力；本次已落地的部分见 [ADR 0009](../decisions/0009-dependency-and-runtime-stance.md)。
> **与 [2026-10-24 评审](./2026-10-24-linus-architecture-review.md) 的关系**：那份评审的是**应用层与数据层**（复合外键、事务、重复代码、文档漂移）。本文**只评"选了什么"，不评"写得对不对"**；不重复其编号，引用处标 `[10-24 P0-1]` 之类。
> **方法**：仍然只问四件事——这张牌消灭了哪些特殊分支？它编码了什么不变式？这条约束有没有东西在执行它？删掉什么会比加上什么更有效？

---

## 0. 结论

**升级是对的，但大部分升级是装饰；真正的问题不在版本号，在四条没有执行者的选型。**

| | 判断 |
|---|---|
| 依赖版本面 | **37 个直接依赖、27 个精确版本号、0 条被 CI 断言**。`lucide-react` 0.x→1.x、`radix-ui` 1.4→1.8 不改变任何设计决策；值钱的只有 TypeScript 7 的 Go 原生编译器（检查从"排队"变成"随时可跑"）和 Zod 4 的 `z.uuid()` 收紧（`[10-24]` 的 P0-1 方案依赖它） |
| ORM（Drizzle） | **全仓最大的单点风险，而且 21 条决策里没有一条管它。** `^0.45.4` 是 1.0 之前最后一个 0.x，断崖式重写就在拐角，而仓库有 28 个文件直接 import 它 |
| 富文本 / 谱文 | **选型完全空白。** ADR-12 定了"ProseMirror JSON"这个结论，但 `package.json` 里一个编辑器依赖都没有；PRD 只要求标题/加粗/列表/引用/表格，而头部方案是 1.0 之前、每周三更、依赖树 30+ 包的编辑器框架 |
| 表单 | **文档承诺了不存在的依赖。** `04-runtime §6.2` 写"React Hook Form + Zod"，`package.json` 没有 RHF，11 个文件在手搓 `useActionState`；而 FR 里迟迟做不出的"自定义字段"和"编目三栏"，恰恰卡在"表单模型是扁平的"这件事上 |
| 托管形态 | **Vercel + Neon 选对了，但它在约束栈里最贵的一件东西——运行时上限——被两处设计当成不存在**：M3 PDF 排版（`08-evolution:28,30`、`0005:47`）和登录限流（进程内 Map，`lib/auth/rate-limit.ts:1-4`） |
| 已有索引 | **`pg_trgm` 是对的，但没接线**：`searchNodes` 有实现、有 GIN 索引、没有页面调用（`lib/db/queries/nodes.ts:33`）。选型上"选了"不等于"生效" |

一句话：**这轮升级解决的是"版本旧"，没解决"选型有没有执行者"。下一件该做的事不是再升一个包，是把四条已经选对的东西接上电，把四条选错或没选的东西定下来。**

### 0.1 六条要点

1. **TypeScript 7 是这轮唯一产生结构性收益的升级。** 一个能随时跑的 `tsc` 是 `[10-24]` P0/P1 那些补丁的前提条件（改 5 个入口重算树、给 14 处 `requireLineageWrite` 收敛模板，每次都靠它兜底），但它目前只被当成"版本号"写进文档。
2. **`drizzle-orm` 是这里最像"高风险实验"的依赖，而它是全仓最不缺使用的依赖。** 1–3 人、百级组织的项目应该站在老技术那一边；正确的做法是把 `^0.45.4` 钉死，并给 1.0 单独立项，而不是让它跟着 `pnpm update` 自己走。
3. **谱文这一步选错，改起来要付排版重排的代价**（和 ADR-0003 同一个数量级的单向门）。现在什么都没装，是**最后一次能便宜决策的机会**。
4. **"零后台任务"（ADR-0005）和"M3 排版是独立进程"（ADR-16）是两条互相看不见的决策。** 前者说"任何异步重活都做不到"，后者说"到 M3 再说"——它们应该合成一条关于**第二个运行时**的边界决策。
5. **限流是这四条里唯一"写了将来要换、从没换过、也没人知道它不生效"的一条。** 注释里写着"多实例时换 Redis，接口不变"，而它在 Vercel 上按实例存活，重启清零。
6. **仓库的"决策地图"缺一整类：运行时与依赖立场。** 21 条决策里有树、软删、锁、RLS、驱动、部署，唯独没有"允许多少依赖""ORM 什么版本策略""什么时候允许第二个运行时"。缺这一层的直接后果是 §3 的 S0-1、S0-2、S0-3 都没人管。

---

## 1. 尺子

Linus 的原则换到"技术栈选型"上，就是下面七条。本文每条结论都必须落在这张表上。

| # | 原则 | 本仓库的检查项 | 本次命中 |
|---|---|---|---|
| L1 | **数据结构优先** | 选一个库，是不是在替我们编码一个不变式？（`z.uuid()` 编码 RFC 9562，`next-themes` 只编码一个 class 开关） | 装饰性升级 vs 结构性升级（§4.1） |
| L2 | **好品味 = 消除特例** | 同一个库被用在哪里都一样吗？两个连接、两份驱动、两种 dotenv 是不是必要的特例 | `lib/db` 的双单例与双驱动分叉（S0-4） |
| L3 | **复杂即敌** | 一个目的用了几套机制 | 数据访问有 `drizzle-orm` 直连 + `lib/db/queries` 两层约定但没有执行者（S0-2） |
| L4 | **老技术够不够好** | 这个依赖的"新"是卖点还是风险？ | Drizzle 0.x 边缘（S0-2）；编辑器框架（S1-1） |
| L5 | **让约束可执行** | 选型的约束有 lint / CI / 迁移 / 测试在执行吗 | 0 条依赖方向 lint、0 条版本断言（S0-1） |
| L6 | **一处改动足够** | 换掉这个依赖要改几个文件 | `drizzle-orm` 28 个文件；`dotenv` 5 处 |
| L7 | **文档与代码同一份事实** | 文档列的库是不是真的在 `package.json` 里 | RHF 漂移（S3-1） |

**不评审**：视觉细节、无障碍、产品定价、UI 审美。这些和选型无关。

---

## 2. 不要动（先划保护线）

批评容易误伤。下面这些是这轮选型里真正想清楚的地方，下一个功能之前不要以"重构"或"升级"的名义碰。

| # | 决策 | 为什么它是对的 |
|---|---|---|
| 1 | **PostgreSQL 18 + 原生 `uuidv7()`** | 主键在库里生成，应用不生成、不重试、不猜；UUIDv7 的时间有序让索引写入局部化。这是 ADR-14 的单向门，和 ADR-0001 绑定，别动 |
| 2 | **`withOrg` 里 `SET LOCAL ROLE app_rw` + `set_config(claims)`** | `[10-24]` 保护线第 4 条已认可；选型维度上它意味着"Drizzle 的 `transaction()` 是我们能拿到的最合适的原语"，不要为了换 ORM 丢掉它 |
| 3 | **本地 `postgres.js` / 生产 `pg` + `attachDatabasePool` 双驱动**（ADR-19） | 本地追求 API 简洁与 prepared statements；生产追求 Vercel 官方的连接生命周期管理。**这不是重复建设，是两种运行时的真实差别**。要修的是分叉的写法（S0-4），不是分叉本身 |
| 4 | **Better Auth 自托管、不暴露 `/api/auth/*`**（ADR-17/0007） | 认证写入口收敛成 Server Action，"最后一个 owner / 管理员边界 / 活动日志"只有一个地方管。别为了"标准化"再引一个 IdP |
| 5 | **只读 Route Handler 保留**（ADR-08） | 读刷新可缓存、可预取、可按路由算 p95；写仍然只有 Server Action |
| 6 | **Zustand 只存谱系工作区 UI 状态，不存实体、不持久化**（ADR-21） | `components/lineage/lineage-store.ts` 的 20 个字段全是 UI 状态，边界干净。不要让它变成第二个数据源 |
| 7 | **`@xyflow/react` + 布局在 React Flow 之外算**（`book-ltr.ts` 纯函数） | 这是画布能长期维护的唯一原因。**不要换成自绘 canvas / WebGL / D3**——那是"自己写布局引擎"的另一种说法 |
| 8 | **TanStack Query 只做服务端数据缓存，RSC 首屏直读** | 两套缓存各司其职，且已经有 `revalidatePath` + `invalidateQueries` 两处维护（`[10-24]` P1-8 的收敛不在本文范围）。不要加 SWR、不要加第三套 |
| 9 | **Biome 而不是 ESLint + Prettier** | 一个工具、一份配置、一个二进制。`noRestrictedImports` 在 Biome 2.6.3 里已从 nursery 毕业到 `style`（实测 `biome explain` 确认），"Biome 做不到架构 lint"这个借口现在不成立了 |
| 10 | **零常驻进程**（ADR-0005 的精神，不是它的字面） | "没有 worker 挂了但应用还活着"这种半故障状态是 1–3 人团队承担不起的。要破的是"零后台任务"这句绝对化的表述，不是这条原则 |

---

## 3. 问题总表

优先级：**S0** = 结构性，现在就在交税 · **S1** = 下一个功能之前必须定 · **S2** = 记录，随手清理 · **S3** = 文档。

| # | 级别 | 结论 | 证据 |
|---|---|---|---|
| S0-1 | S0 | 选型的约束**零执行**：没有一条依赖方向 lint，没有一条版本断言；48 个精确版本号和 3 个 `^` 混在一起也没人管 | `biome.json`（无 `noRestrictedImports`）；`package.json` |
| S0-2 | S0 | **`drizzle-orm` 是全仓最大的单点风险，却不在决策地图里**：`^0.45.4`、28 个文件直接 import、1.0 RC 在即 | `package.json`；`grep -rln "from 'drizzle-orm"` = 28 |
| S0-3 | S0 | **"零后台任务"与"M3 独立进程"是两条互相看不见的决策**，把"第二个运行时"这件最贵的选型推到了未来 | `0005:47`；`08-evolution:16,28` |
| S0-4 | S0 | **两个 DB 单例各自 `dotenv config()`、各自复制 `process.env.VERCEL` 分支与 `attachDatabasePool`**；`db` 是 Proxy，每次属性访问调三次 `getDb()` | `lib/db/drizzle.ts:3-4,29-33,52-56`；`lib/db/auth-db.ts:3-4,26,33-39` |
| S1-1 | S1 | **富文本/谱文选型空白**：ADR-12 定了 ProseMirror JSON，但没有任何编辑器依赖；PRD 只要求 5 种块级排版 | `prd.md:215-225`；`package.json`（无 tiptap/prosemirror/lexical） |
| S1-2 | S1 | **表单栈是文档虚构的**：RHF 不在依赖里，11 个文件手写 `useActionState` + `Object.fromEntries(formData)`；扁平表单模型挡住自定义字段与编目树 | `04-runtime.md:153`；`lib/auth/middleware.ts:24-38` |
| S1-3 | S1 | **限流是进程内 Map，实现注释自己承诺"多实例换 Redis"**；`x-forwarded-for` 可伪造 | `lib/auth/rate-limit.ts:1-4,21-43,53-77` |
| S1-4 | S1 | **选对了索引但没接线**：`pg_trgm` + GIN 已建，`searchNodes` 有实现，页面不调用，浏览器端 O(n) 搜索 | `lib/db/queries/nodes.ts:33-56`；`0001_auth_rls.sql` |
| S2-1 | S2 | 依赖版本写法不一致：37 个直接依赖里 27 个精确、10 个带 `^`；**但不建议改动**——钉死 specifier 会因 `minimumReleaseAge` 策略导致冻结安装失败（见 §4 S0-2 实测） | `package.json`；`pnpm install --frozen-lockfile` |
| S2-2 | S2 | `dotenv` 在 `lib/db/*` 里作为模块副作用被调用，并且被 `tests/helpers/*` 与 `scripts/*` 各复制一遍；配置加载路径散在 5 处 | `lib/db/drizzle.ts:4,17`、`lib/db/auth-db.ts:4,16` |
| S2-3 | S2 | 两份 `drizzle-orm` 适配器（`postgres-js` / `node-postgres`）的类型用一个 `as unknown as Db` 断言抹平 | `lib/db/drizzle.ts:35-36`；`lib/db/auth-db.ts:45-49` |
| S2-4 | S2 | `next-themes` 只服务一个 class 开关，属于"装了但其实手写 5 行也能做"的依赖 | `components/theme-provider.tsx`、`components/theme-toggle.tsx` |
| S3-1 | S3 | **文档列的库不存在**：`04-runtime §6.2` 的 "React Hook Form + Zod" | `04-runtime.md:153` |
| S3-2 | S3 | **文档还留 `src/modules` 的第二种说法**（ADR-01 已定 `lib/<domain>`） | `03-components.md:74-81` 的依赖表以"待接入"描述执行者 |
| S3-3 | S3 | **决策索引缺"Drizzle / ORM 版本策略"与"依赖数量"两类**，直接导致 S0-2 无人负责 | `decisions/README.md`（21 条，无 ORM 条） |
| S3-4 | S3 | 版本号在 `implementation-status.md §1`、`AGENTS.md §1`、`package.json` 三处手抄；现有 `tests/docs-consistency.test.ts` 只断言 Next/React/TypeScript 三项，Drizzle 只比到 minor | `tests/docs-consistency.test.ts:82-119` |

---

## 4. S0 详述

### S0-1 选型的约束零执行

**事实**

37 个直接依赖里，27 个精确、10 个带 `^`，全部靠"人记得同步"活着。CI 跑 `pnpm check`、`pnpm typecheck`、`pnpm test`、迁移漂移、`build`、E2E、`verify:deploy`，**没有一条检查"这个库的用法是否越界"或"文档里的版本是否和 `package.json` 一致"**。

`biome.json` 里没有任何 `overrides`：

```json
// biome.json（现状）
"linter": {
  "rules": {
    "preset": "recommended",
    "style": { "noNonNullAssertion": "off" },
    "suspicious": { "noExplicitAny": "warn" }
  }
}
```

而 `docs/architecture/03-components.md:74-81` 自己列了四条依赖规则，并承认"`noRestrictedImports` 尚未配置，在 lint 接入前，表中规则靠评审执行"。

**为什么这是 S0**

这不是"少一条 lint"的问题，是**选型的约束在结构上不可执行**：

- `drizzle-orm` 被 28 个文件直接 import（§4.2），"换驱动只改一处"这句话在代码库里是假的；
- `lib/db/drizzle.ts`、`lib/db/auth-db.ts` 之外能不能建连接？没有规则，只能靠评审；
- `components/` 里能不能碰数据库？`server-only` 是运行时兜底（构建期抛错），比 lint 晚一步。

`[10-24] P1-12` 提过这件事并给了 `nursery.noRestrictedImports` 的配置草案。**本次复核发现 Biome 2.6.3 里这条规则已经在 `style` 组**（`biome explain noRestrictedImports` → `Available from version: 1.6.0`，`Diagnostic category: lint/style/noRestrictedImports`），所以可以按正式规则配，不必用 nursery。

**补丁**

```jsonc
// biome.json —— 只列真正会犯、且现在能配的规则
"overrides": [
  {
    "includes": ["components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
    "linter": { "rules": { "style": { "noRestrictedImports": {
      "level": "error",
      "options": {
        "paths": {
          "drizzle-orm": "客户端组件不得直接依赖 ORM；数据访问走 lib/db/queries",
          "@/lib/db/drizzle": "客户端组件不得访问数据库",
          "@/lib/db/auth-db": "认证连接只属于 server",
          "@/lib/db/schema": "客户端组件不得 import 数据库 schema"
        }
      }
    }}}}
  },
  {
    "includes": ["lib/db/queries/**/*.ts"],
    "linter": { "rules": { "style": { "noRestrictedImports": {
      "level": "error",
      "options": {
        "patterns": [
          { "group": ["@/lib/*/actions", "@/lib/*/actions"], "message": "查询层不得依赖 Action 层" }
        ]
      }
    }}}}
  }
]
```

**预期**：第二条很可能立刻红（现有 `lib/db/queries/*` 没 import actions，应该能过）；第一条会拦下 `components/lineage/*` 里可能的 `@/lib/db/schema` 类型 import——这正是目的。**先跑 `pnpm check` 看拦下了什么，把清单写进补丁序列，不要一次性大改。**

**成本**：配置 30 分钟；修现有违规看清单，半天以内。

---

### S0-2 Drizzle：全仓最大的单点风险，却不在决策地图里

**事实**

```json
// package.json
"drizzle-orm": "^0.45.4",
"drizzle-kit": "^0.31.11",
```

`docs/decisions/README.md` 的 21 条决策里，涉及数据库的只有：

| ADR | 主题 |
|---|---|
| ADR-06 | 隔离机制（RLS + WHERE + 复合外键） |
| ADR-14 | 主键（UUIDv7） |
| ADR-19 | 数据库驱动（本地 `postgres.js` / 生产 `pg`） |

**没有一条决策管"ORM 是谁、什么版本策略、升级由谁拍板"。**

使用面（本次实测）：

```bash
$ grep -rln "from 'drizzle-orm" --include=*.ts --include=*.tsx app components lib hooks tests | wc -l
28
$ grep -rn "from 'drizzle-orm" --include=*.ts --include=*.tsx app components lib hooks tests | wc -l
34
```

**为什么这是 S0**

1. **这是单向门，而且已经进场了。** Drizzle 1.0 在 RC 阶段，1.0 是断崖式重写——不是 patch，是写法的变化。现在 `^0.45.4` 意味着任何一次 `pnpm update` 都可能把它带进一个与仓库现有写法不兼容的 minor。
2. **迁移工具与应用运行时是同一个生态的两半**：`drizzle-kit` 生成 SQL、`drizzle-orm` 执行 SQL。`drizzle-kit` 在 `0.31.x`，`drizzle-orm` 在 `0.45.x`，两条版本线各自演进；升级必须一起做，而现在没有任何东西提醒它们要一起动。
3. **`lib/db/migrations/` 里 7 个迁移文件（含 `drizzle-kit` 生成的 2 个），CI 有漂移检查**（`pnpm db:generate && git status --porcelain lib/db/migrations`）。这是唯一在执行的约束，够用但只覆盖了"schema 与迁移目录一致"，不覆盖"ORM 版本能不能换"。

**对照**：这个项目选择站在"老技术"这一边的地方很多——PostgreSQL 而不是 Mongo、UUIDv7 而不是 objectid、`ltree` 而不是再引一个图数据库、Biome 而不是 ESLint+Prettier。**唯独在 ORM 上跟着漂**，是因为它没被写进决策地图。

**补丁（其中第 1 条经实测否决，见下）**

1. ~~`package.json` 把 `drizzle-orm` / `drizzle-kit` 钉成精确版本（去掉 `^`）~~ —— **2026-10-25 实测：这样做会让 CI 第一条命令 `pnpm install --frozen-lockfile` 失败。**

   ```text
   $ pnpm install --frozen-lockfile     # 只改 specifier、不动任何版本
   Error: ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION
     11 lockfile entries failed verification:
       @biomejs/biome@2.6.3 was published at 2026-10-24T13:13:12.000Z,
       within the minimumReleaseAge cutoff (2026-10-24T04:54:40.194Z)
   ```

   原因不是 Drizzle：`@biomejs/biome@2.6.3` 在 2026-10-24 才发布，**永远**落在本机 pnpm 12.15.0 的 `minimumReleaseAge` 滚动截断窗口之外；基线锁文件因为带 complete-integrity（"verified 1h ago"）可以直接通过，**一旦重算依赖图就再也过不了**。结论：**钉死版本的收益由"升级只走专门 PR"这个流程条款承担，不要用改 specifier 的方式表达。** 这一条已写进 [ADR 0009](../decisions/0009-dependency-and-runtime-stance.md) §2，并作为本仓库依赖策略的一个真实现象记录。
2. Drizzle 1.0 升级**单独立项**，不跟着 `pnpm update` 走；立项时过一遍"写法和 `sql` 模板边界"的变化清单；
3. 过渡期唯一应急通道：只在 `lib/db/drizzle.ts` 与 `lib/db/auth-db.ts` 里换适配器（S0-4 的收敛正是为了让这条通道成立）；
4. 写进 [ADR 0009](../decisions/0009-dependency-and-runtime-stance.md)。

**成本**：一份流程条款 + 一篇 ADR 的一节，约 20 分钟。

---

### S0-3 零后台任务 vs 独立渲染进程：两条看不见彼此的决策

**事实**

`ADR-0005` 的"负面"一节把话说得很满：

```
docs/decisions/0005-zero-background-jobs.md:47
- M3 的 PDF 排版被设计为**独立进程**（ADR-16），它不走「后台任务」这条路，而是第二个运行时。这两件事要分开看。
```

同文件第 31–38 行："**任何「到期自动做某事」的需求都无法满足** …… 包括邀请过期清理、软删数据物理删除、注销冷静期到期删除、任何异步重活（批量导入、PDF 排版、导出）。"

`08-evolution.md:28` 则说：

> **M3 的排版为什么必须独立进程**：Chromium 常驻内存 300MB+……这是「何时该有第二个运行时」的唯一明确触发条件。

**为什么这是 S0（选型维度）**

"M3 的 PDF 排版"在真实产品里不是一个进程，是**一个任务**：用户点"生成谱书"，等 30 秒到 5 分钟，产物是一份文件。它的形态是：

```
提交任务（写一张 edition/job 行） → 执行（浏览器渲染） → 存产物（对象存储） → 用户下载
```

- **提交 → 执行**：在 Vercel Function 里跑 Chromium 会撞内存上限和时间上限，**这就是被 ADR-0005 判死的"异步重活"**；
- **执行 → 存产物**：需要对象存储（S3 / R2 / Vercel Blob），而栈里现在**没有任何对象存储依赖**；
- **执行 → 用户下载**：需要一个签名 URL 通道，不是 Server Action。

这三件事里，**只有"执行"需要第二个运行时**；"提交""存储""下载"是数据形态和 IO 选型，和运行时无关。现在的文档把它们打包成"到 M3 再说"，于是：

- ADR-0005 说"零后台任务"，读者会以为 M3 也不需要任务；
- ADR-16 说"独立进程"，读者会以为起第二个 Vercel 项目就完事。

**两者的交集是"队列"，而队列是 ADR-0005 明确拒绝掉的东西**——不是因为队列不好，而是因为 M1 没有需求。M3 有需求时，这条决策的破例方式必须预先说清楚：**"零常驻进程"保得住，"零后台任务"保不住。**

**补丁**

在 ADR 0009 里明确"第二个运行时"的边界（本文已写出）：

| 形态 | 允许？ | 理由 |
|---|---|---|
| 按请求执行的 Function（包括长任务，如果平台允许） | 允许 | 没有常驻进程 |
| 队列 + 一次性执行器（Cloudflare Queues / SQS / Neon 定时函数之一） | **仅当需求是"用户等得起但产线等不起"**，且必须有失败告警 | 这是 M3 排版与批量导入的真实形态 |
| 常驻 worker 进程 | 不允许（除非出现实时协同，ADR 已排除到 M4） | 半故障状态 |

并且**在 M3 立项时做的事**（不是现在）：`edition` 表的任务状态机 + 对象存储 + 签名 URL，三件事各自独立评审，**不要把它们当成"排版引擎的一个附件"**。

**成本**：ADR 一节，20 分钟。

---

### S0-4 两个 DB 单例：必要的分叉，不必要的复制

**事实**

```ts
// lib/db/drizzle.ts:3-4, 17, 29-33, 52-56
import { attachDatabasePool } from '@vercel/functions';
import { config } from 'dotenv';
config({ quiet: true });
...
if (process.env.VERCEL) {
  const pool = new Pool({ connectionString, max: 5 });
  attachDatabasePool(pool);
  return drizzleNodePg(pool, { schema }) as unknown as Db;
}
return drizzlePostgres(postgres(connectionString), { schema });
...
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const value = Reflect.get(getDb(), prop, getDb());
    return typeof value === 'function' ? value.bind(getDb()) : value;
  },
});
```

```ts
// lib/db/auth-db.ts:3-4, 16, 26-39
import { attachDatabasePool } from '@vercel/functions';
import { config } from 'dotenv';
config({ quiet: true });
...
if (process.env.VERCEL) {
  const pool = new Pool({ connectionString, max: 5, options: '-c role=auth_service' });
  attachDatabasePool(pool);
  return drizzleNodePg(pool, { schema }) as unknown as AuthDb;
}
return drizzlePostgres(postgres(connectionString, {
  connection: { options: '-c role=auth_service' },
}), { schema });
```

**为什么这是 S0**

- **有意义的差别只有 3 个参数**：连接串（`APP_*` vs `AUTH_*`）、启动参数（无 vs `options: '-c role=auth_service'`）、Vercel 上的必填校验。其余 40 行是复制品。
- **`process.env.VERCEL` 在两个文件里各读一次**——`06-crosscutting §9.1` 的规则是"业务代码不直接读 `process.env`"，`lib/db` 现在是这条规则的两个例外，而且没人登记。
- **`dotenv` 被 import 两次、`config()` 调两次**（`lib/db` 两份 + `tests/helpers/db-url.ts`、`tests/helpers/db.ts`、`scripts/verify-deployment.mjs` 各一份，共 5 处）。`dotenv` 作为模块副作用在这里是"配置加载路径有 5 条"。
- **`db` 的 Proxy 每次属性访问调三次 `getDb()`**（`[10-24] P2-15` 已列，这里补选型结论：这个 Proxy 存在的原因只有一个——让 `typecheck` 在 `POSTGRES_URL` 不存在时也能跑。这是个合理的目标，但**可以在 `lib/db/clients.ts` 里用一次 `??=` 的惰性初始化做到，不需要三个 `getDb()`**）。

**补丁**

```ts
// lib/db/clients.ts（新增，约 40 行）
import 'server-only';
import { attachDatabasePool } from '@vercel/functions';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { Pool } from 'pg';
import postgres from 'postgres';

type ClientSpec = {
  connectionString: string;
  /** Sent as a startup parameter; poolers reject it, so the URL must be direct. */
  startupOptions?: string;
};

export function createDbClient<T>(spec: ClientSpec): { db: T; close: () => Promise<void> } {
  // 一份 `process.env.VERCEL` 分叉，一份 attachDatabasePool
}
```

然后 `lib/db/drizzle.ts` 与 `lib/db/auth-db.ts` 各自只保留"我要哪条连接串"这一行差别。`dotenv` 的调用移到一个 `lib/config.ts` 的初始化里（或者干脆只在 `instrumentation.ts` 里调用一次；`next` 自己会加载 `.env`，`dotenv` 只为 `tsx` 脚本存在）。

**成本**：半天，纯重构，`pnpm test:integration` 117 条兜底。

---

## 5. S1 详述

### S1-1 谱文：最后一次能便宜决策的机会

**事实**

| 需求 | PRD 原文（`prd.md:215-225`） |
|---|---|
| FR-ART-2 | 富文本编辑：支持标题、加粗、列表、引用、表格（M1 不含图片） |
| FR-ART-3 | 正文中可引用某个人丁，存储其 ID（渲染在 M2） |
| FR-ART-4 | 自动保存：停止输入 2 秒后保存 |
| FR-ART-5 | 按标题与正文全文检索 |

`docs/decisions/README.md:27`：

| ADR-12 | 富文本 | ProseMirror JSON，不存 HTML | 单向门 | — |

`package.json`：**没有任何编辑器依赖**（`grep tiptap|prosemirror|lexical|slate package.json` 无结果）。

**为什么这是 S1 而不是 S2**

1. **它和 ADR-0003 是同一类门**：文档格式一旦进了库、进了已排版的谱书，换编辑器就要重排。ADR-12 已经把它标成单向门了，而现在"单向门"后面是空的。
2. **需求比方案小得多**：5 种块级排版 + 1 种行内格式 + 一个引用节点。ProseMirror 的首选封装（TipTap）在 2026-10 是 1.0 之前，且依赖树 30+ 包（包括对 React 适配层的版本约束）。**用 TipTap 直接写 ProseMirror JSON 与用 TipTap 写 TipTap JSON，是两种完全不同的可逆性。**
3. **它有两个"藏在别处"的依赖**：自动保存（FR-ART-4）需要**防抖 + 冲突处理**，而现在没有编辑锁（ADR-0002，last-write-wins），2 秒防抖 + last-write-wins 意味着"两个人同时写，后到的整篇覆盖"——这个语义要么接受并写进 PRD（已经写进 FR-ART-4 的并发语义了），要么用"段落级 patch"来消除特例，而后者直接决定**文档 JSON 的粒度**。
4. **全文检索（FR-ART-5）还没有选型**：`pg_trgm` 在 `article` 上建了索引（`[10-24]` 附录 B 提到 `idx_article_search` 保留），但 `pg_trgm` + ILIKE 只匹配**子串**，不处理中文分词；如果正文是 ProseMirror JSON，`ILIKE` 对 JSON 文本的匹配质量取决于"JSON 是否稳定序列化"。**这是一个现在就能算清、M2 才能测出来的账。**

**建议（不是决定，决定要过 brainstorming）**

| 选项 | 换来什么 | 代价 |
|---|---|---|
| A. 受限结构化模型：**段落数组 + 块类型**（`{"type":"heading","text":"序"}`），表格用二维数组 | 5 种块需求全覆盖；JSON 稳定可检索（`jsonb_path_query` 或落一列 `plain_text` 冗余）；**没有编辑器框架依赖**；后续要富文本再加一层 | 加粗/斜体要自己实现（M1 需求里只有加粗） |
| B. TipTap + 只存 ProseMirror JSON | 编辑体验现成、协作路径现成（M4 的 CRDT 需要它） | 1.0 之前的依赖、30+ 包、Node 结构与我们的 5 种块不对齐 |
| C. 先上 Lexical | Meta 出品，结构化程度比 TipTap 高 | 生态小、文档少，1–3 人团队的学习成本是真金白银 |

**我倾向 A**，理由单一：**这个系统的核心资产是"人丁 + 谱系 + 编目"，谱文是装饰。** PRD 要的 5 种排版用一个 60 行的渲染器就能做；而选 B 或 C 是在为 M4 的实时协同预付成本，那件事在 ADR 里已经明确排除到 M4。

**成本**：一次 brainstorming + 一篇 ADR（30 分钟讨论，2 小时落文档）。**不做也能继续做别的功能，但不要在谱文开工时才想。**

---

### S1-2 表单栈：文档承诺了不存在的东西，扁平模型挡住了两个 FR

**事实**

```
docs/architecture/04-runtime.md:153
| 表单 | React Hook Form + Zod |
```

`package.json`：没有 `react-hook-form`。

实际写法（`lib/auth/middleware.ts:24-38`）：

```ts
export function validatedAction<S extends z.ZodType, T>(schema, action) {
  return async (_prevState: ActionState, formData: FormData) => {
    const result = schema.safeParse(Object.fromEntries(formData));
    ...
```

调用面（本次实测）：`lib/auth/actions/session.ts`、`lib/auth/actions/account.ts`、`lib/org/actions.ts`、`lib/project/actions.ts`、`lib/folder/actions.ts`、`lib/lineage/actions.ts`，以及对应组件里的 `useActionState` —— **11 个文件**。

**为什么这是 S1**

`Object.fromEntries(formData)` 把一切压成 `Record<string, string | File>`。这套模型对"邮箱 + 密码""组织名"这类扁平表单是**最优解**（比 RHF 少一个依赖、少一层状态、少一次水合）。但它对下面两件事是**结构性障碍**：

| FR | 需要的形状 | 现在的模型 |
|---|---|---|
| FR-LIN-6 人丁自定义字段 | 可变键的键值对（用户自定义字段名） | 扁平字典里塞不进"字段数组"；`node.attributes`（jsonb）有列、无写入（`[10-24]` 附录 B 已列） |
| FR-BOOK-3 编目三栏 + FR-BOOK-5 嵌套拖拽 | 树形结构 + 顺序 | 扁平字典；`book_catalog.parent_id` 有列，没有表单模型 |
| FR-PROJ-1 创建云谱空间 | 已经绕过去了：用 Hidden JSON 字段传结构化数据 | —— |

**结论不是"装 RHF"**，而是：**表单策略要按"扁平 / 结构化"分成两条，并把这个决定写下来。**

| 形态 | 方案 | 现状 |
|---|---|---|
| 扁平表单（登录、注册、改名、改角色、建组织） | Server Action + `useActionState` + Zod，**不装 RHF** | 已在用，**是对的**，把 `04-runtime §6.2` 的 RHF 删掉 |
| 结构化表单（人丁详情、编目树、自定义字段） | **客户端状态 + 显式 DTO**：先构建对象，再作为单个 JSON 字段提交给 Server Action，Zod 校验这个对象 | 没定；创建项目时已经在用"隐式 JSON 字段"绕过，但没有统一约定 |

**成本**：改一行文档 + 在 `add-a-feature.md` 加一节"结构化表单提交约定"，2 小时。

---

### S1-3 限流：写了"将来要换"，从没换过，也没人知道它不生效

**事实**

```ts
// lib/auth/rate-limit.ts:1-4
// In-memory sliding-window rate limiter behind a swappable interface.
// Counts reset on process restart and are per-instance; for multi-instance
// deployments replace the store with a Redis/Upstash-backed implementation
// exposing the same `checkRateLimit` signature.
```

```ts
// lib/auth/rate-limit.ts:21-43 —— store 是进程内 Map
const hits = new Map<string, number[]>();
```

调用点：登录（10 次 / 15 分钟，IP + 邮箱）、注册（5 次 / 小时，IP）、改密（5 次 / 15 分钟）、删号（3 次 / 小时）。

**为什么这是 S1（而不是 S2 的"已知限制"）**

1. **它在 Vercel 上的实际强度未知且接近零**：函数实例随时回收、按需扩容。攻击者的有效尝试次数 ≈ `10 × 实例数 × 存活时间`。文档说"best-effort"，但**没人量过 best-effort 在这里是什么**。
2. **key 的部分输入可伪造**：`getClientIp()` 读 `x-forwarded-for` 的第一个值（`rate-limit.ts:8-11`），而文档自己承认"`x-forwarded-for` 可伪造，应只信任平台注入的头"（`06-crosscutting §9.4` 注 1）。Vercel 注入的是 `x-real-ip` / `x-vercel-forwarded-for`，当前代码没读。
3. **"可换的接口"没有换来任何东西**：`Store` 类型（`take`/`set`）看起来是为 Redis 准备的，但它是**同步接口**——Redis 客户端是异步的，**这个接口换不成 Redis**。这是"留了个接口，但接口形状把唯一的实现拒之门外"的典型。

**建议**

| 方案 | 说明 | 成本 |
|---|---|---|
| A. 诚实降级 + 修 key | `getClientIp()` 只信任平台头；文档从"限流"改成"登录页的乐观保护"，并在 `security-regressions` 里加一条断言（不谎称安全边界） | 1 小时 |
| B. 上 Upstash（HTTP，适配 Vercel）：`checkRateLimit` 改异步，`Store` 换成 `async` | 真正在多实例下生效；多 1 个依赖 | 半天 + 1 个依赖 |
| C. 数据库计数表 | 不引新依赖，用现有 PostgreSQL（`INSERT ... ON CONFLICT DO UPDATE`），慢但够用 | 半天 + 一张表 |

**我倾向 A 现在做、B 在有真实攻击或客户审计要求时做。** 理由是纯技术性的：登录限流在 1–3 人自用的 SaaS 上不是"安全边界"，把它写成安全边界反而会让评审忽略真正的边界（scrypt 成本、会话撤销、RLS）。

**注意**：`[10-24]` 保护线没有覆盖限流；ADR-0005"零后台任务"也不禁止 Redis；ADR-19 只讲数据库驱动。**这条决策现在没有归属**，需要 ADR 0009 的"依赖数量"条款来管（B 会加第 51 个依赖）。

---

### S1-4 `pg_trgm` 选对了，但没接线

**事实**

- 迁移里建了 GIN 索引（`[10-24]` 附录 B：`idx_node_search`、`idx_article_search`）。
- `lib/db/queries/nodes.ts:33-56` 的 `searchNodes` 用 `ilike(nodes.fullName, '%term%')`，注释写着"Uses the pg_trgm index"。
- **没有页面调用它**；画布搜索在浏览器里 `buildLineageIndex` + 本地过滤（`components/lineage/derived.ts`）。
- `getNodes` 一次读全谱系（`nodes.ts:8-31`）。

**为什么这是选型问题**

`pg_trgm` 是一个**正确且便宜**的选择（无需外部搜索服务、ILIKE 可索引、中文双字 trigram 够用），比引入 Meilisearch/Elasticsearch/Typesense 都更符合"零基础设施"原则。但选型的价值 = 选对 × 接线，**当前接线是 0**。同时它还暴露了 `pg_trgm` 的边界：**中文按字划 trigram，搜索"元英"会命中"元瑛"之类的近似，但单字搜索（"英"）的 trigram 支持很弱**——这是选型时该知道、现在只能在上线后知道的账。

**补丁**：交给 `[10-24]` P0-3 的第二步（服务端按代窗口读 + 搜索 Route Handler）。本文只补一条选型结论：**不要因为"搜索体验不好"就去引外部搜索索引**，先接线、先量（`[10-24] §9` 的假设表已经列了"真实谱系规模 < 5000 节点？"）。

**成本**：0（附属于 P0-3）。

---

## 6. 做减法

"优化"里最有效的一类动作是删除。以下六项的收益都大于保留。

| # | 删什么 | 理由 | 成本 |
|---|---|---|---|
| 1 | `04-runtime §6.2` 的 "React Hook Form + Zod" 一行 | 文档承诺了不存在的依赖；按 S1-2 改成"扁平表单不装 RHF + 结构化表单显式 DTO" | 一句话 |
| 2 | `03-components §7.1` 表中"Biome 规则待接入"的措辞 | 规则已经可以配（S0-1），文档不该继续为"没有执行"背书 | 三行 |
| 3 | `lib/auth/rate-limit.ts` 的 `Store` 抽象 | 同步接口换不成 Redis，是"假装可换"；要么改成异步适配器，要么删掉抽象只留实现 | 半天（属 S1-3） |
| 4 | `lib/db/` 第二份 `dotenv` 与第二份驱动分叉 | 一个 `createDbClient` 收口（S0-4） | 半天 |
| 5 | `next-themes` 的依赖 | 全站只需一个 `dark` class 开关（`components/theme-provider.tsx` + `theme-toggle.tsx`，约 30 行）；换成 10 行 `useEffect` + `localStorage` 后依赖 -1 | 1 小时（**可选**，不建议为了减依赖而做） |
| 6 | `docs/architecture` 里对"最新稳定版本"的重复叙述 | 版本只在 `implementation-status.md §1` 写、由测试断言；`00-overview` 只写主版本 | 半小时 |

> 第 5 条列出来是为了说明判断标准：**减依赖本身不是目标，"依赖是否替我们编码了一个不变式"才是**。`next-themes` 编码的是"SSR 与首帧不闪"这个真实问题——所以它其实**不该删**，只是"用 30 行换 1 个依赖"在 1–3 人团队里是笔划算账的边界情形。真正的判断留给实施者。

---

## 7. 文档反向漂移（选型维度）

| # | 文档说 | 代码是 | 处置 |
|---|---|---|---|
| S3-1 | `04-runtime.md:153` "React Hook Form + Zod" | 没有 RHF，手写 `useActionState` + `validatedAction` | 按 S1-2 改目标 |
| S3-2 | `03-components.md:74-81` 四条依赖规则"靠评审执行" | 规则可配（Biome 2.6.3 `style.noRestrictedImports`） | 按 S0-1 配规则，改文档为"已执行" |
| S3-3 | `decisions/README.md` 21 条决策 | 无 ORM 条、无依赖数量条、无第二运行时条 | 新增 [ADR 0009](../decisions/0009-dependency-and-runtime-stance.md) |
| S3-4 | 版本号在 3 处手抄 | `package.json` 是唯一事实源 | 扩 `tests/docs-consistency.test.ts` 的断言面（本次已做：Drizzle 精确版本、`AGENTS.md` 与 `implementation-status.md` 双向一致） |
| S3-5 | `0005:47` "M3 独立进程，与后台任务分开看" | 两者是同一件事的两半 | 在 ADR 0009 的"第二个运行时边界"里说清，ADR-0005 正文不改（ADR 规范：不修改已接受的 ADR，决策变了就新写一篇） |

> 硬规则沿用 `[10-24]` §7 的结尾：**任何"目标与实现不一致"的条目，要么在 `implementation-status.md` 登记为差异，要么改目标。不允许两边都留着。**

---

## 8. 补丁序列

按"单位时间消除的风险"排序。**本次已执行 1、2、4**（并顺手修正了 1 里"钉死版本"这一错误前提，见 S0-2）；3、5、6、7、8 留给后续 PR。

| # | Commit | 改动 | 验收 | 工作量 |
|---|---|---|---|---|
| 1 | `chore(lint): 启用依赖方向 lint` | `biome.json` 加两条 `overrides`（**不动依赖版本**，理由见 S0-2） | `pnpm check` 通过；`pnpm test` 全绿 | 30 分钟 |
| 2 | `docs(decisions): 记录依赖与运行时立场` | 新增 `0009-dependency-and-runtime-stance.md`；`decisions/README.md` 索引 + 待决策表；`docs/README.md` 目录树 | `node scripts/check-docs.mjs --strict` 0 issue | 1 小时 |
| 3 | `docs(arch): 修正表单与依赖规则的文档漂移` | `04-runtime §6.2` 删 RHF；`03-components §7.1` 改"已执行" | `pnpm docs:check` | 30 分钟 |
| 4 | `test(docs): 版本断言的唯一事实源` | 扩 `tests/docs-consistency.test.ts` | `pnpm test tests/docs-consistency.test.ts` | 30 分钟 |
| 5 | `refactor(db): 收口两个数据库客户端` | 新增 `lib/db/clients.ts`，改 `drizzle.ts` / `auth-db.ts` 两个单例；再把 `tests/helpers/db-url.ts`、`tests/helpers/db.ts`、`scripts/verify-deployment.mjs` 里的 `dotenv` 调用一并收口 | `pnpm test:integration` 117 条 | 半天 |
| 6 | `feat(auth): 限流只信任平台注入头` | `getClientIp()` 改读 `x-real-ip` / `x-vercel-forwarded-for`；文档改口径 | 单测覆盖两种头 | 1 小时 |
| 7 | `docs(prd): 谱文选型立项` | 一次 brainstorming 产出 ADR（A/B/C 三选一） | ADR 落地，`decisions/README` 索引更新 | 2 小时（讨论另计） |
| 8 | `feat(read): 接通服务端搜索` | 附属 `[10-24]` P0-3 第二步 | 5001 节点测试 + `EXPLAIN` 走 GIN | 属 P0-3 |

**顺序理由**：

- 1、2、3、4 是同一件事（"选型的约束要有执行者"）的四个面，**先做它们因为成本最低、且为后面所有改动立规矩**；
- 5 依赖 4（`clients.ts` 的抽取要能靠集成测试兜底）；
- 6 与 5 无关，可并行；
- 7 需要你参与（是产品决策），放在最后不阻塞其他；
- 8 属于 `[10-24]` P0-3 的第二步，本文只引用不重复。

**不要合并的**：1 和 2（代码约束 vs 决策记录，回滚粒度不同）；5 和 6（重构 vs 行为改变）。

---

## 9. 未验证的假设

本文所有"危险程度"和"成本"都是按结构判断的，**不是测出来的**。以下必须量过再决定是否继续：

| 假设 | 怎么验 | 如果不成立 |
|---|---|---|
| 依赖方向 lint 会拦下现有代码 | 配好后跑 `pnpm check`，看诊断数 | 0 条 → 说明代码本来就干净，更该配，因为将来会被污染 |
| 换一台不受 `minimumReleaseAge` 策略约束的机器（或在新锁文件里重建全部依赖），钉死 specifier 是否仍然触发 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | 在 CI 容器里试一次 | 不触发 → 钉版本这件事可以做，但要单独一个 PR，且必须带完整锁文件重建 |
| 限流在 Vercel 上的有效尝试次数 | 对 staging 用并发发 30 次错密码，看多少能过 | 全部被拒 → 说明实例回收比想象中慢，S1-3 可降为 S2 |
| 真实谱系规模 < 5000 节点 | 查 `lineage.node_count` 分布 | 都很小 → S1-4 只做接线不做窗口读 |
| `pg_trgm` 对中文单字/双字的召回 | 用真实姓名数据跑 `EXPLAIN ANALYZE` + 人工抽样 | 单字召回差 → 在 ADR-13（`pg_trgm`）重估时记录，**仍不要上外部索引** |
| TypeScript 7 的实际检查耗时提升 | `pnpm typecheck` 前后对比（本仓库有 `tsconfig.tsbuildinfo`，增量模式） | 提升不明显 → 仍是唯一"结构性强"的升级，只是理由变弱 |

---

## 附录 A：与 2026-10-24 评审的关系

| 10-24 编号 | 结论 | 本文的关系 |
|---|---|---|
| P0-1 边无复合外键 | 成立 | 不重复；与本文 S0-1 是同一根源（"约束没有执行者"），但那是 schema 层，本文是 lint/依赖层 |
| P0-2 每查询一事务 / P0-3 全量加载 | 成立 | 不重复；S1-4 引用 P0-3 第二步 |
| P1-12 架构约束零执行（`nursery.noRestrictedImports`） | 成立 | **本文 S0-1 更新了它的前提**：Biome 2.6.3 已把规则从 nursery 移到 `style`，配置草案应改写 |
| P2-13 死代码/死索引 | 成立 | 不重复；S1-4 引用其"`idx_article_search` 保留"的判断 |
| P2-15 `db` Proxy 调三次 `getDb()` | 成立 | **本文 S0-4 扩展为"两个单例的复制品"**，并修正了 Proxy 的存在理由（惰性初始化，不是"必须要 Proxy"） |
| D-22 文档漂移 | 成立 | 本文只补选型维度的漂移（S3-1 ~ S3-4），不重复数据模型那批 |
| 补丁 10（配 4 条 fitness function） | 未执行 | 本文把其中"依赖方向"的那条落到 ADR 0009 + 本次 commit 1 |

**本文新增、10-24 没有的**：ORM 版本策略（S0-2）、第二个运行时的边界（S0-3）、富文本选型空白（S1-1）、表单栈的文档虚构与扁平模型（S1-2）、限流的接口形状问题（S1-3）、"装饰性升级 vs 结构性升级"的区分（§4.1 的判断）、以及**决策地图缺"依赖与运行时立场"这一整类**（S3-3）。

---

## 附录 B：这一轮升级里哪些是真的，哪些是装饰

判断标准：**这次升级是否改变了我们可选的设计空间？**

| 升级 | 判断 | 理由 |
|---|---|---|
| TypeScript 5.x → 7.0.2（Go 原生编译器） | **结构性** | 类型检查从"排队跑"变成"随时跑"；`[10-24]` 那些"改 5 个写入口"的补丁在旧编译器下没人愿意反复验证。同时删掉 `baseUrl` 是真正的减负 |
| Zod 3 → 4 | **结构性** | `z.uuid()` 收紧到 RFC 9562 variant，`[10-24]` P0-1 的集成测试依赖这个强度；`error` 回调把"必填 vs 类型错"的两条文案收成一个函数 |
| Next 16.4.0 → 16.4.3 | 中性 | patch 版本，`agentUpgrade: 'security'` 这类实验开关是新增的能力，不是变化 |
| React 19.1 → 19.3 | 中性 | 不影响任何现有写法（无 Server Component 新 API 依赖） |
| Tailwind 4.1 → 4.3 / `@tailwindcss/postcss` | 中性 | 设计令牌体系已定（`tests/design-system.test.ts`），版本不改变它 |
| `radix-ui` 1.4 → 1.8 | **装饰** | 用法在 `components/ui/` 里已经抽象，版本对调用方不可见 |
| `lucide-react` 0.x → 1.x | **装饰** | 主版本号跳变但 API 面没变；这是"看着吓人、实际无影响"的典型 |
| Vitest 3 → 5 / Vite 8 | 中性 | `fileParallelism: false` 与覆盖率门槛的语义经过实测保持；没有新能力被使用 |
| Biome 2.5 → 2.6 | 中性偏**结构性** | `noRestrictedImports` 从 nursery 毕业（本次实测确认），但这和 2.6 版本本身无关，是规则成熟 |
| pnpm 9 → 12 / Node 22 → 24 LTS | 结构性（成本面） | `allowBuilds` 从 `package.json` 移到 `pnpm-workspace.yaml` 是一次真实的配置语义变化；Node 24 是 LTS 基线 |

**结论**：10 项升级里 3 项结构性、5 项中性、2 项装饰。这不说明升级错了，只说明**"升级到最新稳定"不能替代"选型决策"**——前者是维护动作，后者是设计动作，这轮只做了前者。
