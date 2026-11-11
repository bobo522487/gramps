import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/drizzle';
import { nodes } from '@/lib/db/schema';
import { withLineageWrite } from './lineage-write';
import type { NodeMutationResult } from './node-services';
import { nextPath } from './path';

async function loadNode(
  tx: DbTransaction,
  orgId: string,
  lineageId: string,
  nodeId: string
) {
  const [node] = await tx
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.id, nodeId),
        eq(nodes.orgId, orgId),
        eq(nodes.lineageId, lineageId)
      )
    )
    .limit(1);
  return node ?? null;
}

/**
 * Moves a subtree onto a free slot with one UPDATE. The non-deferrable parent
 * FK is checked at the end of the statement, and `parent_path` is generated
 * from the new path. Sibling reorder still collides and stays unsupported.
 */
export async function moveNodeInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  nodeId: string;
  newParentId: string;
  ipAddress?: string;
}): Promise<NodeMutationResult> {
  const { userId, orgId, lineageId, nodeId, newParentId } = params;
  return withLineageWrite({ userId, orgId, lineageId }, async (tx) => {
    const current = await loadNode(tx, orgId, lineageId, nodeId);
    if (!current) return { ok: false, reason: 'not_found' as const };
    if (!current.parentPath) {
      return { ok: false, reason: 'root_forbidden' as const };
    }

    const parent = await loadNode(tx, orgId, lineageId, newParentId);
    if (!parent) return { ok: false, reason: 'invalid_parent' as const };
    if (
      parent.path === current.path ||
      parent.path.startsWith(`${current.path}.`)
    ) {
      return { ok: false, reason: 'cycle' as const };
    }
    if (parent.path === current.parentPath) {
      return { ok: true as const, node: current };
    }

    const newPath = await nextPath(tx, orgId, lineageId, parent.path);
    const cut = current.path.length + 1;
    // `from $n` without a cast binds as text and picks the pattern form of
    // substring, which glues a match onto the new prefix and fails the
    // four-digit path check. The position form needs an int.
    await tx.execute(sql`
      update ${nodes}
      set path = (${newPath} || substring(${nodes.path}::text from ${cut}::int))::ltree
      where ${nodes.orgId} = ${orgId}
        and ${nodes.lineageId} = ${lineageId}
        and ${nodes.path} <@ ${current.path}::ltree
    `);
    const moved = await loadNode(tx, orgId, lineageId, nodeId);
    if (!moved) throw new Error('moved node disappeared');
    return { ok: true as const, node: moved };
  });
}
