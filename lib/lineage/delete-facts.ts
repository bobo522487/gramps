import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/drizzle';
import { events, nodes, personNames, persons } from '@/lib/db/schema';

/**
 * Deletes person facts that no node still points at.
 *
 * Order is events, then names, then the person. A future `family_*` row that
 * still references the person fails the person delete with RESTRICT and rolls
 * the whole transaction back, including the node delete that came before it.
 */
export async function deleteUnreferencedPersons(
  tx: DbTransaction,
  scope: { orgId: string; projectId: string },
  personIds: readonly string[]
): Promise<number> {
  const ids = [...new Set(personIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return 0;

  const stillUsed = await tx
    .select({ personId: nodes.personId })
    .from(nodes)
    .where(
      and(
        eq(nodes.orgId, scope.orgId),
        eq(nodes.projectId, scope.projectId),
        inArray(nodes.personId, ids)
      )
    );
  const used = new Set(
    stillUsed
      .map((row) => row.personId)
      .filter((id): id is string => id !== null)
  );
  const orphanIds = ids.filter((id) => !used.has(id));
  if (orphanIds.length === 0) return 0;

  await tx
    .delete(events)
    .where(
      and(
        eq(events.orgId, scope.orgId),
        eq(events.projectId, scope.projectId),
        inArray(events.personId, orphanIds)
      )
    );
  await tx
    .delete(personNames)
    .where(
      and(
        eq(personNames.orgId, scope.orgId),
        eq(personNames.projectId, scope.projectId),
        inArray(personNames.personId, orphanIds)
      )
    );
  const removed = await tx
    .delete(persons)
    .where(
      and(
        eq(persons.orgId, scope.orgId),
        eq(persons.projectId, scope.projectId),
        inArray(persons.id, orphanIds)
      )
    )
    .returning({ id: persons.id });
  return removed.length;
}
