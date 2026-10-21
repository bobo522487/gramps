import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { getOrgRoleInTx, hasPermission } from '@/lib/auth/permissions';
import { type DbTransaction, withOrg } from '@/lib/db/drizzle';
import { isUniqueViolation } from '@/lib/db/errors';
import { logActivityInTx } from '@/lib/db/queries/activity';
import {
  ActivityType,
  bookCatalogs,
  folders,
  type Lineage,
  lineages,
  nodes,
  projects,
} from '@/lib/db/schema';

type LineageFailure =
  | 'forbidden'
  | 'not_found'
  | 'invalid_folder'
  | 'conflict'
  | 'referenced';

export type LineageMutationResult =
  | { ok: true; lineage: Lineage }
  | { ok: false; reason: LineageFailure };

async function requireLineageWrite(
  tx: DbTransaction,
  userId: string,
  orgId: string
) {
  const role = await getOrgRoleInTx(tx, userId, orgId);
  return Boolean(role && hasPermission(role, 'lineage.write'));
}

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
        eq(folders.projectId, projectId),
        eq(folders.kind, 0),
        isNull(folders.deletedAt)
      )
    )
    .limit(1);
  return Boolean(folder);
}

export async function createLineageInTransaction(params: {
  userId: string;
  orgId: string;
  projectId: string;
  folderId?: string;
  name: string;
  surname: string;
  hallCode?: string;
  generationWords?: string[];
  ipAddress?: string;
}): Promise<LineageMutationResult> {
  const {
    userId,
    orgId,
    projectId,
    folderId,
    name,
    surname,
    hallCode,
    generationWords,
    ipAddress,
  } = params;

  try {
    return await withOrg(userId, async (tx) => {
      if (!(await requireLineageWrite(tx, userId, orgId))) {
        return { ok: false, reason: 'forbidden' as const };
      }

      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.orgId, orgId),
            isNull(projects.deletedAt)
          )
        )
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

      const [lineage] = await tx
        .insert(lineages)
        .values({
          orgId,
          projectId,
          folderId: folderId ?? null,
          name,
          surname,
          hallCode: hallCode ?? null,
          generationWords: generationWords ?? null,
          createdBy: userId,
        })
        .returning();

      await logActivityInTx(
        tx,
        userId,
        orgId,
        ActivityType.CREATE_LINEAGE,
        ipAddress
      );
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
  surname?: string;
  hallCode?: string | null;
  generationWords?: string[];
};

export async function updateLineageInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  updates: LineageUpdates;
  ipAddress?: string;
}): Promise<LineageMutationResult> {
  const { userId, orgId, lineageId, updates, ipAddress } = params;

  try {
    return await withOrg(userId, async (tx) => {
      if (!(await requireLineageWrite(tx, userId, orgId))) {
        return { ok: false, reason: 'forbidden' as const };
      }

      const [current] = await tx
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

      const [lineage] = await tx
        .update(lineages)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(lineages.id, lineageId))
        .returning();

      await logActivityInTx(
        tx,
        userId,
        orgId,
        ActivityType.UPDATE_LINEAGE,
        ipAddress
      );
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
  const { userId, orgId, lineageId, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    if (!(await requireLineageWrite(tx, userId, orgId))) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const [lineage] = await tx
      .select({ id: lineages.id })
      .from(lineages)
      .where(
        and(
          eq(lineages.id, lineageId),
          eq(lineages.orgId, orgId),
          isNull(lineages.deletedAt)
        )
      )
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
          eq(bookCatalogs.lineageId, lineageId),
          isNull(bookCatalogs.deletedAt)
        )
      )
      .limit(1);
    if (reference) {
      return { ok: false, reason: 'referenced' as const };
    }

    const deletedNodes = await tx
      .update(nodes)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(nodes.orgId, orgId),
          eq(nodes.lineageId, lineageId),
          isNull(nodes.deletedAt)
        )
      )
      .returning({ id: nodes.id });

    await tx
      .update(lineages)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(lineages.id, lineageId));

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.DELETE_LINEAGE,
      ipAddress
    );

    return { ok: true as const, deletedNodes: deletedNodes.length };
  });
}
