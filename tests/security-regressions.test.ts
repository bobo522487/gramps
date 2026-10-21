import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const orgDirectory = vi.hoisted(() => ({
  // userId -> memberships, so tests can stage cross-org users
  memberships: {} as Record<
    number,
    { organization: { id: number }; role: string }[]
  >,
}));

vi.mock('@/lib/db/queries/organizations', () => ({
  getOrgRoleForUser: async (userId: number, orgId: number) =>
    orgDirectory.memberships[userId]?.find(
      (membership) => membership.organization.id === orgId
    )?.role ?? null,
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));

const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), 'utf8');

const actionsSource = [
  read('../lib/auth/actions/session.ts'),
  read('../lib/auth/actions/account.ts'),
  read('../lib/org/actions.ts'),
].join('\n');
const orgActionsSource = read('../lib/org/actions.ts');
const projectActionsSource = read('../lib/project/actions.ts');
const middlewareTypes = read('../lib/auth/types.ts');
const userRouteSource = read('../app/api/user/route.ts');
const rootLayoutSource = read('../app/layout.tsx');

describe('auth actions source guards', () => {
  it('never echoes password fields back in action state', () => {
    // Return-position shorthand properties would leak plaintext credentials
    // into the RSC payload, e.g. `return { error, password }`.
    for (const field of [
      'password,',
      'currentPassword,',
      'newPassword,',
      'confirmPassword,',
    ]) {
      expect(actionsSource).not.toContain(`\n        ${field}`);
    }
    expect(actionsSource).not.toMatch(/return \{[^}]*[\s,]password\s*[,}]/);
    expect(actionsSource).not.toMatch(
      /return \{[^}]*[\s,](currentPassword|newPassword|confirmPassword)\s*[,}]/
    );
  });

  it('equalizes sign-in timing for unknown emails', () => {
    // Without the dummy comparison, response time reveals registered emails
    expect(actionsSource).toMatch(
      /if \(!foundUser\) \{[\s\S]*?comparePasswords\(\s*password,\s*DUMMY_PASSWORD_HASH\s*\)/
    );
  });

  it('does not include password fields in shared ActionState', () => {
    expect(middlewareTypes).not.toMatch(/password/i);
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

  it('org member actions enforce owner role server-side', () => {
    expect(orgActionsSource).toContain("checkOrgRole(user.id, orgId, 'owner')");
    expect(orgActionsSource).toContain('只有所有者可以邀请组织成员');
  });

  it('org-scoped writes never trust a bare id without membership check', () => {
    // Every mutation in org/project actions must call checkOrgRole first
    for (const source of [orgActionsSource, projectActionsSource]) {
      const mutations = (source.match(/export const \w+Action/g) ?? []).length;
      const checks = (source.match(/checkOrgRole/g) ?? []).length;
      expect(checks).toBeGreaterThanOrEqual(mutations);
    }
  });
});

describe('cross-organization isolation', () => {
  const queriesSource = [
    read('../lib/db/queries/organizations.ts'),
    read('../lib/db/queries/projects.ts'),
  ].join('\n');
  const contextSource = read('../lib/auth/context.ts');

  const functionBody = (name: string) => {
    const start = queriesSource.indexOf(`export async function ${name}`);
    expect(start, `${name} is missing from queries.ts`).toBeGreaterThan(-1);
    const rest = queriesSource.slice(start);
    const next = rest.indexOf('\nexport ', 1);
    return next === -1 ? rest : rest.slice(0, next);
  };

  it('pairs every single-project lookup with the owning orgId', () => {
    for (const name of ['getProjectById', 'updateProject', 'deleteProject']) {
      expect(functionBody(name)).toMatch(/eq\(projects\.orgId, orgId\)/);
    }
  });

  it('resolves public ids through membership-scoped joins', () => {
    // Slug/ref URLs are guessable; the user join is the authorization gate
    const orgScope = functionBody('getOrgWithRoleBySlug');
    expect(orgScope).toContain('eq(orgMembers.userId, userId)');
    expect(orgScope).toContain('eq(organizations.slug, slug)');

    const projectScope = functionBody('getProjectScopeByRef');
    expect(projectScope).toContain('eq(orgMembers.userId, userId)');
    expect(projectScope).toContain('eq(projects.ref, ref)');
    expect(projectScope).not.toContain('getProjects(');
  });

  it('rejects a non-member who guesses another org id', async () => {
    orgDirectory.memberships = {
      1: [{ organization: { id: 1 }, role: 'member' }],
      2: [],
    };
    const { checkOrgRole, requireOrgAccess } = await import(
      '@/lib/auth/permissions'
    );

    expect(await checkOrgRole(2, 1, 'member')).toBe('你不是该组织的成员');
    await expect(
      requireOrgAccess({ id: 2 } as never, 1, 'owner')
    ).rejects.toThrow('REDIRECT /dashboard');
  });

  it('rejects a member who tries an owner-only action', async () => {
    orgDirectory.memberships = {
      1: [{ organization: { id: 1 }, role: 'member' }],
    };
    const { checkOrgRole } = await import('@/lib/auth/permissions');

    expect(await checkOrgRole(1, 1, 'member')).toBeNull();
    expect(await checkOrgRole(1, 1, 'owner')).toBe('只有所有者可以执行此操作');
  });

  it('keeps public-id routes behind the membership gate', () => {
    // The context helpers own both the membership-scoped lookup and the 404.
    expect(contextSource).toContain('getOrgWithRoleBySlug(user.id, orgSlug)');
    expect(contextSource).toContain(
      'getProjectScopeByRef(user.id, projectRef)'
    );
    expect(contextSource).toMatch(/notFound\(\)/);

    const orgLayout = read(
      '../app/(dashboard)/dashboard/org/[orgSlug]/layout.tsx'
    );
    expect(orgLayout).toContain('requireOrgContext(orgSlug)');

    const projectLayout = read(
      '../app/(dashboard)/dashboard/project/[projectRef]/layout.tsx'
    );
    expect(projectLayout).toContain('requireProjectContext(projectRef)');
  });
});
