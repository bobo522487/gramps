import 'server-only';

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import type { OrgRole } from '@/lib/auth/permissions';
import { isOrgRole } from '@/lib/auth/permissions';
import { verifyToken } from '@/lib/auth/session';
import { getOrgWithRoleBySlug } from '@/lib/db/queries/organizations';
import { getProjectScopeByRef } from '@/lib/db/queries/projects';
import { getSessionUserById } from '@/lib/db/queries/users';
import { isPublicId } from '@/lib/ids';
import { addLogContext } from '@/lib/server/request-context';

/** Authoritative session lookup, memoized once per server render/request. */
export const getSessionUser = cache(async () => {
  const sessionCookie = (await cookies()).get('session');
  if (!sessionCookie?.value) {
    return null;
  }

  const sessionData = await verifyToken(sessionCookie.value);
  if (
    !sessionData?.user ||
    typeof sessionData.user.id !== 'string' ||
    !sessionData.user.id
  ) {
    return null;
  }

  if (new Date(sessionData.expires) < new Date()) {
    return null;
  }

  const user = await getSessionUserById(sessionData.user.id);
  if (!user || user.deletedAt) {
    return null;
  }

  // Tokens issued before tokenVersion existed are treated as version 0.
  if ((sessionData.tv ?? 0) !== user.tokenVersion) {
    return null;
  }

  addLogContext({ user_id: user.id });
  return user;
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
  if (!scope || !isOrgRole(scope.role)) {
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
  if (!scope || !isOrgRole(scope.role)) {
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
