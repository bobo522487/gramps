# 0012. TypeScript 7 编译器开关：只开零成本的，其余全部拒绝并留下账目

- **状态**：已接受
- **日期**：2026-10-28
- **可逆性**：双向门
- **相关**：[ADR 0009（约束必须有执行者）](./0009-dependency-and-runtime-stance.md) · [10-25 技术栈评审 §9 未验证的假设](../reviews/2026-10-25-linus-stack-review.md) · [setup §5 命令表](../setup.md) · [实现状态 §1](../implementation-status.md)

## 背景

[10-25 评审](../reviews/2026-10-25-linus-stack-review.md) 把 TypeScript 7 列为「本轮唯一产生结构性收益的升级」，同时在 §9《未验证的假设》留下一条从未实测的条目：「TypeScript 7 的实际检查耗时提升 —— `pnpm typecheck` 前后对比」。也就是说：**收益被写进了结论，但支撑它的数字一直没测**。

一次「优化 TypeScript 7」的要求把这条假设变成必须回答的问题：要么它确实慢、值得优化，要么它没有可优化的东西。先把前提测清楚。

约束条件：

- `typescript@7.0.2` **本身就是 Go 原生实现**（`pnpm-lock.yaml` 里挂 20 个 `@typescript/typescript-*` 平台包），仓库没有也不需要 `@typescript/native-preview`。
- 只有一个 `tsconfig.json`：无 `composite`、无 project references、无 `types` 白名单。
- `pnpm typecheck` = `tsc --noEmit`；CI 里它跑在 `pnpm build` **之前**，而 `next build` 自己会再做一次类型检查。
- Next 每次 `dev`/`build` 都会回写 `tsconfig.json`（见第 2 节），这限制了「哪些行能删」。

## 1. 实测基线

命令（可自复现；buildinfo 写到仓库外，避免污染工作树）：

```bash
pnpm exec tsc --noEmit --incremental false                                  # 冷跑
pnpm exec tsc --noEmit --incremental --tsBuildInfoFile /tmp/tsb/b.json      # 增量冷/暖各一次
pnpm exec tsc --noEmit --incremental false --diagnostics                    # 程序规模
```

| 指标 | 改配置前 | 改配置后 |
|---|---|---|
| 冷跑（`--incremental false`） | 1.470s real / 6.898s user | 1.356s real |
| 增量冷跑 | 1.467s | 1.423s |
| 增量暖跑（无源码改动） | 0.436s | 0.428s |
| Check time | 0.971s | 0.988s |
| Files / Lines | 2060 / 469 525 | 2060 / 469 525 |
| Types / Instantiations | 401 345 / 1 733 192 | 401 345 / 1 733 192 |

程序里 229 个是本项目文件（约 2.8 万行：`components` 63、`tests` 56、`lib` 53、`app` 37、`hooks` 3），其余约 1831 个文件是顺着 import 进来的 `node_modules` 类型声明。基线错误数 **0**。

**结论：检查耗时不构成问题。** 4 条新开关把 Check time 从 0.971s 推到 0.988s（+17ms），总耗时变化淹没在测量噪声里。所以「让 TS7 更快」不是这里的优化对象；同样的 1.4 秒预算能买到的**信号**才是。

## 2. 陷阱：`tsconfig.json` 的多数「冗余」行删不得

`node_modules/next/dist/lib/typescript/writeConfigurationDefaults.js`（行号对应 Next 16.4.3）每次构建都按两套不同规则回写：

