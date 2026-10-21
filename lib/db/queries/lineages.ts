import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { withOrg } from '../drizzle';
import { type Lineage, lineages } from '../schema';

export async function getLineages(
  userId: string,
  orgId: string,
  projectId: string
): Promise<Lineage[]> {
  return withOrg(userId, (tx) =>
    tx
      .select()
      .from(lineages)
      .where(
        and(
          eq(lineages.orgId, orgId),
          eq(lineages.projectId, projectId),
          isNull(lineages.deletedAt)
        )
      )
      .orderBy(desc(lineages.createdAt))
  );
}

export async function getLineageById(
  userId: string,
  orgId: string,
  lineageId: string
): Promise<Lineage | null> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(lineages)
      .where(
        and(
          eq(lineages.id, lineageId),
          eq(lineages.orgId, orgId),
          isNull(lineages.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  });
}
