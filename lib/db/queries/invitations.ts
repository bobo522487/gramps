import 'server-only';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { DbTransaction } from '../drizzle';
import type { Invitation } from '../schema';
import { invitations } from '../schema';

/** Pending invites are accepted_at IS NULL, not expired and not deleted. */
export async function findPendingInvitationInTx(
  tx: DbTransaction,
  email: string,
  orgId: string
): Promise<Invitation | null> {
  const rows = await tx
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.orgId, orgId),
        sql`lower(${invitations.email}) = ${email}`,
        isNull(invitations.acceptedAt),
        isNull(invitations.deletedAt),
        gt(invitations.expiresAt, new Date())
      )
    )
    .limit(1);

  return rows[0] ?? null;
}
