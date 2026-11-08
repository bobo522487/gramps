import 'server-only';

import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/drizzle';
import { type Lineage, lineages } from '@/lib/db/schema';
import { withOrgWrite } from '@/lib/db/write';
import type { NodeFailure, NodeMutationResult } from './node-services';

/**
 * Shared write preamble for lineage mutations.
 *
 * Lives in its own file because `lib/lineage/node-services.ts` sits at the
 * `check-file-size.mjs` exemption ceiling and must only shrink.
 *
 * S8 stage A′: the R31 create-idempotency shell (`request_id` lookup + 23505
 * replay) was retired with the target-model `node` table, which has no
 * `request_id` column. `withCreateWrite` is now a thin semantic alias so the
 * four creation call sites keep a single, obvious place to reintroduce
 * idempotency if the target model later gains a submission key.
 */

/** Locks the lineage row so sibling path allocation stays serialized. */
async function loadLineageForUpdate(
  tx: DbTransaction,
  orgId: string,
  lineageId: string
): Promise<Lineage | null> {
  const [lineage] = await tx
    .select()
    .from(lineages)
    .where(and(eq(lineages.id, lineageId), eq(lineages.orgId, orgId)))
    .for('update')
    .limit(1);
  return lineage ?? null;
}

/**
 * Org-scoped transaction, `lineage.write` re-check, then the `FOR UPDATE`
 * lineage lock. The lock is what stops two concurrent writers from allocating
 * the same trailing path segment under one parent.
 */
export async function withLineageWrite<T>(
  params: { userId: string; orgId: string; lineageId: string },
  fn: (tx: DbTransaction, lineage: Lineage) => Promise<T>
): Promise<T | { ok: false; reason: NodeFailure }> {
  const { userId, orgId, lineageId } = params;

  return withOrgWrite(userId, orgId, 'lineage.write', async (tx) => {
    const lineage = await loadLineageForUpdate(tx, orgId, lineageId);
    if (!lineage) {
      return { ok: false, reason: 'not_found' } as const;
    }
    return fn(tx, lineage);
  });
}

/**
 * Creation-path alias. Target-model uniqueness (`node_path_unique`,
 * `node_one_primary`) is enforced by the database; replay protection is a
 * registered follow-up, not a silent `request_id` substitute.
 */
export async function withCreateWrite(
  params: { userId: string; orgId: string; lineageId: string },
  fn: (tx: DbTransaction, lineage: Lineage) => Promise<NodeMutationResult>
): Promise<NodeMutationResult> {
  return withLineageWrite(params, fn) as Promise<NodeMutationResult>;
}
