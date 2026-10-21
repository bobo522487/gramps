import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import type { OrgRole } from '@/lib/auth/permissions';
import { verifyToken } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { getOrgWithRoleBySlug } from '@/lib/db/queries/organizations';
import { getProjectScopeByRef } from '@/lib/db/queries/projects';
import { users } from '@/lib/db/schema';
import { isPublicId } from '@/lib/ids';
import { addLogContext } from '@/lib/server/request-context';

/** Authoritative session lookup, memoized once per server render/request. */
export const getSessionUser = cache(async () => {
  const sessionCookie = (await cookies()).get('session');
  if (!sessionCookie?.value) {
    return null;
  }

  const sessionData = await verifyToken(sessionCookie.value);
  if (!sessionData?.user || typeof sessionData.user.id !== 'number') {
    return null;
  }

  if (new Date(sessionData.expires) < new Date()) {
    return null;
  }

  const rows = await db
    .select({
      user: users,
      tokenVersion: sql<number>`coalesce(${users.tokenVersion}, 0)`,
    })
    .from(users)
    .where(and(eq(users.id, sessionData.user.id), isNull(users.deletedAt)))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  // Tokens issued before tokenVersion existed are treated as version 0
  if ((sessionData.tv ?? 0) !== rows[0].tokenVersion) {
    return null;
  }

  addLogContext({ user_id: rows[0].user.id });
  return rows[0].user;
});

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) {
    redirect('/sign-in');
  }
  return user;
}

export const getOrgContext = cache(async (orgSlug: string) => {
  if (!isPublicId(orgSlug)) {
    return null;
  }

  const user = await getSessionUser();
  if (!user) {
    return null;
  }

  const scope = await getOrgWithRoleBySlug(user.id, orgSlug);
  if (!scope) {
    return null;
  }

  return {
    user,
    organization: scope.organization,
    role: scope.role as OrgRole,
  };
});

export async function requireOrgContext(orgSlug: string) {
  if (!isPublicId(orgSlug)) {
    notFound();
  }

  const user = await getSessionUser();
  if (!user) {
    redirect('/sign-in');
  }

  const context = await getOrgContext(orgSlug);
  if (!context) {
    notFound();
  }

  return context;
}

export const getProjectContext = cache(async (projectRef: string) => {
  if (!isPublicId(projectRef)) {
    return null;
  }

  const user = await getSessionUser();
  if (!user) {
    return null;
  }

  const scope = await getProjectScopeByRef(user.id, projectRef);
  if (!scope) {
    return null;
  }

  return {
    user,
    project: scope.project,
    organization: scope.organization,
    role: scope.role as OrgRole,
  };
});

export async function requireProjectContext(projectRef: string) {
  if (!isPublicId(projectRef)) {
    notFound();
  }

  const user = await getSessionUser();
  if (!user) {
    redirect('/sign-in');
  }

  const context = await getProjectContext(projectRef);
  if (!context) {
    notFound();
  }

  return context;
}
