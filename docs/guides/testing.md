# 测试指南

> **回答什么问题**：这个改动该写哪种测试？测试怎么写？覆盖率门槛是多少？
> **读者**：开发　**长度上限**：2 页
> **性质**：how-to。对应当前仓库真实配置。

---

## 1. 四层，各管一件事

| 层 | 位置 | 命令 | 连数据库 | 跑多快 | 管什么 |
|---|---|---|:--:|---|---|
| 单测 | `tests/*.test.ts` | `pnpm test:unit` | ❌ | 秒级 | 纯函数、schema、权限矩阵、布局计算 |
| 集成 | `tests/integration/*.test.ts` | `pnpm test:integration` | ✅ 真实 PG | 分钟级 | SQL、约束、RLS、事务、Action 行为 |
| 覆盖率 | 合并上面两层 | `pnpm test:coverage` | ✅ | 分钟级 | 门槛检查，CI 用这个 |
| E2E | `tests/e2e/` | `pnpm test:e2e` | ✅ 完整应用 | 分钟级 | 关键路径在真实浏览器里可用 |

另有 `pnpm verify:deploy`（部署就绪检查：健康检查、安全头、鉴权、RLS/角色），不属于测试金字塔，属于发布前门禁。

---

## 2. 决策表：改什么写哪种

| 改动 | 必须写 | 说明 |
|---|---|---|
| 纯函数（布局、排序、派生字段、校验 schema） | 单测 | 不连库，跑得快，是覆盖率的主力 |
| 新增 / 修改 SQL 查询 | 集成 | 单测测不出 SQL 错 |
| 新增表 / 约束 / 索引 | 集成（`constraints.test.ts` 同类） | 断言「非法数据插不进去」 |
| 新增 RLS 策略 | 集成（`org-scope.test.ts` 同类） | 必须有三条：正常 / 跨组织 0 行 / 只读角色被拒 |
| 新增 / 修改 Action | 集成（`actions.test.ts` 同类） | 断言返回值与副作用，不是断言 UI |
| 跨组织、权限、软删语义 | 集成 | 这是数据完整性的核心，不能只靠 E2E |
| 关键用户路径变化（注册、邀请、录入、保存） | E2E | 只维护 2 条主路径，不要铺开 |
| 只改样式 / 文案 | 不写 | 靠 review |

**默认倾向**：能用集成测试验证的，不要用 E2E。E2E 只在「整条链路能否串起来」时才有价值。

---

## 3. 单测

```bash
pnpm test:unit
```

- 环境 `node`，不连数据库。
- `server-only` 被 alias 到 `tests/server-only.stub.ts`，所以服务端模块可以在单测里 import。
- 典型对象：`lib/lineage/node-services.ts` 里的纯计算、`components/lineage/canvas/layout/*`、`lib/genealogy/schemas.ts`、`lib/auth/permissions.ts`。

**写单测的信号**：函数不碰 `db`、不碰 `cookies()`、不碰 `fetch`。碰了就不是单测，去写集成测试。

---

## 4. 集成测试

```bash
pnpm test:integration
```

### 4.1 隔离机制（不要绕过）

| 机制 | 实现 |
|---|---|
| 独立数据库 | 库名必须以 `_test` 结尾（`tests/helpers/db-url.ts` 校验） |
| 建库 | `globalSetup` 先丢弃旧 schema 与扩展，再从空库执行**全部迁移** |
| 用例隔离 | 每个用例开始前清空业务表（`tests/integration/setup.ts`） |
| 串行 | `fileParallelism: false` —— 并发会互相 truncate |

> **不要为了让测试变快而打开并行。** 集成测试共享一个数据库，并行等于互相删数据。

### 4.2 模板

```ts
import { describe, expect, it } from 'vitest';
import { withOrg } from '@/lib/db/drizzle';
import { getThings } from '@/lib/db/queries/things';
import { createOrgWithUser } from '../helpers/factories';

describe('thing 隔离', () => {
  it('跨组织查询返回 0 行', async () => {
    const a = await createOrgWithUser();
    const b = await createOrgWithUser();

    await withOrg(a.userId, (tx) => insertThing(tx, a.orgId, '甲'));

    const rows = await getThings(b.userId, b.orgId, b.projectId);
    expect(rows).toHaveLength(0);
  });

  it('viewer 写入被拒', async () => {
    const { orgId, viewerId } = await createOrgWithUser({ role: 'viewer' });
    await expect(
      withOrg(viewerId, (tx) => insertThing(tx, orgId, '乙')),
    ).rejects.toThrow();
  });
});
```

