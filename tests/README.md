# 测试说明

## 1. 测试分层与边界

- **单测**：配置 `vitest.config.ts`，`include: ['tests/*.test.ts', 'tests/*.test.tsx']`，`environment: node`。只跑 `tests/` 根下的 `*.test.ts(x)`，测纯函数与领域逻辑，不连库、不起服务。
- **集成**：配置 `vitest.integration.config.ts`，`include: ['tests/integration/**/*.test.ts']`，带 `globalSetup` / `setupFiles`、`fileParallelism: false`。测服务层、查询、云谱空间与人丁写入、RLS 隔离、多步事务与迁移相关行为。**必须用真实 PostgreSQL（CI 容器或事务回滚）**，**不要为了速度在集成测试里 mock 服务层**。
- **E2E**：配置 `playwright.config.ts`，`testDir: ./tests/e2e`，chromium 单 worker 串行，跑真实浏览器关键路径。
- **CI**：`.github/workflows/ci.yml` 起 `postgres:18-alpine` service，先 `pnpm db:migrate`、`Provision runtime login roles`，再跑 `pnpm test:coverage` 与 Playwright E2E 步骤；集成与 E2E 都依赖这套真实库前置。
- **边界**：单测不连库；集成连真实库但不启浏览器与 HTTP 服务；E2E 跑完整应用。

## 2. 用例 ID 回链

- 测试用例 ID 回链需求 `FR-xxx`。
- 代码与 `tests/` 同批提交（依据 `CONTRIBUTING.md` §4 第 6 步 implement）。

## 3. 怎么跑

命令以 `package.json` 的 scripts 为准：

| 命令 | 用途 |
| --- | --- |
| `pnpm test` | `vitest run`，跑单测（默认 `vitest.config.ts`） |
| `pnpm test:integration` | `vitest run --config vitest.integration.config.ts`，跑集成测试 |
| `pnpm test:coverage` | `vitest run --config vitest.coverage.config.ts --coverage`，单测 + 集成一并跑并产出覆盖率，CI 用此步把关 |
| `pnpm test:e2e` | `playwright test`，跑 E2E |

## 4. 覆盖率门槛

覆盖率全局与局部下限的唯一真相源是 `docs/nfr.md` §2；本文件不写数值、不复制阈值表，口径与调整以该文件为准，由 `pnpm test:coverage` 执行把关。
