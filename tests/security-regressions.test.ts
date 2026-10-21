import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
const orgQueriesSource = read('../lib/db/queries/organizations.ts');
const projectQueriesSource = read('../lib/db/queries/projects.ts');
const usersQueriesSource = read('../lib/db/queries/users.ts');
const drizzleSource = read('../lib/db/drizzle.ts');

describe('auth action source guards', () => {
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

  it('runs every business query as app_rw with verified JWT claims', () => {
    // RLS only protects the app if SET LOCAL role and claims are set in the
    // same transaction; a session-level SET would leak into pooled requests.
    expect(drizzleSource).toContain('set local role app_rw');
    expect(drizzleSource).toContain("set_config('request.jwt.claims'");
  });

  it('reaches auth.users only through SECURITY DEFINER functions', () => {
    expect(usersQueriesSource).toContain('auth.find_user_by_email');
    expect(usersQueriesSource).toContain('auth.get_session_user');
    expect(usersQueriesSource).not.toMatch(/from\(users\)/);
    expect(usersQueriesSource).not.toMatch(/insert\(users\)/);
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