### 4.3 必须覆盖的四类断言

新增任何带 `organization_id` 的表，这四条是底线：

1. **正常路径**：写入成功，读回来字段一致，冗余计数同步。
2. **跨组织**：用另一组织的 id 读 → 0 行；写 → 被拒。
3. **只读角色**：`viewer` 写 → 被拒。
4. **软删**：软删后默认查询查不到；删了能建同名（部分唯一索引生效）。

### 4.4 RLS 本身的测试

「跨组织 0 行」有两种成因：应用层 `WHERE` 挡住了，或 RLS 挡住了。要单独验证 RLS，必须以 `app_rw` 且**不设 claims** 执行查询，期望 0 行。已有 `tests/integration/org-scope.test.ts` 覆盖，新增表时照它的写法加。

---

## 5. 覆盖率门槛

`pnpm test:coverage`（`vitest.coverage.config.ts`）合并单测 + 集成，V8 provider：

| 范围 | lines | functions | branches | statements |
|---|---:|---:|---:|---:|
| 全局 | 76 | 84 | 65 | 76 |
| `lib/db/queries/**` | 98 | 98 | — | — |
| `lib/project/services.ts` | 92 | 98 | — | — |
| `lib/lineage/node-services.ts` | 84 | 94 | — | — |

不统计：`lib/db/schema/**`、`lib/db/migrations/**`、`lib/db/seed.ts`、`lib/db/drizzle.ts`（驱动工厂）与类型声明。

> **门槛是地板不是目标。** 门槛存在的意义是防止覆盖率倒退，不是「达到 76% 就算测好了」。真正的判据是 §4.3 那四类断言有没有写。每条门槛设在实测基线下方约 2 个百分点：基线涨了就跟着抬，不要为了过而往下调。

---

## 6. E2E

```bash
pnpm test:e2e            # 本地：会重置 _test 库
E2E_EXTERNAL_SERVER=1 E2E_ALLOW_EXTERNAL=1 pnpm test:e2e   # 外部服务
```

**只维护两条主路径**：① 注册 → 建项目 → 建文件夹/谱系 → 录入始祖 → 加子女 → 检查器持久化 → 侧栏搜索/折叠；② 邀请 → 登出 → 登录 → 接受邀请。

**选择器规则**：优先 `role` / `aria-label`，其次可见文案，**最后**才是 `data-testid`。原因：文案改一次测试就红，但 `data-testid` 会腐烂成没人维护的标记。这条规则同时让测试成为无障碍的守门人。

---

## 7. 六个常见陷阱

| 陷阱 | 后果 | 正确做法 |
|---|---|---|
| 集成测试库名不以 `_test` 结尾 | 可能清空开发库 | 用 `tests/helpers/db-url.ts` 校验 |
| 打开 `fileParallelism` | 用例互相 truncate，随机失败 | 保持 `false` |
| 单测里 import 了 `lib/db/drizzle` | 连库、变慢、CI 挂 | 移到集成测试 |
| 只测正常路径 | 跨组织/只读角色漏测，等于没做隔离验证 | 按 §4.3 四条补齐 |
| 断言实现细节（内部函数调用次数） | 重构即红，测试变成负债 | 断言输入 → 输出、数据库状态 |
| E2E 铺很多条 | 维护成本爆炸，红了一片没人看 | 只留两条主路径 |

---

## 8. 提交前

```bash
pnpm check && pnpm typecheck && pnpm test:coverage
pnpm docs:check   # 文档改动必跑；CI 也跑
```

CI 还会额外跑：文档一致性（`pnpm docs:check --strict`）、迁移漂移检查（`pnpm db:generate` 后迁移目录必须无变化）、`build`、`test:e2e`（production server）、`verify:deploy`。
