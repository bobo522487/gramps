import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { withOrg } from '../drizzle';
import { type Node, nodes } from '../schema';

export async function getNodes(
  userId: string,
  orgId: string,
  lineageId: string
): Promise<Node[]> {
  return withOrg(userId, (tx) =>
    tx
      .select()
      .from(nodes)
      .where(
        and(
          eq(nodes.orgId, orgId),
          eq(nodes.lineageId, lineageId),
          isNull(nodes.deletedAt)
        )
      )
      .orderBy(asc(nodes.generation), asc(nodes.sort), asc(nodes.createdAt))
  );
}
