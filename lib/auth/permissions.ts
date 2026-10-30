import 'server-only';

import { and, eq } from 'drizzle-orm';
import {
  isOrgRole,
  ORG_PERMISSIONS,
  ORG_ROLES,
  type OrgPermission,
  type OrgRole,
  PERMISSION_REQUESTS,
  roles,
} from '@/lib/auth/access-control';
import { type DbTransaction, withOrg } from '@/lib/db/drizzle';
import { orgMembers } from '@/lib/db/schema';

export type { OrgPermission, OrgRole };
export { isOrgRole, ORG_PERMISSIONS, ORG_ROLES };

export function hasPermission(
  role: OrgRole,
  permission: OrgPermission
): boolean {
  return roles[role].authorize(PERMISSION_REQUESTS[permission]).success;
}

export const PERMISSION_DENIED_MESSAGES: Record<OrgPermission, string> = {
  'content.read': '你不是该组织的成员',
  'lineage.write': '你没有编辑谱系的权限',
  'article.write': '你没有撰写谱文的权限',
  'book.write': '你没有编排谱书的权限',
  'project.write': '只有所有者或管理员可以管理云谱空间',
  'member.invite': '只有所有者或管理员可以邀请成员',
  'member.manage': '只有所有者或管理员可以管理成员',
  'org.settings': '只有所有者可以修改组织设置',
  'org.transfer': '只有所有者可以转让所有权',
};

/** Role lookup inside an existing transaction (RLS already limits rows). */
export async function getOrgRoleInTx(
  tx: DbTransaction,
  userId: string,
  orgId: string
): Promise<OrgRole | null> {
  const rows = await tx
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(
      and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, userId))
    )
    .limit(1);

  const role = rows[0]?.role;
  return role && isOrgRole(role) ? role : null;
}

/** Returns the user's role in the org, or null when they are not a member. */
export async function getOrgRole(
  userId: string,
  orgId: string
): Promise<OrgRole | null> {
  return withOrg(userId, (tx) => getOrgRoleInTx(tx, userId, orgId));
}

/** Action-side check: returns an error message instead of redirecting. */
export async function checkOrgPermission(
  userId: string,
  orgId: string,
  permission: OrgPermission
): Promise<string | null> {
  const role = await getOrgRole(userId, orgId);
  if (!role) {
    return '你不是该组织的成员';
  }
  return hasPermission(role, permission)
    ? null
    : PERMISSION_DENIED_MESSAGES[permission];
}
