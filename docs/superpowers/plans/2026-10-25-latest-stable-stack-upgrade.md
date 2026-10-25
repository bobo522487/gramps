# 最新稳定技术栈升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把直接管理的运行时、构建、测试与 UI 依赖升级到 2026-10-25 可用的最新稳定版本，固定 Node 24 LTS + pnpm 12，并同步目标架构文档。

**Architecture:** 按影响面分批升级：工具链 → 运行时/UI → TypeScript 7 → Zod 4 → Vitest 5 → Biome/dotenv → 文档 → 全量回归。每批升级后立即运行该层可验证的命令，失败就停在本批修复。不改数据库 schema、迁移、业务功能或部署形态。

**Tech Stack:** Node.js 24 LTS、pnpm 12.15.0、Next.js 16.4.3、React 19.3.1、TypeScript 7.0.2、PostgreSQL 18、Drizzle 0.45.4、Better Auth 1.7.12、Tailwind CSS 4.3.3、Zod 4.6.7、TanStack Query 5.104.5、Zustand 5.0.16、React Flow 12.12.0、Vitest 5.0.5、Vite 8.3.5、Biome 2.6.3、Playwright 1.64.1、dotenv 18.0.9。

**Spec:** 用户指令（2026-10-25）“技术栈都升级最新稳定版本，同时需要更新目标架构文档”；当前基线见 `docs/implementation-status.md`，目标文档见 `docs/architecture/`、`docs/ops-target.md`、`docs/setup.md`、`AGENTS.md`。

## Global Constraints

- Node.js 使用 **24.x LTS**（`24.22.1`）。Node 26 是 Current，不作为生产基线。
- pnpm 使用 **12.15.0**；在 `package.json` 写入 `packageManager` 与 `engines`，并新增 `.nvmrc`。
- pnpm 11 起删除了 `onlyBuiltDependencies`；pnpm 12 使用 `allowBuilds` 映射（布尔值）控制安装脚本，见 Context7 / pnpm 官方迁移说明。
- 精确目标版本：
  - 运行时/框架：`next@16.4.3`、`react@19.3.1`、`react-dom@19.3.1`、`typescript@7.0.2`。
  - 类型：`@types/node@24.19.2`、`@types/react@19.3.0`、`@types/react-dom@19.3.0`、`@types/pg@8.23.1`。
  - UI：`tailwindcss@4.3.3`、`@tailwindcss/postcss@4.3.3`、`radix-ui@1.8.1`、`lucide-react@1.61.0`、`tailwind-merge@3.7.0`、`tw-animate-css@1.4.0`、`autoprefixer@10.6.1`、`postcss@8.5.31`。
  - 数据/状态：`zod@4.6.7`、`zustand@5.0.16`、`postgres@3.4.9`、`pg@8.23.1`、`@vercel/functions@3.10.3`。
  - 测试/工具：`vitest@5.0.5`、`@vitest/coverage-v8@5.0.5`、`vite@8.3.5`、`@biomejs/biome@2.6.3`、`dotenv@18.0.9`、`@playwright/test@1.64.1`。
  - 不升级：`drizzle-orm@0.45.4`、`drizzle-kit@0.31.11`、`better-auth@1.7.12`、`@better-auth/drizzle-adapter@1.7.12`、`@tanstack/react-query@5.104.5`、`@xyflow/react@12.12.0`、`next-themes@0.4.6`、`clsx@2.1.1`、`class-variance-authority@0.7.1`、`server-only@0.0.1`——它们已经是当前最新稳定版。
- 不升级预发布：Drizzle 1.0 RC、Better Auth 1.8 beta、Playwright 1.65 alpha、Next beta/RC 都不进入基线。
- PostgreSQL 保持 18。2026-10-25 没有 `postgres:19` 稳定 Docker 镜像，Neon 目标仍是 18+。不要改本地镜像、迁移或 schema。
- `@types/node` 固定 24.19.2，而不是 npm `latest` 的 26.x；类型主版本必须跟随运行时。
- `vite@8.3.5` 作为显式 devDependency，满足 Vitest 5 的 peer 要求；不引入 Vite 插件或新的构建链。
- 保留所有现有中文校验文案、错误码、ActionState 行为和公开 API DTO。
- 不修改 `lib/db/migrations/`；最终 `pnpm db:generate` 后迁移目录必须无变化。
- 每个实现任务结束后提交；Task 8 只在发现并修复回归时提交。
- 不更新历史材料：`docs/.backup-*`、`docs/reviews/`、`docs/superpowers/plans/2026-10-24-*`。
- 集成测试、E2E 只使用以 `_test` 结尾的数据库；不要对外部环境执行。

