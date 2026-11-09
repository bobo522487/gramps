import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ARTICLE_ERRORS } from '@/lib/article/constants';
import { hasPermission } from '@/lib/auth/permissions';

const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), 'utf8');

const actionsSource = [
  read('../lib/auth/actions/session.ts'),
  read('../lib/auth/actions/account.ts'),
  read('../lib/org/actions.ts'),
  read('../lib/project/actions.ts'),
].join('\n');
const actionTypes = read('../lib/auth/types.ts');
const userRouteSource = read('../app/api/user/route.ts');
const rootLayoutSource = read('../app/layout.tsx');
const contextSource = read('../lib/auth/context.ts');
const proxySource = read('../proxy.ts');
const orgQueriesSource = read('../lib/db/queries/organizations.ts');
const projectQueriesSource = read('../lib/db/queries/projects.ts');
const drizzleSource = read('../lib/db/drizzle.ts');

describe('auth action source guards', () => {
  it('never echoes password fields back in action state', () => {
    // Return-position shorthand properties would leak plaintext credentials
    // into the RSC payload, e.g. `return { error, password }`.
    expect(actionsSource).not.toMatch(/return \{[^}]*[\s,]password\s*[,}]/);
    expect(actionsSource).not.toMatch(
      /return \{[^}]*[\s,](currentPassword|newPassword|confirmPassword)\s*[,}]/
    );
  });

  it('does not include password fields in shared ActionState', () => {
    expect(actionTypes).not.toMatch(/password/i);
  });

  it('never serializes the full user row to the browser', () => {
    expect(userRouteSource).not.toContain('passwordHash');
    expect(userRouteSource).not.toMatch(/Response\.json\(user\)/);
    expect(userRouteSource).toContain(
      '{ id: user.id, name: user.name, email: user.email }'
    );
    expect(rootLayoutSource).not.toContain("'/api/user': getUser()");
    expect(rootLayoutSource).toContain(
      '{ id: user.id, name: user.name, email: user.email }'
    );
  });

  it('keeps Better Auth behind the server and Server Actions', () => {
    expect(existsSync(resolve(import.meta.dirname, '../app/api/auth'))).toBe(
      false
    );
    expect(proxySource).toContain('getSessionCookie');
    expect(proxySource).not.toContain('verifySessionToken');
    expect(contextSource).toContain('getAuth().api.getSession');
    expect(contextSource).toMatch(
      /return \{\s*id: session\.user\.id,\s*name: session\.user\.name,\s*email: session\.user\.email,?\s*\}/
    );
  });

  it('has no bcrypt or JWT dependencies left in auth code', () => {
    expect(actionsSource).not.toContain('bcrypt');
    expect(actionsSource).not.toContain('signToken');
    expect(proxySource).not.toContain('jose');
  });
});

