import 'server-only';

import { desc, eq } from 'drizzle-orm';
import { type DbTransaction, withOrg } from '../drizzle';
import { type ActivityType, activityLogs } from '../schema';

export async function getActivityLogs(userId: string) {
  return withOrg(userId, (tx) =>
    tx
      .select({
        id: activityLogs.id,
        action: activityLogs.action,
        timestamp: activityLogs.timestamp,
        ipAddress: activityLogs.ipAddress,
      })
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId))
      .orderBy(desc(activityLogs.timestamp))
      .limit(10)
  );
}

/** Transaction-scoped variant for multi-step services. */
export async function logActivityInTx(
  tx: DbTransaction,
  userId: string,
  orgId: string | null,
  type: ActivityType,
  ipAddress?: string
) {
  await tx.insert(activityLogs).values({
    orgId,
    userId,
    action: type,
    ipAddress: ipAddress || null,
  });
}

/** Account-level events pass a null org instead of guessing one of many. */
export async function logActivity(
  userId: string,
  orgId: string | null,
  type: ActivityType,
  ipAddress?: string
) {
  await withOrg(userId, (tx) =>
    logActivityInTx(tx, userId, orgId, type, ipAddress)
  );
}
