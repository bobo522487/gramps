import { createAccessControl } from 'better-auth/plugins/access';

/**
 * 语句表是自有的，不再展开 Better Auth 组织访问控制的默认语句表（T28 拆插件
 * 后随之退役）。organization / member / invitation 三个资源按附录 A.1 的角色
 * 矩阵手写——这正是拆插件的目的之一：权限口径由本仓声明，不由插件默认值决定。
 */
export const statement = {
  organization: ['update', 'delete', 'transfer'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  content: ['read'],
  lineage: ['write', 'delete'],
  article: ['write'],
  book: ['write'],
  project: ['write'],
} as const;

export const ac = createAccessControl(statement);

export const ORG_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_PERMISSIONS = [
  'content.read',
  'lineage.write',
  'lineage.delete',
  'article.write',
  'book.write',
  'project.write',
  'member.invite',
  'member.manage',
  'org.settings',
  'org.transfer',
] as const;
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

export const roles = {
  owner: ac.newRole({
    organization: ['update', 'delete', 'transfer'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
    content: ['read'],
    lineage: ['write', 'delete'],
    article: ['write'],
    book: ['write'],
    project: ['write'],
  }),
  admin: ac.newRole({
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
    content: ['read'],
    lineage: ['write', 'delete'],
    article: ['write'],
    book: ['write'],
    project: ['write'],
  }),
  editor: ac.newRole({
    content: ['read'],
    lineage: ['write'],
    article: ['write'],
    book: ['write'],
  }),
  viewer: ac.newRole({
    content: ['read'],
  }),
};

type PermissionRequest = Parameters<(typeof roles)['owner']['authorize']>[0];

/**
 * Business permissions are coarser than Better Auth resources. Each one maps
 * to the exact access-control request that the documented matrix allows.
 */
export const PERMISSION_REQUESTS: Record<OrgPermission, PermissionRequest> = {
  'content.read': { content: ['read'] },
  'lineage.write': { lineage: ['write'] },
  'lineage.delete': { lineage: ['delete'] },
  'article.write': { article: ['write'] },
  'book.write': { book: ['write'] },
  'project.write': { project: ['write'] },
  'member.invite': { invitation: ['create', 'cancel'] },
  'member.manage': { member: ['create', 'update', 'delete'] },
  'org.settings': { organization: ['update'] },
  'org.transfer': { organization: ['transfer'] },
};

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}