## Review Focus

1. **TypeScript 7 + Next 16.4.3 编译器路径**：`tsconfig.json` 的 `baseUrl` 在 TS 7 中已废弃；Next 16.4.3 默认用项目本地 `tsc` CLI 做生产构建类型检查。验证命令是 `pnpm typecheck` 与 `pnpm build`，两者都必须通过。
2. **Zod 4 文案与行为等价**：`required_error`/`invalid_type_error` 移除后，必填与类型错误的文案必须分别保持；邮箱的 trim/lowercase、邀请 UUID 的 trim、custom issue 的路径都不能变化。`z.uuid()` 在 Zod 4 中更严格，要求 RFC 9562/4122 variant bits；仓库内 UUIDv7/v4 均满足。对应测试写在 `tests/auth-schemas.test.ts` 与 `tests/lineage-schemas.test.ts`。
3. **Vitest 5 配置继承**：Vitest 5 的内联 project 默认继承根配置，且 glob 覆盖率门槛不再继承顶层 `perFile`。必须保持集成测试串行（`fileParallelism: false`）与现有覆盖率门槛。验证命令是 `pnpm test`、`pnpm test:integration`、`pnpm test:coverage`。
4. **pnpm 12 构建脚本白名单**：`package.json` 的 `pnpm` 字段不再读取；`onlyBuiltDependencies` 已在 pnpm 11 删除，必须在 `pnpm-workspace.yaml` 使用 `allowBuilds` 映射，否则 `@tailwindcss/oxide`、`esbuild` 不会执行安装脚本。验证命令是 `pnpm install --frozen-lockfile` 与 `pnpm build`。
5. **UI 依赖大版本**：`lucide-react` 从 0.x 升到 1.x、`radix-ui` 1.4→1.8、Tailwind 4.1→4.3、React 19.1→19.3。构建与 E2E 能覆盖导入/渲染，但不能替代视觉检查；`pnpm dev` 手工走首页、登录、控制台、谱系画布、弹窗与下拉。

---

### Task 1: 固定 Node 24 LTS、pnpm 12 与构建脚本白名单

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `pnpm-workspace.yaml`
- Create: `.nvmrc`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: 当前 `package.json` 的 `pnpm.onlyBuiltDependencies` 与 CI 的 Node 22 / pnpm 9。
- Produces: `packageManager: "pnpm@12.15.0"`、`engines.node: ">=24.0.0 <25"`、`engines.pnpm: ">=12.0.0 <13"`、`pnpm-workspace.yaml` 的 `allowBuilds`；后续任务统一使用 pnpm 12。Node/pnpm 的文档同步在 Task 7 完成。

- [ ] **Step 1: 准备 pnpm 12**

Run:
```bash
corepack enable && corepack prepare pnpm@12.15.0 --activate
pnpm -v
```
Expected: `12.15.0`。

如果环境没有 Corepack，改跑：
```bash
npm install -g pnpm@12.15.0
pnpm -v
```
Expected: `12.15.0`。

- [ ] **Step 2: 写 `.nvmrc`**

```text
24.22.1
```

- [ ] **Step 3: 修改 `package.json`**

删除现有的 `"pnpm": { "onlyBuiltDependencies": [...] }` 字段，并加入：

```json
"packageManager": "pnpm@12.15.0",
"engines": {
  "node": ">=24.0.0 <25",
  "pnpm": ">=12.0.0 <13"
},
```

- [ ] **Step 4: 新建 `pnpm-workspace.yaml`**

```yaml
allowBuilds:
  '@tailwindcss/oxide': true
  esbuild: true
```

