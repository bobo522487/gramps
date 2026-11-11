import 'server-only';

import type { OrgPermission } from '@/lib/auth/access-control';
import { type DbTransaction, withOrg } from './drizzle';
import { isOrgArchivedInTx, requireOrgPermission } from './guards';

export type OrgWriteRefusal = {
  ok: false;
  reason: 'forbidden' | 'org_archived';
};

/**
 * Opens the org-scoped transaction and re-checks the permission inside it, so
 * every write entry point gets the same two step preamble without copying it.
 * Returning a refusal instead of throwing keeps Server Actions on their
 * ActionState contract.
 */
export async function withOrgWrite<T>(
  userId: string,
  orgId: string,
  permission: OrgPermission,
  fn: (tx: DbTransaction) => Promise<T>
): Promise<T | OrgWriteRefusal> {
  return withOrg(userId, async (tx) => {
    if (!(await requireOrgPermission(tx, userId, orgId, permission))) {
      return { ok: false, reason: 'forbidden' } as const;
    }
    // 归档组织保持只读：页面入口由 notClosed 拦，写事务在这里补同一道闸门。
    if (await isOrgArchivedInTx(tx, orgId)) {
      return { ok: false, reason: 'org_archived' } as const;
    }
    return fn(tx);
  });
}
