import 'server-only';

import type { OrgPermission } from '@/lib/auth/access-control';
import { getOrgRoleInTx, hasPermission } from '@/lib/auth/permissions';
import type { DbTransaction } from './drizzle';

/**
 * The single membership + permission check for org-scoped writes. Callers pass
 * the permission string rather than comparing role names, so the matrix stays
 * in lib/auth/access-control.ts.
 */
export async function requireOrgPermission(
  tx: DbTransaction,
  userId: string,
  orgId: string,
  permission: OrgPermission
): Promise<boolean> {
  const role = await getOrgRoleInTx(tx, userId, orgId);
  return Boolean(role && hasPermission(role, permission));
}
