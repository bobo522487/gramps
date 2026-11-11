import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/drizzle';
import { nodes } from '@/lib/db/schema';

/** Four-digit sparse ltree label; +10 leaves gaps for later insertions. */
export const PATH_STEP = 10;

export function segment(value: number): string {
  const label = String(value).padStart(4, '0');
  if (label.length !== 4) {
    throw new Error('node path segment overflow');
  }
  return label;
}

/**
 * Allocates the next path under `parentPath`: the largest trailing segment in
 * that sibling group plus `PATH_STEP`, padded to four digits. Roots have a
 * NULL `parent_path` (generated column) and are grouped together.
 */
export async function nextPath(
  tx: DbTransaction,
  orgId: string,
  lineageId: string,
  parentPath: string | null
): Promise<string> {
  // The trailing segment is the sibling order. Let PostgreSQL return the
  // maximum label instead of pulling every sibling row into Node.
  const [row] = await tx
    .select({
      max: sql<
        string | null
      >`max(split_part(${nodes.path}::text, '.', nlevel(${nodes.path})))`,
    })
    .from(nodes)
    .where(
      and(
        eq(nodes.orgId, orgId),
        eq(nodes.lineageId, lineageId),
        parentPath === null
          ? isNull(nodes.parentPath)
          : sql`${nodes.parentPath} = ${parentPath}::ltree`
      )
    );

  const max = Number.parseInt(row?.max ?? '0', 10) || 0;
  const leaf = segment(max + PATH_STEP);
  return parentPath === null ? leaf : `${parentPath}.${leaf}`;
}
