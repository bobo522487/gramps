import 'server-only';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/drizzle';
import {
  articles,
  books,
  type Folder,
  folders,
  lineages,
  projects,
} from '@/lib/db/schema';
import { withOrgWrite } from '@/lib/db/write';

type FolderFailure =
  | 'forbidden'
  | 'not_found'
  | 'invalid_parent'
  | 'depth_exceeded';

export type FolderMutationResult =
  | { ok: true; folder: Folder }
  | { ok: false; reason: FolderFailure };

async function assertProjectInOrg(
  tx: DbTransaction,
  orgId: string,
  projectId: string
) {
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1);
  return Boolean(project);
}

async function loadActiveFolders(
  tx: DbTransaction,
  orgId: string,
  projectId: string,
  kind: number
): Promise<Folder[]> {
  return tx
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.orgId, orgId),
        eq(folders.projectId, projectId),
        eq(folders.kind, kind)
      )
    )
    .orderBy(asc(folders.sort), asc(folders.createdAt));
}

function folderDepth(byId: Map<string, Folder>, folder: Folder): number {
  let depth = 1;
  let current = folder;
  const seen = new Set<string>([folder.id]);
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) {
      break;
    }
    seen.add(parent.id);
    depth += 1;
    current = parent;
  }
  return depth;
}

/** 同层下一个 sort 值；谱文侧创建「默认分类」要复用同一个算法。 */
export async function nextFolderSort(
  tx: DbTransaction,
  orgId: string,
  projectId: string,
  kind: number,
  parentId: string | null
) {
  const [row] = await tx
    .select({ value: sql<number>`coalesce(max(${folders.sort}), -1)::int` })
    .from(folders)
    .where(
      and(
        eq(folders.orgId, orgId),
        eq(folders.projectId, projectId),
        eq(folders.kind, kind),
        parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId)
      )
    );
  return (row?.value ?? -1) + 1;
}

export async function createFolderInTransaction(params: {
  userId: string;
  orgId: string;
  projectId: string;
  kind: number;
  parentId?: string;
  name: string;
  ipAddress?: string;
}): Promise<FolderMutationResult> {
  const { userId, orgId, projectId, kind, parentId, name } = params;

  return withOrgWrite(userId, orgId, 'project.write', async (tx) => {
    if (!(await assertProjectInOrg(tx, orgId, projectId))) {
      return { ok: false, reason: 'not_found' as const };
    }

    const activeFolders = await loadActiveFolders(tx, orgId, projectId, kind);

    if (parentId) {
      const parent = activeFolders.find((folder) => folder.id === parentId);
      if (!parent) {
        return { ok: false, reason: 'invalid_parent' as const };
      }
      const byId = new Map(activeFolders.map((folder) => [folder.id, folder]));
      if (folderDepth(byId, parent) >= 3) {
        return { ok: false, reason: 'depth_exceeded' as const };
      }
    }

    const [folder] = await tx
      .insert(folders)
      .values({
        orgId,
        projectId,
        kind,
        parentId: parentId ?? null,
        name,
        sort: await nextFolderSort(
          tx,
          orgId,
          projectId,
          kind,
          parentId ?? null
        ),
        createdBy: userId,
      })
      .returning();

    return { ok: true as const, folder };
  });
}

export async function renameFolderInTransaction(params: {
  userId: string;
  orgId: string;
  folderId: string;
  name: string;
  ipAddress?: string;
}): Promise<FolderMutationResult> {
  const { userId, orgId, folderId, name } = params;

  return withOrgWrite(userId, orgId, 'project.write', async (tx) => {
    const [folder] = await tx
      .update(folders)
      .set({ name })
      .where(and(eq(folders.id, folderId), eq(folders.orgId, orgId)))
      .returning();

    if (!folder) {
      return { ok: false, reason: 'not_found' as const };
    }

    return { ok: true as const, folder };
  });
}

export type DeleteFolderResult =
  | { ok: true; deletedFolders: number; unfiledContent: number }
  | { ok: false; reason: 'forbidden' | 'not_found' };

export async function deleteFolderInTransaction(params: {
  userId: string;
  orgId: string;
  folderId: string;
  ipAddress?: string;
}): Promise<DeleteFolderResult> {
  const { userId, orgId, folderId } = params;

  return withOrgWrite(userId, orgId, 'project.write', async (tx) => {
    const rows = await tx
      .select()
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.orgId, orgId)))
      .limit(1);
    const target = rows[0];
    if (!target) {
      return { ok: false, reason: 'not_found' as const };
    }

    const siblings = await loadActiveFolders(
      tx,
      orgId,
      target.projectId,
      target.kind
    );
    const byParent = new Map<string | null, Folder[]>();
    for (const folder of siblings) {
      const key = folder.parentId ?? null;
      const bucket = byParent.get(key) ?? [];
      bucket.push(folder);
      byParent.set(key, bucket);
    }

    const subtree: Folder[] = [];
    const queue: Folder[] = [target];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      subtree.push(current);
      queue.push(...(byParent.get(current.id) ?? []));
    }
    const folderIds = subtree.map((folder) => folder.id);

    let unfiledContent = 0;
    if (target.kind === 0) {
      const updated = await tx
        .update(lineages)
        .set({ folderId: null })
        .where(
          and(
            eq(lineages.orgId, orgId),
            eq(lineages.projectId, target.projectId),
            inArray(lineages.folderId, folderIds)
          )
        )
        .returning({ id: lineages.id });
      unfiledContent = updated.length;
    } else if (target.kind === 1) {
      const updated = await tx
        .update(articles)
        .set({ folderId: null })
        .where(
          and(
            eq(articles.orgId, orgId),
            eq(articles.projectId, target.projectId),
            inArray(articles.folderId, folderIds)
          )
        )
        .returning({ id: articles.id });
      unfiledContent = updated.length;
    } else {
      const updated = await tx
        .update(books)
        .set({ folderId: null })
        .where(
          and(
            eq(books.orgId, orgId),
            eq(books.projectId, target.projectId),
            inArray(books.folderId, folderIds)
          )
        )
        .returning({ id: books.id });
      unfiledContent = updated.length;
    }

    // 目标态无软删：真删。`fk_folder_parent_same_project` 是 RESTRICT，同一条
    // `DELETE ... WHERE id IN (父, 子)` 会因父先删而失败，所以按 BFS 的反序
    // （深 → 浅）逐个删，保证每个子都先于它的父。
    for (const folder of [...subtree].reverse()) {
      await tx.delete(folders).where(eq(folders.id, folder.id));
    }

    return {
      ok: true as const,
      deletedFolders: subtree.length,
      unfiledContent,
    };
  });
}