- `suggested` 类**只在键缺失时**写入（L250–254）。其中 `strict` 的 suggested 值是 **`false`**（L116–118），`target` 是 `ES2017`（L97–100）。**删掉 `"strict": true` 会让整个仓库静默降级成非 strict**，而且不会有任何报错提示你。
- `value` 类是**强制覆盖**（L255–273）：`esModuleInterop`、`moduleResolution`、`resolveJsonModule`、`module`、`jsx` 都属此类，删了必被写回。
- 例外只有一处：`isolatedModules` 仅在 `verbatimModuleSyntax !== true` 时才被强制（L172–177）。
- `plugins: [{ name: 'next' }]` 会被自动补回（L340 附近），且 TS7 的 Go 实现**只解析不消费** `plugins`（没有插件加载器）——它对 `tsc --noEmit` 是惰性的，但对编辑器侧仍是框架约定，因此保留。

## 决策

### 3.1 开启（实测 0 报错，零改动）

| 开关 | 实测新增错误 | 作用 |
|---|---|---|
| `verbatimModuleSyntax` | 0 | 类型导入必须写 `import type`，与 Biome `assist.organizeImports` 同向；并让 `isolatedModules` 变成可删 |
| `noImplicitReturns` | 0 | 抓住漏掉 `return` 的分支 |
| `noFallthroughCasesInSwitch` | 0 | 对 `switch` 判别 union 有意义 |
| `noUncheckedSideEffectImports` | 0 | 副作用导入（如 CSS）必须真能解析 |

四条同时开启的合并实测也是 0，**业务代码一行未改**。

### 3.2 删除

`isolatedModules` —— 语义已被 `verbatimModuleSyntax` 覆盖，且 Next 不再强制（L172–177）。删除后跑完整 `pnpm build`，`git diff tsconfig.json` 只含本次编辑，证明未被写回。

### 3.3 不开启（含理由，全部带实测数）

| 开关 | 实测新增错误 | 为什么不开 |
|---|---|---|
| `noUnusedLocals` / `noUnusedParameters` | 0 | Biome `recommended` 已接管，实测规则为 `lint/correctness/noUnusedImports`、`noUnusedVariables`、`noUnusedFunctionParameters`（用带未用 import / 变量 / 参数的样本跑 `biome check` 验证）。一个规则两个主人 |
| `moduleDetection: force` | 0 | 零收益；唯一影响面是 `tests/server-only.stub.ts` 这种**故意空**的 Vitest alias stub，为它补 `export {}` 是迷信 |
| `exactOptionalPropertyTypes` | 51 | 51 处里约 25 处是 `<FieldError message={state.fieldErrors?.x} />` 对上 `{ message?: string }`（`components/lineage/person-inspector.tsx`、`node-create-dialog.tsx`）。谱系更新的三态语义（缺省=不改 / `null`=清空 / 值=写入）已在 `lib/genealogy/schemas.ts` 的 `clearableText`/`clearableUuid` 与 `lib/lineage/actions.ts` 的字段白名单里做**运行期强制**，而该开关分不清 `null` 与 `undefined`——正是这里唯一要紧的区别 |
| `noUncheckedIndexedAccess` | 377 | 377 里约 342 个落在 `tests/integration/*`（better-auth 78、constraints 66、folders-lineages 58、org-scope 55、queries 46、auth-migration 22）。测试里的 `rows[0]` 缺行本来就是响亮的断言失败，开关只会把它换成永久 `!` 税。生产侧约 25 处见《重估触发条件》 |
| `noPropertyAccessFromIndexSignature` | 116 | 假信号：拦的是 `obj["key"]` 与 `obj.key` 的写法差异（`components/lineage` 45 处、`tests/config.test.ts` 17 处），改写 116 处换不到任何 bug 捕获 |
| `types` 白名单 | — | 只装了 `@types/{node,pg,react,react-dom}`，自动包含的量本就接近零；那 1831 个文件顺着 import 进来，`types` 剪不掉。服务端全局泄漏已由 Biome `noRestrictedImports` 接管（AGENTS.md §8） |
| CI 缓存 `tsbuildinfo` | — | 冷跑 1.36s < `actions/cache` 单次 restore/save 的 10–20s，再叠加跨 commit buildinfo 失效风险 = 负收益 |
| 消除 `typecheck` 与 `next build` 的重复检查 | — | 让类型错误在 1.4s 内失败、且在数据库作业之前失败是特性；总重复成本约 3s |

