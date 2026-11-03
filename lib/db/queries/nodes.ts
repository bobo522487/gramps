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
      // 显示序（世次内「长房整支 → 次房整支」的 DFS 序）由
      // `components/lineage/derived.ts` 的 `buildLineageIndex` 唯一决定（R30）。
      // 这里只留一条稳定化排序：`sort` 是同一父节点内的排行，跨房支拿来排全表是错的
      // （旧的 `generation, sort` 序就是世系表交错排列的来源），按 `path` 排也不行
      // （label 是 UUID）。`createdAt, id` 不表达任何显示语义，只是让 derived.ts 的
      // 稳定排序在「同 sort + 同全名」这种并列数据上有个确定的输入序，不至于每次刷新
      // 换个先后（归档计划 2026-10-27 E1 的教训）。
      .orderBy(asc(nodes.createdAt), asc(nodes.id))
  );
}
