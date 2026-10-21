import 'server-only';

import { redirect } from 'next/navigation';
import { getOrgRoleForUser } from '@/lib/db/queries/organizations';
import type { User } from '@/lib/db/schema';

export type OrgRole = 'owner' | 'member';

const ROLE_LEVEL: Record<OrgRole, number> = {
  member: 1,
  owner: 2,
};

/** Returns the user's role in the org, or null when they are not a member. */
export async function getOrgRole(
  userId: number,
  orgId: number
): Promise<OrgRole | null> {
  const role = await getOrgRoleForUser(userId, orgId);
  return (role as OrgRole) ?? null;
}

/**
 * Server-side membership check for pages: redirects to /dashboard when the
 * signed-in user cannot access the org.
 */
export async function requireOrgAccess(
  user: User,
  orgId: number,
  minRole: OrgRole = 'member'
) {
  const role = await getOrgRole(user.id, orgId);
  if (!role || ROLE_LEVEL[role] < ROLE_LEVEL[minRole]) {
    redirect('/dashboard');
  }
  return role;
}

/** Action-side check: returns an error message instead of redirecting. */
export async function checkOrgRole(
  userId: number,
  orgId: number,
  minRole: OrgRole = 'member'
): Promise<string | null> {
  const role = await getOrgRole(userId, orgId);
  if (!role) {
    return '你不是该组织的成员';
  }
  if (ROLE_LEVEL[role] < ROLE_LEVEL[minRole]) {
    return minRole === 'owner'
      ? '只有所有者可以执行此操作'
      : '你没有执行此操作的权限';
  }
  return null;
}
