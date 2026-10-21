import 'server-only';

import { desc, eq } from 'drizzle-orm';
import { db } from '../drizzle';
import type { ActivityType } from '../schema';
import { activityLogs } from '../schema';

export async function getActivityLogs(userId: number) {
  return await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      timestamp: activityLogs.timestamp,
      ipAddress: activityLogs.ipAddress,
    })
    .from(activityLogs)
    .where(eq(activityLogs.userId, userId))
    .orderBy(desc(activityLogs.timestamp))
    .limit(10);
}

/** Account-level events pass a null org instead of guessing one of many. */
export async function logActivity(
  orgId: number | null | undefined,
  userId: number,
  type: ActivityType,
  ipAddress?: string
) {
  await db.insert(activityLogs).values({
    orgId: orgId ?? null,
    userId,
    action: type,
    ipAddress: ipAddress || '',
  });
}