### 3.4 执行者

按 [ADR 0009](./0009-dependency-and-runtime-stance.md)「约束必须有执行者，否则视为未决策」：本文的每条「开」都落在 `tsconfig.json` 里、由 `pnpm typecheck` 执行、CI `.github/workflows/ci.yml` 强制。每条「不开」都写成了带数字的禁止项，避免后人重新提出。

## 后果

### 正面

- 4 条永久护栏，成本 +17ms，业务代码 0 行改动。
- 删掉了 `isolatedModules` 这行真正的冗余，并用构建 diff 证明了它是唯一能安全删的一行。
- 10-25 评审留下的假设被数字关闭，`pnpm typecheck` 的成本第一次有了可复现的基线。

### 负面（必须诚实写）

1. **这 4 条开关当前抓到的存量 bug 数量是 0。** 它们的价值全在防未来回归。如果有人期待「打开 strict 开关于是发现一批 bug」，这次改动给不了。
2. **没有做 TypeScript 5.x vs 7 的 A/B 对比**（需要临时并存两个编译器）。因此本文只能声明「当前无性能问题」，**不能**声明「TS7 比 TS5 快 N 倍」。评审里「结构性强」那句理由仍未被量化。
3. 拒绝 `exactOptionalPropertyTypes` 后，谱系字段的三态语义继续只靠运行时代码与集成测试守，编译器不参与。这条边界一旦有人改 `lib/lineage/actions.ts` 的白名单就会退化。
4. 拒绝 `noUncheckedIndexedAccess` 后，生产代码里约 25 处索引访问仍可能在缺行时静默拿到 `undefined`。本文把它记成**一次未完成的审计**，不是已解决的问题。
5. `"strict": true` 从此是**框架造成的非冗余**，不能按「清理冗余配置」处理。后来者若照 §2 之外去删行，会踩 L116–118 这个雷且无报错。

### 中性

`tsconfig.json` 净 +3 行；`pnpm check`、`pnpm typecheck`、`pnpm build` 行为与耗时不变；CI 未改。

## 放弃的方案

- **拆 project references，让 `tests/` 豁免 `noUncheckedIndexedAccess`**：`composite` 要求产出声明，与仓库的 `noEmit` 工作流冲突；Next 与编辑器都只认一份 `tsconfig.json`，等于为约 25 处生产点长期维护两套类型视野。
- **全盘开启三个贵开关（545 个错）**：改动面覆盖 `tests/integration` 全部文件与 `components/lineage`，而其中绝大多数是把已有的语义重新用类型写一遍。
- **给 CI 加缓存 / 去重 typecheck**：见 §3.3，收益为负。
- **先加 `noUncheckedIndexedAccess` 再逐个 `!` 补齐**：把类型税固化进测试，换掉的是本来就响亮的失败。

## 重估触发条件

- `pnpm exec tsc --noEmit --incremental false` 实测 > 10s（当前 1.36s）→ 才值得谈缓存与增量策略，并届时补做 TS 5.x vs 7 的 A/B，把《负面》第 2 条填上。
- 程序规模显著变化（`--diagnostics` 的 Files / Types 翻倍，例如引入大量生成类型）→ 重测第 1 节。
- 谱系出现过一次因「`undefined` 与字段缺省混淆」造成的真实数据 bug → 立刻重开 `exactOptionalPropertyTypes`，先按 51 处清单做，不要先争论。
- `tests/integration` 因缺行断言产生过一次误判 → 重开生产侧 `noUncheckedIndexedAccess` 审计（约 25 处，单独一次提交）。
- Next 升级改了 `writeConfigurationDefaults`（本文引用的行号失效）→ 重跑 §2 的回写验证，特别是「删 `strict` 会发生什么」。
