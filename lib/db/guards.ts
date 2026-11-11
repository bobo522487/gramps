import 'server-only';

import { and, eq } from 'drizzle-orm';
import type { OrgPermission } from '@/lib/auth/access-control';
import { getOrgRoleInTx, hasPermission } from '@/lib/auth/permissions';
import type { DbTransaction } from './drizzle';
import { organizations } from './schema';

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

/** Archived organizations are read-only: every write entry must refuse them. */
export async function isOrgArchivedInTx(
  tx: DbTransaction,
  orgId: string
): Promise<boolean> {
  const rows = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), eq(organizations.status, 'closed')))
    .limit(1);
  return rows.length > 0;
}
