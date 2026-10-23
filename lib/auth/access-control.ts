import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/organization/access';

export const statement = {
  ...defaultStatements,
  organization: [...defaultStatements.organization, 'transfer'],
  content: ['read'],
  lineage: ['write'],
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
    lineage: ['write'],
    article: ['write'],
    book: ['write'],
    project: ['write'],
  }),
  admin: ac.newRole({
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
    content: ['read'],
    lineage: ['write'],
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
