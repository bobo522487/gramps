# 非功能需求（NFR）

> **回答什么问题**：性能 / 安全 / 可用性 / 合规承诺到什么程度，靠什么自动证明，哪些明确不承诺。
> **读者**：全员 · 运维 · AI Agent　**长度上限**：3 页
> **不写什么**：架构机制与依赖方向（`docs/architecture.md`）、接口形状与错误码（`docs/interfaces.md`、`docs/contracts/`）、表与列（`lib/db/schema/`）、失败处置步骤（`docs/runbooks/`）、风险登记（`docs/roadmap.md`）、术语（`docs/glossary.md`）。

全项目唯一**可度量阈值**归属地。只写能从脚本、配置或测试里读出来的数；读不出来的写定性判定，不编造目标。本文描述当前实现，不写「现状 / 目标」双轨。

---

## 1. 使用规则

1. **新增约束前先回答「谁让它变红」**。没有执行者的约束不是约束，删掉而不是承诺。
2. 「谁在拦」的清单在 `docs/architecture.md` 的「约束要有执行者」，**本文件不重抄那张表**；§2 登记的是阈值**数值与产出它的文件**，以及那张表未覆盖的执行者。同一条约束两处出现时，数值以本文件为准、拦截方式以 architecture 为准。
3. 数值只写一次。别处引用不复制；改数值先改产出它的脚本或配置，再回来改本文件。
4. 阈值是**下限不是目标**：覆盖率门槛刻意比实测基线低约 2 点，基线涨了要抬高门槛，不许为了过 CI 调低。文件行数豁免同理，只许缩不许涨。

---

## 2. 可度量阈值

| 类别 | 阈值 / 当前值 | 来源（唯一） | 谁让它变红 |
| --- | --- | --- | --- |
| 单文件体积 | `F6_LIMIT = 400` 行；扫 `app/` `components/` `lib/` `hooks/`。7 个存量豁免各带行数上限，文件涨过上限或豁免已失效都算违规 | `scripts/lib/file-size.mjs`、`scripts/check-file-size.mjs` | `pnpm arch:check` |
| 环境变量读取 | `process.env` 只在 `lib/config.ts` 读，**零豁免**；根入口 `instrumentation.ts` / `proxy.ts` 只放行 `NEXT_RUNTIME` / `NEXT_PHASE` 标记 | `scripts/check-env-access.mjs` | `pnpm arch:check` |
| 覆盖率全局下限 | lines 76 / statements 76 / functions 84 / branches 65 | `vitest.coverage.config.ts` | `pnpm test:coverage` |
| 覆盖率局部下限 | `lib/db/queries/**` 98 / 98；`lib/project/services.ts` 92 / 98；`lib/lineage/node-services.ts` 84 / 94（lines / functions） | `vitest.coverage.config.ts` | `pnpm test:coverage` |
| 依赖方向 | 4 组 `noRestrictedImports`：客户端禁 `drizzle-orm` / `@/lib/db/*` / schema；`lib/db/**` 禁 `next/*`；`lib/db/queries/**` 禁 `@/lib/*/actions`；`@tiptap/**` 与 `prosemirror-*` 只允许 `lib/article/**`、`components/article/editor/**` | `biome.json` | `pnpm check` |
| 会话与密码 | 会话 7 天过期、滑动续期 1 天；`cookieCache.enabled: false`（每次校验查库）；密码 8–100；邀请 7 天过期；邮箱验证关闭、改邮箱关闭、组织不可删 | `lib/auth/better-auth.ts` | `tests/integration/better-auth.test.ts` |
| 限流 | 登录 10 次 / 15 分钟（IP + 邮箱）、注册 5 次 / 1 小时（IP）、改密 5 次 / 15 分钟（IP + 用户）、删号 3 次 / 1 小时（IP + 用户）。进程内滑动窗口，**重启清零、多实例不共享，不是安全边界** | `lib/auth/rate-limit.ts`；`lib/auth/actions/session.ts`、`lib/auth/actions/account.ts` | `tests/rate-limit.test.ts` |
| 数据库连接池 | 仅 Vercel 上 `new Pool({ max: 5 })` + `attachDatabasePool`；本地与 CI 走 `postgres.js` 直连，不受这层保护 | `lib/db/drizzle.ts` | **无自动执行者**；靠 Neon 连接数指标 |
| 安全响应头 | HSTS `max-age=63072000; includeSubDomains`、`X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy` 关摄像头/麦克风/定位、移除 `x-powered-by`；**CSP 仅 Report-Only** | `next.config.ts` | `pnpm verify:deploy` → `scripts/verify-deployment.mjs` |
| 日志级别 | `debug < info < warn < error`；`LOG_LEVEL` 只在 `lib/config.ts` 校验，启动时由 `instrumentation.ts` 注入；未配置时生产 `info` / 开发 `debug` | `lib/config.ts`、`lib/logger.ts`、`instrumentation.ts` | 配置校验失败则启动抛错 |