- [ ] **Step 5: 更新 CI 运行时**

在 `.github/workflows/ci.yml`：

```yaml
      - uses: pnpm/action-setup@v4
        with:
          version: 12.15.0

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
```

`postgres:18-alpine` service 保持不变。

- [ ] **Step 6: 安装并更新锁文件**

Run:
```bash
pnpm install
```
Expected: 成功；`pnpm-lock.yaml` 出现 `packageManagerDependencies: pnpm 12.15.0`，并可能新增 `@pnpm/exe.*` 平台包条目。这是 pnpm 12 的正常锁文件结构。该命令也会把本地 `node_modules` 中陈旧的 Next 16.4.0 对齐到 `package.json` / 锁文件已声明的 16.4.3。

- [ ] **Step 7: 验证冻结安装**

Run:
```bash
pnpm install --frozen-lockfile
```
Expected: PASS，无 `ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE`。

- [ ] **Step 8: 运行基础检查**

Run:
```bash
pnpm check && pnpm typecheck && pnpm test
```
Expected: 全部 PASS。

- [ ] **Step 9: 提交**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc .github/workflows/ci.yml
git commit -m "chore: pin Node 24 LTS and pnpm 12"
```

---

### Task 2: 升级运行时与 UI 依赖

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 1 的 pnpm 12 与 Node 24。
- Produces: React 19.3.1、Tailwind 4.3.3、Radix 1.8.1、lucide 1.61.0、Zustand 5.0.16 等运行时版本；不改变任何导出 API 或业务行为。

- [ ] **Step 1: 更新 `package.json` 版本**

```json
"react": "19.3.1",
"react-dom": "19.3.1",
"@types/react": "19.3.0",
"@types/react-dom": "19.3.0",
"@types/node": "24.19.2",
"tailwindcss": "4.3.3",
"@tailwindcss/postcss": "4.3.3",
"radix-ui": "1.8.1",
"lucide-react": "1.61.0",
"tailwind-merge": "3.7.0",
"tw-animate-css": "1.4.0",
"autoprefixer": "10.6.1",
"postcss": "8.5.31",
"zustand": "5.0.16",
"postgres": "3.4.9",
"@vercel/functions": "3.10.3"
```

保持 `next@16.4.3`（已经是当前最新稳定版）、`@tanstack/react-query@5.104.5`、`@xyflow/react@12.12.0`、`pg@8.23.1`、`next-themes@0.4.6`、`clsx@2.1.1`、`class-variance-authority@0.7.1`、`server-only@0.0.1` 不变。Task 1 的 `pnpm install` 应已把 Next 从 16.4.0 对齐到 16.4.3。

- [ ] **Step 2: 安装**

Run:
```bash
pnpm install
```
Expected: PASS，锁文件只包含上述版本变化。

- [ ] **Step 3: 静态检查与单测**

Run:
```bash
pnpm check && pnpm typecheck && pnpm test
```
Expected: 全部 PASS。

- [ ] **Step 4: 生产构建**

Run:
```bash
pnpm build
```
Expected: PASS。若 `lucide-react` 1.x 缺少某个图标导出，按编译错误改到 1.x 中存在的同名图标；不得回退到 0.x。

- [ ] **Step 5: 浏览器冒烟**

前提：本地 PostgreSQL 18 已启动，并已执行 `pnpm db:migrate` / `pnpm db:seed`。

Run:
```bash
pnpm dev
```
用仓库演示账号登录，检查 `/`、`/sign-in`、`/dashboard`、项目谱系画布、人丁弹窗、下拉菜单与主题切换。Expected: 图标、弹窗、下拉、画布与打印视图无渲染回归。检查完停止 dev server。

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: update runtime and UI dependencies"
```

---