describe('article authorization invariants', () => {
  const articleServiceSources = [
    read('../lib/article/services.ts'),
    read('../lib/article/page-services.ts'),
  ].join('\n');
  const articleQuerySource = read('../lib/db/queries/articles.ts');
  const mediaReadSource = read('../app/api/media/[...key]/route.ts');

  it('keeps article writing to the three writer roles', () => {
    for (const role of ['owner', 'admin', 'editor'] as const) {
      expect(hasPermission(role, 'article.write'), role).toBe(true);
    }
    expect(hasPermission('viewer', 'article.write')).toBe(false);
    // 分类管理入口按 project.write 显隐：编辑者看不到，是能力矩阵的现状，不是漏做。
    expect(hasPermission('editor', 'project.write')).toBe(false);
  });

  it('re-checks article.write inside every article write transaction', () => {
    const transactions = articleServiceSources.match(/withOrgWrite\(/g) ?? [];
    const grants = articleServiceSources.match(/'article\.write'/g) ?? [];
    expect(transactions.length).toBeGreaterThan(0);
    expect(grants.length).toBe(transactions.length);
  });

  it('pairs every org-scoped article query with the owning orgId', () => {
    const scopes = articleQuerySource.match(/withOrg\(/g) ?? [];
    const filters = articleQuerySource.match(/orgId, orgId\)/g) ?? [];
    expect(scopes.length).toBeGreaterThan(0);
    expect(filters.length).toBeGreaterThanOrEqual(scopes.length);
  });

  it('answers cross-organization media reads with 404, never 403', () => {
    // 403 会告诉猜测者「这张图存在，只是你不能读」（FR-034）。
    expect(mediaReadSource).toContain('status: 404');
    expect(mediaReadSource).not.toContain('status: 403');
  });

  it('keeps internal details out of the article error copy', () => {
    for (const message of Object.values(ARTICLE_ERRORS)) {
      expect(message).toMatch(/[\u4e00-\u9fa5]/);
      expect(message).not.toMatch(
        /select\s|insert into|update\s|relation|undefined|null/i
      );
      expect(message).not.toMatch(/at\s+\w+\.\w+.*:\d+:\d+/);
    }
  });
});

describe('authorization invariants', () => {
  const functionBody = (source: string, name: string) => {
    const start = source.indexOf(`export async function ${name}`);
    expect(start, `${name} is missing`).toBeGreaterThan(-1);
    const rest = source.slice(start);
    const next = rest.indexOf('\nexport ', 1);
    return next === -1 ? rest : rest.slice(0, next);
  };

  it('pairs every single-project lookup with the owning orgId', () => {
    expect(functionBody(projectQueriesSource, 'getProjectById')).toContain(
      'eq(projects.orgId, orgId)'
    );
  });

  it('resolves public ids through membership-scoped joins', () => {
    const orgScope = functionBody(orgQueriesSource, 'getOrgWithRoleBySlug');
    expect(orgScope).toContain('eq(orgMembers.userId, userId)');
    expect(orgScope).toContain('eq(organizations.slug, slug)');

    const projectScope = functionBody(
      projectQueriesSource,
      'getProjectScopeByRef'
    );
    expect(projectScope).toContain('eq(orgMembers.userId, userId)');
    expect(projectScope).toContain('eq(projects.ref, ref)');
  });

  it('runs every business query as genealogy_app with verified claims', () => {
    // RLS only protects the app if SET LOCAL role and claims are set in the
    // same transaction; a session-level SET would leak into pooled requests.
    // T32 修订后业务连接就是基线的 LOGIN 角色 genealogy_app，不再经 app_rw
    // 收窄；这里只钉死「同事务内先钉角色再注入 GUC」这个边界。
    expect(drizzleSource).toContain('set local role genealogy_app');
    // GUC 名必须是 `app.user_id`：`app.current_user_id()` 读的就是它
    // （docs/data-model.md §3）。旧的 `request.jwt.claims` 没有任何函数读，
    // 写它等于没写——`visible_org_array()` 恒返回空数组，所有组织查询静默 0 行。
    expect(drizzleSource).toContain("set_config('app.user_id'");
    // 用调用形态匹配，避免被解释来龙去脉的注释误伤。
    expect(drizzleSource).not.toMatch(/set_config\('request\.jwt\.claims'/);
  });

  it('keeps organization membership in Better Auth tables only', () => {
    expect(orgQueriesSource).toContain('eq(orgMembers.organizationId');
    expect(orgQueriesSource).not.toContain('orgMembers.deletedAt');
    expect(orgQueriesSource).not.toContain('eq(orgMembers.orgId');
  });

  it('keeps public-id routes behind the membership gate', () => {
    // The context helpers own both the membership-scoped lookup and the 404.
    expect(contextSource).toContain('getOrgWithRoleBySlug(user.id, orgSlug)');
    expect(contextSource).toContain(
      'getProjectScopeByRef(user.id, projectRef)'
    );
    expect(contextSource).toMatch(/notFound\(\)/);

    expect(
      read('../app/(dashboard)/dashboard/org/[orgSlug]/layout.tsx')
    ).toContain('requireOrgContext(orgSlug)');
    expect(
      read('../app/(dashboard)/dashboard/project/[projectRef]/layout.tsx')
    ).toContain('requireProjectContext(projectRef)');
  });
});

// A′10 反转：阶段 A 的临时冻结（P1 读写切换前，谱系写服务不得 import/访问
// 事实层）已随 D2「无生产存量」与回填 CLI 退役而解除。目标态里事实层是唯一
// 真相源，应用写链路必须直接写事实层——旧断言会把正当重构挡在门外，因此从
// 「禁止访问」翻转为「写链路已接入事实层」。语义不变：仍以同一组事实层符号
// 与谱系写文件构成一道护栏，只是方向反过来，防止有人把冻结以别的形式加回
// （例如把 node-services 改回只写 node 的旧形状）。
const FACT_SYMBOLS =
  'persons|personNames|families|familyPartners|familyChildren|events';
const FACT_IMPORT = new RegExp(
  `^import[^;]*\\b(?:${FACT_SYMBOLS})\\b[^;]*from\\s*['"][^'"]*(?:schema|db)(?:/(?:index|person|family|event))?['"]`,
  'm'
);
const FACT_WRITE = new RegExp(
  `\\.(?:insert|update)\\(\\s*(?:${FACT_SYMBOLS})\\b`
);

describe('target-model fact-layer write access (A′10, freeze lifted)', () => {
  const nodeServices = read('../lib/lineage/node-services.ts');

  it('lineage write path imports and writes the fact-layer tables', () => {
    // 目标态应用可写事实层：谱系创建既 import 又 insert 身份 / 姓名表。
    expect(nodeServices).toMatch(FACT_IMPORT);
    expect(nodeServices).toMatch(FACT_WRITE);
  });
});