接口层的上传上限（单张 ≤10MB、JPG / PNG / WebP）与 DTO 在 `docs/contracts/`，本文件不复制。

**表里那行「无自动执行者」是故意留着的**：连接池上限会随实例数变，却没有任何检查能拦住它。把它写成「有约束」是自欺，标出来才算诚实。

---

## 3. 质量属性目标与未达标症状

| 属性 | 目标 | 未达标时先看哪里 |
| --- | --- | --- |
| 性能（读） | 首屏一个请求内完成上下文解析与数据查询；页面在服务端一次取齐该页数据，不产生 N+1 | 首屏出现瀑布式往返、TTFB 随请求数上升。**无自动检查，靠评审** |
| 性能（交互） | 画布拖拽不卡；新鲜度只由单一 `staleTime` 决定 | hook 上出现 `refetchOnMount: 'always'`，同一份数据被打两遍。**无自动检查，靠评审** |
| 安全 | 跨组织读取 0 行；越权与信息泄露在评审第一顺位 | `tests/integration/org-scope.test.ts` 变红，或 `verify:deploy` 的 RLS 检查失败 |
| 一致性 | 多步写要么全成要么全不成 | 出现「有账号没有组织」「没有 owner 的组织」这类中间态 |
| 可用性 | 单区域部署、无降级路径；实例无状态可水平扩 | 数据库不可用时整站 500，没有只读降级模式 |
| 可运维性 | 一次发布 = 合并到 `main`；一次回滚 = 重新部署上一版本 | 靠人工步骤发布，或回滚需要手改数据库；迁移与业务代码必须分开提交 |

前两条**明确标注「靠评审」**——没有脚本能证明首屏没瀑布，硬给它配一个假的检查比不写更糟。

---

## 4. 容量口径与先坏的三个点

不写容量数字承诺，只写「按什么估、现在被什么卡住」。

| 维度 | 估算方式 | 现在的约束 |
| --- | --- | --- |
| 组织数 | 每个注册用户自动获得一个组织，组织数 ≈ 用户数 | 无上限；组织切换器与 `/api/orgs` 会先变大 |
| 单组织成员 | 邀请链接 + 4 角色 | 成员列表全量返回，**没有分页**；成员上百后一次拉全量 |
| 单谱系人丁 | 按谱系节点计数 | 一次取该谱系**全部**未删节点，无 limit 无分页；渲染窗口只限制同屏代数，不减少传输量 |
| 活动日志 | 每次关键写一条 | 没有归档、分区与保留期清理，表只增不减 |
| 事实层体积 | 由回填脚本从谱系节点派生 | 只回填不双写，应用写路径不维护它，体积 = 一次回填的快照 |
| 函数并发 | 平台按请求自动扩 | 每实例连接池上限 5，实例数上升时先撞数据库连接上限，不是 CPU |