### Task 3: 升级 TypeScript 7

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tsconfig.json`
- Modify: 仅在 TS 7 报错时修改对应源文件

**Interfaces:**
- Consumes: Task 2 的 `@types/node@24.19.2`、`@types/react@19.3.0`。
- Produces: `typescript@7.0.2`；`tsconfig.json` 不含已废弃的 `baseUrl`，`paths` 仍为 `"@/*": ["./*"]`。

- [ ] **Step 1: 升级 TypeScript**

把 `package.json` 的 `"typescript": "^5.8.3"` 改为 `"typescript": "7.0.2"`，然后：

```bash
pnpm install
```

- [ ] **Step 2: 运行类型检查，观察 TS 7 诊断**

Run:
```bash
pnpm typecheck
```
Expected: 若出现 `TS5101 Option 'baseUrl' is deprecated` 或其它 TS 7 诊断，进入下一步；若直接 PASS，也继续下一步以移除废弃配置。

- [ ] **Step 3: 移除 `baseUrl`**

从 `tsconfig.json` 删除：

```json
"baseUrl": ".",
```

保留：

```json
"paths": {
  "@/*": ["./*"]
}
```

`paths` 在没有 `baseUrl` 时相对 `tsconfig.json` 所在目录解析，现有 `@/` 导入不受影响。

- [ ] **Step 4: 修复剩余类型错误**

Run:
```bash
pnpm typecheck
```
Expected: PASS。若出现类型错误，按错误位置修正类型或导入；不要用 `@ts-ignore`、`@ts-expect-error` 或 `any` 掩盖。

- [ ] **Step 5: 生产构建**

Run:
```bash
pnpm build
```
Expected: PASS。Next 16.4.3 默认使用项目本地 `tsc` CLI，TypeScript 7 不需要额外配置 `experimental.useTypeScriptCli`。

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml tsconfig.json
git status --short
# 若 typecheck 修复了源文件，按路径加入同一提交；不要使用 git add -A
git commit -m "chore: upgrade to TypeScript 7"
```

---

### Task 4: 迁移 Zod 4

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `lib/auth/schemas.ts`
- Modify: `lib/auth/middleware.ts`
- Modify: `lib/genealogy/schemas.ts`
- Modify: `lib/config.ts`
- Modify: `app/api/orgs/[orgId]/projects/route.ts`
- Test: `tests/auth-schemas.test.ts`
- Test: `tests/lineage-schemas.test.ts`

**Interfaces:**
- Consumes: `zod@4.6.7`。
- Produces: 导出 schema 名称与推断类型保持不变；`validatedAction` / `validatedActionWithUser` 的泛型约束改为 `z.ZodType`；所有中文校验文案保持原值。

- [ ] **Step 1: 升级 Zod**

把 `"zod": "^3.24.4"` 改为 `"zod": "4.6.7"`，然后：

```bash
pnpm install
```

- [ ] **Step 2: 确认红色状态**

Run:
```bash
pnpm typecheck
pnpm test
```
Expected: FAIL；错误集中在 `required_error`、`invalid_type_error`、`error.errors`、`z.ZodTypeAny` 或 `z.ZodIssueCode`。

- [ ] **Step 3: 替换错误定制 API**

按以下规则修改：

```ts
// Zod 3
z.string({ required_error: '请输入邮箱', invalid_type_error: '邮箱格式不正确' })
// Zod 4
z.string({
  error: (issue) => (issue.input === undefined ? '请输入邮箱' : '邮箱格式不正确'),
})

// 只有一种文案时
z.string({ error: '请输入姓名' })
z.enum(['admin', 'editor', 'viewer'], { error: '请选择角色' })
z.number({ error: '请选择性别' })
z.coerce.number({ error: '分类类型无效' })
```

- [ ] **Step 4: 替换字符串格式校验**

```ts
// Zod 3
z.string().uuid('组织 ID 无效')
z.string().url('BETTER_AUTH_URL must be a valid URL')
// Zod 4
z.uuid('组织 ID 无效')
z.url('BETTER_AUTH_URL must be a valid URL')
```

Zod 4 的 `z.uuid()` 要求 RFC 9562/4122 variant bits 为 `10`，比 Zod 3 更严格。PostgreSQL `uuidv7()` 与仓库测试 UUID 都满足；不要改用 `z.guid()` 放宽校验。

邮箱保留 trim → lowercase → max → email 的顺序：

```ts
const normalizedEmail = z
  .string({
    error: (issue) =>
      issue.input === undefined ? '请输入邮箱' : '邮箱格式不正确',
  })
  .trim()
  .toLowerCase()
  .max(255, '邮箱不能超过 255 个字符')
  .pipe(z.email('邮箱格式不正确'));
```

