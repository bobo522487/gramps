import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '../drizzle';
import { invitations } from '../schema';

export async function findPendingInvitationByEmail(
  email: string,
  orgId: number
) {
  const rows = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.email, email),
        eq(invitations.orgId, orgId),
        eq(invitations.status, 'pending')
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function createInvitation(params: {
  orgId: number;
  email: string;
  role: string;
  invitedBy: number;
}) {
  await db.insert(invitations).values({ ...params, status: 'pending' });
}
