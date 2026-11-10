import 'server-only';

import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/drizzle';
import { isUniqueViolation } from '@/lib/db/errors';
import {
  bookCatalogs,
  folders,
  type Lineage,
  lineages,
  nodes,
  projects,
} from '@/lib/db/schema';
import { withOrgWrite } from '@/lib/db/write';
import { ensureDefaultFolderInTx } from '@/lib/folder/services';

type LineageFailure =
  | 'forbidden'
  | 'not_found'
  | 'invalid_folder'
  | 'conflict'
  | 'referenced';

export type LineageMutationResult =
  | { ok: true; lineage: Lineage }
  | { ok: false; reason: LineageFailure };

async function validProjectFolder(
  tx: DbTransaction,
  orgId: string,
  projectId: string,
  folderId: string
) {
  const [folder] = await tx
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.orgId, orgId),
        eq(folders.projectId, projectId)
      )
    )
    .limit(1);
  return Boolean(folder);
}

/**
 * Target-model `lineage` (appendix A.4) carries only name / description /
 * poem text / base generation / display order. The project surname, hall code,
 * region, notes, generation words and node counter were all retired; the form
 * still posts them, and `lib/lineage/actions.ts` deliberately drops them.
 */
export async function createLineageInTransaction(params: {
  userId: string;
  orgId: string;
  projectId: string;
  folderId?: string;
  name: string;
  ipAddress?: string;
}): Promise<LineageMutationResult> {
  const { userId, orgId, projectId, folderId, name } = params;

  try {
    return await withOrgWrite(userId, orgId, 'lineage.write', async (tx) => {
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
        .limit(1);
      if (!project) {
        return { ok: false, reason: 'not_found' as const };
      }
      if (
        folderId &&
        !(await validProjectFolder(tx, orgId, projectId, folderId))
      ) {
        return { ok: false, reason: 'invalid_folder' as const };
      }

      const resolvedFolderId =
        folderId ?? (await ensureDefaultFolderInTx(tx, orgId, projectId));

      const [lineage] = await tx
        .insert(lineages)
        .values({
          orgId,
          projectId,
          folderId: resolvedFolderId,
          name,
        })
        .returning();

      return { ok: true as const, lineage };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: 'conflict' };
    }
    throw error;
  }
}

export type LineageUpdates = {
  folderId?: string | null;
  name?: string;
  description?: string | null;
  poemText?: string | null;
  baseGeneration?: number;
  seq?: number;
};

export async function updateLineageInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  updates: LineageUpdates;
  ipAddress?: string;
}): Promise<LineageMutationResult> {
  const { userId, orgId, lineageId, updates } = params;

  try {
    return await withOrgWrite(userId, orgId, 'lineage.write', async (tx) => {
      const [current] = await tx
        .select()
        .from(lineages)
        .where(and(eq(lineages.id, lineageId), eq(lineages.orgId, orgId)))
        .limit(1);
      if (!current) {
        return { ok: false, reason: 'not_found' as const };
      }

      if (
        updates.folderId &&
        !(await validProjectFolder(
          tx,
          orgId,
          current.projectId,
          updates.folderId
        ))
      ) {
        return { ok: false, reason: 'invalid_folder' as const };
      }

      // Whitelist: only target-model columns may ever be written.
      const mutable: LineageUpdates = {};
      if (updates.folderId !== undefined) mutable.folderId = updates.folderId;
      if (updates.name !== undefined) mutable.name = updates.name;
      if (updates.description !== undefined) {
        mutable.description = updates.description;
      }
      if (updates.poemText !== undefined) mutable.poemText = updates.poemText;
      if (updates.baseGeneration !== undefined) {
        mutable.baseGeneration = updates.baseGeneration;
      }
      if (updates.seq !== undefined) mutable.seq = updates.seq;

      const [lineage] = await tx
        .update(lineages)
        .set(mutable)
        .where(eq(lineages.id, lineageId))
        .returning();

      return { ok: true as const, lineage };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: 'conflict' };
    }
    throw error;
  }
}

export type DeleteLineageResult =
  | { ok: true; deletedNodes: number }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'referenced' };

export async function deleteLineageInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  ipAddress?: string;
}): Promise<DeleteLineageResult> {
  const { userId, orgId, lineageId } = params;

  return withOrgWrite(userId, orgId, 'lineage.delete', async (tx) => {
    const [lineage] = await tx
      .select({ id: lineages.id })
      .from(lineages)
      .where(and(eq(lineages.id, lineageId), eq(lineages.orgId, orgId)))
      .limit(1);
    if (!lineage) {
      return { ok: false, reason: 'not_found' as const };
    }

    const [reference] = await tx
      .select({ id: bookCatalogs.id })
      .from(bookCatalogs)
      .where(
        and(
          eq(bookCatalogs.orgId, orgId),
          eq(bookCatalogs.lineageId, lineageId)
        )
      )
      .limit(1);
    if (reference) {
      return { ok: false, reason: 'referenced' as const };
    }

    // Hard delete (RESTRICT semantics): the target model has no soft-delete
    // column. Nodes go first so the lineage foreign key is satisfied.
    const deletedNodes = await tx
      .delete(nodes)
      .where(and(eq(nodes.orgId, orgId), eq(nodes.lineageId, lineageId)))
      .returning({ id: nodes.id });

    await tx
      .delete(lineages)
      .where(and(eq(lineages.id, lineageId), eq(lineages.orgId, orgId)));

    return { ok: true as const, deletedNodes: deletedNodes.length };
  });
}