邀请 ID 保留 trim 后再校验 UUID：

```ts
invitationId: z
  .string({ error: '邀请链接无效' })
  .trim()
  .pipe(z.uuid('邀请链接无效')),
```

- [ ] **Step 5: 替换 custom issue 与错误别名**

把所有：

```ts
code: z.ZodIssueCode.custom
```

改为：

```ts
code: 'custom'
```

把 `lib/auth/middleware.ts` 的：

```ts
error: error.errors[0].message,
```

改为：

```ts
error: error.issues[0].message,
```

把 `z.ZodTypeAny` 改为 `z.ZodType`：

```ts
type ValidatedActionFunction<S extends z.ZodType, T> = (
  data: z.infer<S>,
  formData: FormData
) => Promise<T>;
```

`z.NEVER`、`z.preprocess`、`z.coerce`、`z.RefinementCtx`、`ctx.addIssue` 保持原样。

- [ ] **Step 6: 增加 Zod 4 边界测试**

在 `tests/auth-schemas.test.ts` 增加：

```ts
it('keeps required and invalid-type email messages distinct', () => {
  expect(
    signInSchema.safeParse({ password: 'password123' }).error?.issues[0].message
  ).toBe('请输入邮箱');
  expect(
    signInSchema.safeParse({ email: 123, password: 'password123' }).error
      ?.issues[0].message
  ).toBe('邮箱格式不正确');
});

it('trims an invitation id before uuid validation', () => {
  const result = acceptInviteSchema.safeParse({
    invitationId: '  0190a5b0-0000-7000-8000-000000000001  ',
  });
  expect(result.success).toBe(true);
});
```

在 `tests/lineage-schemas.test.ts` 增加：

```ts
const projectId = '00000000-0000-4000-8000-000000000004';

it('keeps schema-specific messages for folder kind and sex', () => {
  expect(
    createFolderSchema.safeParse({
      orgId,
      projectId,
      kind: '9',
      name: '谱系',
    }).error?.issues[0].message
  ).toBe('分类类型无效');
  expect(
    createRootNodeSchema.safeParse({
      orgId,
      lineageId,
      name: '元英',
      sex: '2',
    }).error?.issues[0].message
  ).toBe('请选择性别');
});
```

在测试文件顶部加入 `createFolderSchema` 到现有 `@/lib/genealogy/schemas` 导入。

- [ ] **Step 7: 运行 Zod 相关测试**

Run:
```bash
pnpm typecheck
pnpm test
pnpm test:integration
```
Expected: 全部 PASS；现有中文文案断言不修改。

- [ ] **Step 8: 提交**

```bash
git add package.json pnpm-lock.yaml lib/auth/schemas.ts lib/auth/middleware.ts lib/genealogy/schemas.ts lib/config.ts 'app/api/orgs/[orgId]/projects/route.ts' tests/auth-schemas.test.ts tests/lineage-schemas.test.ts
git commit -m "refactor: migrate to Zod 4"
```

---

### Task 5: 升级 Vitest 5 与覆盖率工具

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `vitest.coverage.config.ts`
- Modify: `docs/guides/testing.md`（仅当配置语义变化时）

**Interfaces:**
- Consumes: Task 4 的测试套件与 Zod 4 schema。
- Produces: `vitest@5.0.5`、`@vitest/coverage-v8@5.0.5`、`vite@8.3.5`；`pnpm test`、`pnpm test:integration`、`pnpm test:coverage` 脚本保持不变。

- [ ] **Step 1: 更新测试依赖**

```json
"vitest": "5.0.5",
"@vitest/coverage-v8": "5.0.5",
"vite": "8.3.5"
```

然后：

```bash
pnpm install
```

- [ ] **Step 2: 运行单测**

Run:
```bash
pnpm test
```
Expected: PASS。若 Vitest 5 报告 project 配置继承或 `extends` 相关警告，进入下一步处理；否则只更新注释。

- [ ] **Step 3: 校正覆盖率配置**

