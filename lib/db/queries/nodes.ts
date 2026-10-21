import 'server-only';

import { and, asc, eq, ilike, isNull, sql } from 'drizzle-orm';
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
      .orderBy(
        asc(nodes.generation),
        asc(nodes.depth),
        asc(nodes.sort),
        asc(nodes.createdAt)
      )
  );
}

/** Uses the pg_trgm index on full_name; caller passes an unescaped term. */
export async function searchNodes(
  userId: string,
  orgId: string,
  lineageId: string,
  term: string,
  limit = 50
): Promise<Node[]> {
  const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`);
  return withOrg(userId, (tx) =>
    tx
      .select()
      .from(nodes)
      .where(
        and(
          eq(nodes.orgId, orgId),
          eq(nodes.lineageId, lineageId),
          isNull(nodes.deletedAt),
          ilike(nodes.fullName, `%${escaped}%`)
        )
      )
      .orderBy(asc(nodes.generation), asc(nodes.sort))
      .limit(limit)
  );
}

export async function getNodeById(
  userId: string,
  orgId: string,
  lineageId: string,
  nodeId: string
): Promise<Node | null> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(nodes)
      .where(
        and(
          eq(nodes.id, nodeId),
          eq(nodes.orgId, orgId),
          eq(nodes.lineageId, lineageId),
          isNull(nodes.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function countNodes(
  userId: string,
  orgId: string,
  lineageId: string
): Promise<number> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(nodes)
      .where(
        and(
          eq(nodes.orgId, orgId),
          eq(nodes.lineageId, lineageId),
          isNull(nodes.deletedAt)
        )
      );
    return rows[0]?.value ?? 0;
  });
}
