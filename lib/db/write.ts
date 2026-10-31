import 'server-only';

import type { OrgPermission } from '@/lib/auth/access-control';
import { type DbTransaction, withOrg } from './drizzle';
import { requireOrgPermission } from './guards';

export type OrgWriteRefusal = { ok: false; reason: 'forbidden' };

/**
 * Opens the org-scoped transaction and re-checks the permission inside it, so
 * every write entry point gets the same two step preamble without copying it.
 * Returning a refusal instead of throwing keeps Server Actions on their
 * ActionState contract (see AGENTS §5.2).
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
    return fn(tx);
  });
}