`vitest.coverage.config.ts` 保留：

```ts
fileParallelism: false,
projects: [
  { extends: './vitest.config.ts', test: { name: 'unit' } },
  {
    extends: './vitest.integration.config.ts',
    test: { name: 'integration' },
  },
],
```

把注释中的 `Vitest 3` 改为 `Vitest 5`。Vitest 5 的内联 project 默认继承根配置；显式 `extends` 仍用于保持 unit 与 integration 的独立配置。不要打开并行；集成测试共享数据库，必须保持串行。

现有覆盖率 `thresholds` 没有 `perFile`，不受 Vitest 5 的 glob 门槛继承变更影响；不要新增 `perFile`。

- [ ] **Step 4: 运行集成测试**

Run:
```bash
pnpm test:integration
```
Expected: PASS；测试文件名仍按顺序执行，数据库清理不会互相截断。

- [ ] **Step 5: 运行合并覆盖率**

Run:
```bash
pnpm test:coverage
```
Expected: PASS；全局与关键模块门槛仍生效，`coverage/` 生成 `text`、`json-summary`、`lcov`。

- [ ] **Step 6: 静态检查**

Run:
```bash
pnpm check && pnpm typecheck
```
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add package.json pnpm-lock.yaml vitest.coverage.config.ts docs/guides/testing.md
git commit -m "test: upgrade to Vitest 5"
```

若 `docs/guides/testing.md` 未改动，从 `git add` 中省略。

---

### Task 6: 升级 Biome 与 dotenv

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `biome.json`
- Modify: `lib/db/drizzle.ts`
- Modify: `lib/db/auth-db.ts`
- Modify: `tests/helpers/db-url.ts`
- Modify: `tests/helpers/db.ts`
- Modify: `scripts/verify-deployment.mjs`

**Interfaces:**
- Consumes: Task 1 的 pnpm 12。
- Produces: `@biomejs/biome@2.6.3`、`dotenv@18.0.9`；dotenv 使用命名导入 `config`，不再依赖默认导入。

- [ ] **Step 1: 更新版本**

```json
"@biomejs/biome": "2.6.3",
"dotenv": "18.0.9"
```

然后：

```bash
pnpm install
```

- [ ] **Step 2: 更新 Biome schema**

把 `biome.json` 的：

```json
"$schema": "https://biomejs.dev/schemas/2.5.15/schema.json"
```

改为：

```json
"$schema": "https://biomejs.dev/schemas/2.6.3/schema.json"
```

- [ ] **Step 3: 改用 dotenv 命名导入**

在以下文件把：

```ts
import dotenv from 'dotenv';
dotenv.config();
```

改为：

```ts
import { config } from 'dotenv';
config();
```

文件：
- `lib/db/drizzle.ts`
- `lib/db/auth-db.ts`
- `tests/helpers/db-url.ts`
- `tests/helpers/db.ts`
- `scripts/verify-deployment.mjs`

- [ ] **Step 4: 运行 Biome 检查**

Run:
```bash
pnpm check
```
Expected: PASS。Biome 2.6 若新增推荐规则导致诊断，只修复这些新诊断；不要扩大规则集，不要全局 `pnpm fix` 后提交无关格式变化。

- [ ] **Step 5: 运行类型与测试**

Run:
```bash
pnpm typecheck && pnpm test && pnpm test:integration
```
Expected: 全部 PASS，dotenv 仍能从 `.env` 加载数据库配置。

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml biome.json lib/db/drizzle.ts lib/db/auth-db.ts tests/helpers/db-url.ts tests/helpers/db.ts scripts/verify-deployment.mjs
git commit -m "chore: upgrade Biome and dotenv"
```

---