按发生顺序，会先坏的三个点：

1. **单谱系人丁全量加载**：整条谱系一次进内存再进浏览器。症状是大谱系打开变慢、内存上涨、客户端布局耗时线性增长。修法是服务端按代取窗口，属结构性改动。
2. **活动日志无归档**：表只增不减，且每次关键写都插一行。症状是活动页变慢、备份与恢复时间被它主导。修法要先决定保留策略。
3. **连接池与并发**：症状是高并发下连接获取超时与 500，而 CPU 与内存都还宽裕。修法是换 pooled 端点并复核所有长事务。

读写分离、多区域、缓存层、外部搜索索引**不在边界内**——都有明确触发条件，触发前不建。

---

## 5. 明确不承诺的

以下不是待办清单，是**当前边界**。要补任何一条，先改本文件，并在 `docs/roadmap.md` 建条目。

- **没有跨区域容灾、没有 RPO / RTO 承诺、没有 SLA**：单区域部署，恢复靠 Neon 分支与 PITR。本地 `pg_dump` / `pg_restore` 的等价恢复演练已做（`docs/runbooks/README.md` §2.2，2026-11-09），**托管侧 Neon 分支 / PITR 仍未演练**，也没有错误预算。
- **没有外部告警、APM、分布式追踪**：能看的只有 Vercel 函数日志、Neon 指标与 `/api/health`。挂了没人被叫醒，错误率没有阈值，页面 TTFB 无法从日志得出。
- **健康检查只知道数据库能不能 `select 1`**：迁移是否已应用、登录角色权限、RLS 是否仍生效，这三项由 `verify:deploy` 部署后单独断言，不是运行时探针。
- **CSP 未强制**：Tailwind / RSC 的内联样式与脚本尚未收敛，目前只下发 Report-Only 观察违规。
- **限流不是安全边界**：进程内计数，重启清零、多实例不共享。
- **没有独立审计表**：目标态没有产品活动流表（旧 `activity_logs` 整表退役），也没有替代的审计通道。「谁在什么时候改了什么」的完整追溯不成立。
- **没有数据主体请求流程**：没有自助导出、没有删除请求入口、没有保留期策略；删除是物理删除，不存在「留在库里的软删数据」，但也没有逐条追溯能力。
- **没有合规评估**：没有 GDPR / 个保法评估、数据分级文档与跨境传输分析。当前数据形态（姓名、亲属关系、生平文字）属于个人信息甚至敏感信息，这一点尚未在代码或流程上被处理。
- **删除语义只有一种**：全库业务表无软删列，删除走 `ON DELETE RESTRICT`（无可恢复删除、无回收站 UI）；组织成员与邀请同样是物理删除，误删只能从恢复点整体恢复。
- **没有应用层备份脚本**：备份与恢复是托管数据库侧能力。本地等价演练已验证「dump 到 restore 后抽样一致、策略与函数一并还原」，但托管侧的恢复点创建与 promote 未在生产环境验证过。

---

## 6. 以代码为准

适用范围：本节只对 [现状] 成立；[目标] 以 `docs/data-model.md` 为准，裁决顺序见 `CONTRIBUTING.md` §2「权威口径」。

文档与代码冲突时**以代码为准**，然后回来改文档。改本文件前先跑：

```bash
grep -n "F6_LIMIT" scripts/lib/file-size.mjs
grep -n "thresholds" -A 10 vitest.coverage.config.ts
grep -n "noRestrictedImports" biome.json
grep -rn "checkRateLimit(" lib/auth/actions/
grep -n "expiresIn\|updateAge\|cookieCache" lib/auth/better-auth.ts
grep -n "max:" lib/db/drizzle.ts
grep -n "Content-Security-Policy\|Strict-Transport" next.config.ts
pnpm arch:check && pnpm test:coverage && pnpm verify:deploy
```

最后一行是三条会变红的检查。跑不过就别改文档，先修代码或配置。
