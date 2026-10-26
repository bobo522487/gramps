import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { type DbTransaction, withOrg } from '@/lib/db/drizzle';
import { isUniqueViolation } from '@/lib/db/errors';
import { requireOrgPermission } from '@/lib/db/guards';
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
import { DEFAULT_LINEAGE_FOLDER_NAME } from '@/lib/lineage/constants';

type LineageFailure =
  | 'forbidden'
  | 'not_found'
  | 'invalid_folder'
  | 'conflict'
  | 'referenced'
  | 'project_surname_missing';

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
        eq(folders.projectId, projectId),
        eq(folders.kind, 0),
        isNull(folders.deletedAt)
      )
    )
    .limit(1);
  return Boolean(folder);
}

/**
 * 创建谱系时确定归属分类。项目还没有分类时，在同一事务内创建或复用
 * 「默认分类」，让只有 lineage.write 的编辑者也不会卡死。
 */
async function resolveFolderInTx(
  tx: DbTransaction,
  params: {
    orgId: string;
    projectId: string;
    userId: string;
    folderId?: string;
  }
): Promise<string> {
  const { orgId, projectId, userId, folderId } = params;
  if (folderId) {
    return folderId;
  }

  const [existing] = await tx
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.orgId, orgId),
        eq(folders.projectId, projectId),
        eq(folders.kind, 0),
        isNull(folders.parentId),
        eq(folders.name, DEFAULT_LINEAGE_FOLDER_NAME),
        isNull(folders.deletedAt)
      )
    )
    .limit(1);
  if (existing) {
    return existing.id;
  }

  const [created] = await tx
    .insert(folders)
    .values({
      orgId,
      projectId,
      kind: 0,
      parentId: null,
      name: DEFAULT_LINEAGE_FOLDER_NAME,
      createdBy: userId,
    })
    .returning({ id: folders.id });

  if (!created) {
    throw new Error('failed to create the default lineage folder');
  }
  return created.id;
}

export async function createLineageInTransaction(params: {
  userId: string;
  orgId: string;
  projectId: string;
  folderId?: string;
  name: string;
  region: string;
  hallCode?: string;
  notes?: string;
  ipAddress?: string;
}): Promise<LineageMutationResult> {
  const {
    userId,
    orgId,
    projectId,
    folderId,
    name,
    region,
    hallCode,
    notes,
    ipAddress,
  } = params;

  try {
    return await withOrg(userId, async (tx) => {
      if (!(await requireOrgPermission(tx, userId, orgId, 'lineage.write'))) {
        return { ok: false, reason: 'forbidden' as const };
      }

      const [project] = await tx
        .select({ id: projects.id, surname: projects.surname })
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

      const projectSurname = project.surname?.trim();
      if (!projectSurname) {
        return { ok: false, reason: 'project_surname_missing' as const };
      }

      const resolvedFolderId = await resolveFolderInTx(tx, {
        orgId,
        projectId,
        userId,
        folderId,
      });

      const [lineage] = await tx
        .insert(lineages)
        .values({
          orgId,
          projectId,
          folderId: resolvedFolderId,
          name,
          surname: projectSurname,
          region,
          notes: notes ?? null,
          hallCode: hallCode ?? null,
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
  hallCode?: string | null;
  region?: string | null;
  notes?: string | null;
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
      if (!(await requireOrgPermission(tx, userId, orgId, 'lineage.write'))) {
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

      // 白名单写入：姓氏只能继承项目，任何调用方都无法通过更新改它。
      const mutable: LineageUpdates = {};
      if (updates.folderId !== undefined) mutable.folderId = updates.folderId;
      if (updates.name !== undefined) mutable.name = updates.name;
      if (updates.hallCode !== undefined) mutable.hallCode = updates.hallCode;
      if (updates.region !== undefined) mutable.region = updates.region;
      if (updates.notes !== undefined) mutable.notes = updates.notes;
      if (updates.generationWords !== undefined) {
        mutable.generationWords = updates.generationWords;
      }

      const [lineage] = await tx
        .update(lineages)
        .set({ ...mutable, updatedAt: new Date() })
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
    if (!(await requireOrgPermission(tx, userId, orgId, 'lineage.write'))) {
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