### Task 7: 同步目标架构与当前实现文档

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/setup.md`
- Modify: `docs/ops-target.md`
- Modify: `docs/implementation-status.md`
- Modify: `docs/architecture/00-overview.md`
- Modify: `docs/architecture/02-context.md`
- Test: `tests/docs-consistency.test.ts`

**Interfaces:**
- Consumes: Task 1–6 的实际版本与测试输出。
- Produces: 目标文档、当前实现文档、AGENTS 与 `package.json` 的版本基线一致；文档一致性测试与 `pnpm docs:check --strict` 通过。

- [ ] **Step 1: 先写失败的文档一致性测试**

在 `tests/docs-consistency.test.ts` 增加：

```ts
test('documented stack versions match package.json', () => {
  const pkg = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    packageManager: string;
    engines: { node: string };
  };
  const status = read('docs/implementation-status.md');

  expect(pkg.packageManager).toBe('pnpm@12.15.0');
  expect(pkg.engines.node).toBe('>=24.0.0 <25');
  expect(status).toContain(`Next.js ${pkg.dependencies.next}`);
  expect(status).toContain(`React ${pkg.dependencies.react}`);
  expect(status).toContain(`TypeScript ${pkg.devDependencies.typescript}`);
});
```

- [ ] **Step 2: 确认测试失败**

Run:
```bash
pnpm test tests/docs-consistency.test.ts
```
Expected: FAIL，`docs/implementation-status.md` 仍是 `Next.js 16.4.0` / `React 19.1.0`，且没有 TypeScript 7.0.2 行。

- [ ] **Step 3: 更新 `AGENTS.md`**

- 头部“最后更新”改为 `2026-10-25`。
- 技术形态表：
  - 框架：`Next.js 16.4.3 App Router + React 19.3.1`
  - 语言：`TypeScript 7.0.2（strict: true）`
  - 新增运行时行：`Node.js 24 LTS · pnpm 12`
  - 认证保持 `Better Auth 1.7.12`
- 测试统计改为 `pnpm test` / `pnpm test:integration` 的实际输出。

- [ ] **Step 4: 更新 `docs/implementation-status.md`**

- “最后更新”改为 `2026-10-25`。
- 框架行：`Next.js 16.4.3、React 19.3.1`。
- 新增运行时行：`Node.js 24 LTS、pnpm 12.15.0、TypeScript 7.0.2`。
- 数据库行保持 `PostgreSQL 18 + Drizzle 0.45.4`。
- Zustand 行改为 `5.0.16`。
- 测试统计改为实际输出。
- CI 行补充 `Node 24 / pnpm 12`。
- 在 §1 表后增加版本选择说明：Next.js 16.4.3、Drizzle 0.45.4、Better Auth 1.7.12、Playwright 1.64.1 已是当前最新稳定版；Drizzle 1.0 RC、Better Auth 1.8 beta、Playwright 1.65 alpha 不作为基线；Node 24 LTS 而非 Node 26 Current；PostgreSQL 18 是当前可用的最新稳定大版本。

- [ ] **Step 5: 更新 `docs/setup.md`**

- “最后更新”改为 `2026-10-25`。
- 头部运行环境改为 `Node.js 24 LTS（CI）· pnpm 12（CI）`。
- 前置条件表改为 Node.js `24.x LTS`、pnpm `12.x`。
- Corepack 命令改为 `pnpm@12.15.0`。
- “没有 `packageManager` 和 `engines`”改为“通过 `packageManager` / `engines` 固定”；补充 `.nvmrc` 记录 `24.22.1`。
- 补充一句：pnpm 12 从 `pnpm-workspace.yaml` 读取 `allowBuilds`；`onlyBuiltDependencies` 已在 pnpm 11 删除，不要恢复。
- CI 段落改为 Node 24、pnpm 12。
- 保留 PostgreSQL 18、`postgres:18-alpine` 不变。

- [ ] **Step 6: 更新 `docs/ops-target.md`**

- “最后更新”改为 `2026-10-25`。
- 前置条件表 Node.js `24.x LTS`、pnpm `12.x`。
- `corepack prepare pnpm@9` 改为 `pnpm@12`。
- Vercel 项目配置 Node.js `24.x`。
- 保留 Docker 24+、Neon PostgreSQL 18+、Git 2.40+。
- 补一句：Node 26 是 Current，不作为生产基线；PostgreSQL 18 是当前可用的最新稳定大版本，19 尚无稳定镜像。

- [ ] **Step 7: 更新架构文档**

`docs/architecture/00-overview.md`：
- `Next.js 16` → `Next.js 16.4.3`
- `Better Auth 1.7` → `Better Auth 1.7.12`

`docs/architecture/02-context.md`：
- `React 19` → `React 19.3.1`
- `Next.js 16 App Router` → `Next.js 16.4.3 App Router`
- `Vercel（Next.js 16 / Node 22）` → `Vercel（Next.js 16.4.3 / Node 24 LTS）`

`docs/architecture/05-data.md`、`docs/data-model.md`、`docs/architecture/08-evolution.md` 的 PostgreSQL 18+ 保持不变。

- [ ] **Step 8: 跑文档一致性验证**

Run:
```bash
pnpm test tests/docs-consistency.test.ts
pnpm docs:check --strict
```
Expected: PASS，0 issue。

- [ ] **Step 9: 扫描规范性文档中的过期版本**

Run:
```bash
git grep -nE "Node 22|pnpm 9|Next\\.js 16\\.4\\.0|React 19\\.1|TypeScript 5|Zod 3|Vitest 3|Biome 2\\.5" -- \
  AGENTS.md docs/architecture docs/decisions docs/guides \
  docs/setup.md docs/ops-target.md docs/implementation-status.md docs/data-model.md || true
