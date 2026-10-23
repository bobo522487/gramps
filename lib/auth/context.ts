import 'server-only';

import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { getAuth } from '@/lib/auth/better-auth';
import { isOrgRole, type OrgRole } from '@/lib/auth/permissions';
import type { SessionUser } from '@/lib/auth/types';
import { getOrgWithRoleBySlug } from '@/lib/db/queries/organizations';
import { getProjectScopeByRef } from '@/lib/db/queries/projects';
import { isPublicId } from '@/lib/ids';
import { addLogContext } from '@/lib/server/request-context';

/** Authoritative session lookup, memoized once per server render/request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({
    headers: await headers(),
  });
  if (!session?.user) {
    return null;
  }

  addLogContext({ user_id: session.user.id });
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  };
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
