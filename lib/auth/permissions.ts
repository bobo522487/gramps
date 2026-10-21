import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { type DbTransaction, withOrg } from '@/lib/db/drizzle';
import { orgMembers, type User } from '@/lib/db/schema';

export const ORG_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_PERMISSIONS = [
  'content.read',
  'lineage.write',
  'article.write',
  'book.write',
  'project.write',
  'member.invite',
  'member.manage',
  'org.settings',
  'org.transfer',
] as const;
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

/** Roles map to permission strings; business code checks permissions only. */
const ROLE_PERMISSIONS: Record<OrgRole, readonly string[]> = {
  owner: ['*'],
  admin: [
    'content.read',
    'lineage.write',
    'article.write',
    'book.write',
    'project.write',
    'member.invite',
    'member.manage',
  ],
  editor: ['content.read', 'lineage.write', 'article.write', 'book.write'],
  viewer: ['content.read'],
};

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

export function hasPermission(
  role: OrgRole,
  permission: OrgPermission
): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.includes('*') || permissions.includes(permission);
}

const PERMISSION_DENIED_MESSAGES: Record<OrgPermission, string> = {
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
      and(
        eq(orgMembers.orgId, orgId),
        eq(orgMembers.userId, userId),
        isNull(orgMembers.deletedAt)
      )
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

/**
 * Server-side membership check for pages: redirects to /dashboard when the
 * signed-in user lacks the permission.
 */
export async function requireOrgAccess(
  user: User,
  orgId: string,
  permission: OrgPermission = 'content.read'
) {
  const role = await getOrgRole(user.id, orgId);
  if (!role || !hasPermission(role, permission)) {
    redirect('/dashboard');
  }
  return role;
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