```
Expected: 无输出。`docs/.backup-*`、`docs/reviews/`、`docs/superpowers/plans/2026-10-24-*` 不在扫描范围内。

- [ ] **Step 10: 提交**

```bash
git add AGENTS.md docs/setup.md docs/ops-target.md docs/implementation-status.md docs/architecture/00-overview.md docs/architecture/02-context.md tests/docs-consistency.test.ts
git commit -m "docs: sync latest stable stack baseline"
```

---

### Task 8: 全量回归与发布门禁

**Files:**
- 不新增文件；只修复回归发现的问题。

**Interfaces:**
- Consumes: Task 1–7 的全部改动。
- Produces: 与 CI 等价的本地验证结果；迁移目录无漂移；E2E 与部署验证通过。

- [ ] **Step 1: 冻结安装**

Run:
```bash
pnpm install --frozen-lockfile
```
Expected: PASS。

- [ ] **Step 2: 代码检查、类型检查、单测**

Run:
```bash
pnpm check && pnpm typecheck && pnpm test
```
Expected: 全部 PASS。

- [ ] **Step 3: 集成测试**

Run:
```bash
pnpm test:integration
```
Expected: PASS；使用以 `_test` 结尾的数据库。

- [ ] **Step 4: 合并覆盖率**

Run:
```bash
pnpm test:coverage
```
Expected: PASS；覆盖率门槛不降低。

- [ ] **Step 5: 迁移漂移检查**

Run:
```bash
pnpm db:generate
git status --porcelain lib/db/migrations
```
Expected: 第二条命令无输出。

- [ ] **Step 6: 生产构建**

Run:
```bash
pnpm build
```
Expected: PASS。

- [ ] **Step 7: E2E**

首次运行或浏览器缺失时先执行：

```bash
pnpm exec playwright install chromium
```

然后：

```bash
pnpm test:e2e
```
Expected: PASS；本地模式会重置 `_test` 数据库，不要指向 staging。

- [ ] **Step 8: 部署验证**

Run:
```bash
BETTER_AUTH_URL=http://127.0.0.1:3100 pnpm start -p 3100 > /tmp/gramps-server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
curl -sS --retry 30 --retry-connrefused --retry-delay 2 \
  -o /dev/null http://127.0.0.1:3100/api/health
node scripts/verify-deployment.mjs --base-url http://127.0.0.1:3100
```
Expected: 全项 PASS，包括 PostgreSQL 18+、RLS、角色与安全头检查。

- [ ] **Step 9: 检查工作区**

Run:
```bash
git status --short
```
Expected: 只包含本计划预期的改动；`next-env.d.ts`、`.next/`、`coverage/` 等生成物不进入提交。

- [ ] **Step 10: 仅在需要时提交修复**

若回归发现代码问题：

```bash
git status --short
# 按路径加入修复文件；不要使用 git add -A
git commit -m "fix: resolve latest-stable upgrade regression"
```

若全部通过且无额外改动，本任务不产生新提交。
