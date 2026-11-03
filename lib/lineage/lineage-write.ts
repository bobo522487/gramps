import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { type DbTransaction, withOrg } from '@/lib/db/drizzle';
import { isUniqueViolation } from '@/lib/db/errors';
import { type Lineage, lineages, nodes } from '@/lib/db/schema';
import { withOrgWrite } from '@/lib/db/write';
import type { NodeFailure, NodeMutationResult } from './node-services';

/**
 * 谱系写入的共享前奏与「创建幂等」外壳（R31）。
 *
 * 单独成文件是因为 `lib/lineage/node-services.ts` 卡在 F6 豁免上限
 * （scripts/check-file-size.mjs：只许缩不许涨），而幂等要覆盖四条创建路径，
 * 逻辑必须有一个不属于任何一条路径的落点。依赖方向单向：本文件只借用
 * node-services 的结果类型，不引用它的运行时代码。
 */

/** Locks the lineage row so node count and root checks stay serialized. */
async function loadLineageForUpdate(
  tx: DbTransaction,
  orgId: string,
  lineageId: string
): Promise<Lineage | null> {
  const [lineage] = await tx
    .select()
    .from(lineages)
    .where(
      and(
        eq(lineages.id, lineageId),
        eq(lineages.orgId, orgId),
        isNull(lineages.deletedAt)
      )
    )
    .for('update')
    .limit(1);
  return lineage ?? null;
}

/**
 * The lineage-write preamble: org-scoped transaction, `lineage.write` re-check,
 * then the `FOR UPDATE` lineage lock. Every node mutation needs all three — the
 * lock is what stops two concurrent writers from computing the same `sort`, the
 * same `node_count`, or overlapping subtree rewrites.
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
 * 该幂等键在本组织已经写下的那一行。共创配偶与血亲同事务落库、不带自己的
 * `request_id`（会和血亲撞同一条唯一索引），所以重放时按 `spouse_of_id` 把它
 * 一起找回，返回值与首次创建完全一致。
 */
async function findCreatedNode(
  tx: DbTransaction,
  orgId: string,
  requestId: string
): Promise<Extract<NodeMutationResult, { ok: true }> | null> {
  const [node] = await tx
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.orgId, orgId),
        eq(nodes.requestId, requestId),
        isNull(nodes.deletedAt)
      )
    )
    .limit(1);
  if (!node) {
    return null;
  }

  const [spouse] = await tx
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.orgId, orgId),
        eq(nodes.spouseOfId, node.id),
        isNull(nodes.deletedAt)
      )
    )
    .orderBy(asc(nodes.sort))
    .limit(1);
  return { ok: true as const, node, ...(spouse ? { spouse } : {}) };
}

/**
 * 创建类写入的幂等外壳（R31）：同一个 `requestId` 的重放不再插入第二行，而是
 * 返回首次写入的那一行——双击、慢网重试、Action 被重放都不会多一个人。
 *
 * 检查发生在 `FOR UPDATE` 谱系锁之后，所以同一谱系的并发重放会排队、第二次直接
 * 命中已有行；跨谱系的同键并发（两把锁互不冲突）由 `uk_node_org_request_id` 兜住：
 * 撞 23505 的那一个整体回滚（不留半成品、也不写活动日志），随后用新的只读事务
 * 取回赢的那一行返回给用户，而不是把冲突抛给他。
 */
export async function withCreateWrite(
  params: {
    userId: string;
    orgId: string;
    lineageId: string;
    requestId: string;
  },
  fn: (tx: DbTransaction, lineage: Lineage) => Promise<NodeMutationResult>
): Promise<NodeMutationResult> {
  try {
    return await withLineageWrite(params, async (tx, lineage) => {
      const replay = await findCreatedNode(tx, params.orgId, params.requestId);
      if (replay) {
        return replay;
      }
      return fn(tx, lineage);
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const raced = await withOrg(params.userId, (tx) =>
      findCreatedNode(tx, params.orgId, params.requestId)
    );
    if (!raced) {
      throw error;
    }
    return raced;
  }
}
