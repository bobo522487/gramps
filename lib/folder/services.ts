import 'server-only';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getOrgRoleInTx, hasPermission } from '@/lib/auth/permissions';
import { type DbTransaction, withOrg } from '@/lib/db/drizzle';
import { logActivityInTx } from '@/lib/db/queries/activity';
import {
  ActivityType,
  articles,
  books,
  type Folder,
  folders,
  lineages,
  projects,
} from '@/lib/db/schema';

type FolderFailure =
  | 'forbidden'
  | 'not_found'
  | 'invalid_parent'
  | 'depth_exceeded';

export type FolderMutationResult =
  | { ok: true; folder: Folder }
  | { ok: false; reason: FolderFailure };

async function requireProjectWrite(
  tx: DbTransaction,
  userId: string,
  orgId: string
): Promise<boolean> {
  const role = await getOrgRoleInTx(tx, userId, orgId);
  return Boolean(role && hasPermission(role, 'project.write'));
}

async function assertProjectInOrg(
  tx: DbTransaction,
  orgId: string,
  projectId: string
) {
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
        eq(folders.kind, kind),
        isNull(folders.deletedAt)
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

async function nextFolderSort(
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
        parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId),
        isNull(folders.deletedAt)
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
  const { userId, orgId, projectId, kind, parentId, name, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    if (!(await requireProjectWrite(tx, userId, orgId))) {
      return { ok: false, reason: 'forbidden' as const };
    }
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

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.CREATE_FOLDER,
      ipAddress
    );
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
  const { userId, orgId, folderId, name, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    if (!(await requireProjectWrite(tx, userId, orgId))) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const [folder] = await tx
      .update(folders)
      .set({ name })
      .where(
        and(
          eq(folders.id, folderId),
          eq(folders.orgId, orgId),
          isNull(folders.deletedAt)
        )
      )
      .returning();

    if (!folder) {
      return { ok: false, reason: 'not_found' as const };
    }

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.RENAME_FOLDER,
      ipAddress
    );
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
  const { userId, orgId, folderId, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    if (!(await requireProjectWrite(tx, userId, orgId))) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const rows = await tx
      .select()
      .from(folders)
      .where(
        and(
          eq(folders.id, folderId),
          eq(folders.orgId, orgId),
          isNull(folders.deletedAt)
        )
      )
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
            inArray(lineages.folderId, folderIds),
            isNull(lineages.deletedAt)
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
            inArray(articles.folderId, folderIds),
            isNull(articles.deletedAt)
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
            inArray(books.folderId, folderIds),
            isNull(books.deletedAt)
          )
        )
        .returning({ id: books.id });
      unfiledContent = updated.length;
    }

    await tx
      .update(folders)
      .set({ deletedAt: new Date() })
      .where(inArray(folders.id, folderIds));

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.DELETE_FOLDER,
      ipAddress
    );

    return {
      ok: true as const,
      deletedFolders: subtree.length,
      unfiledContent,
    };
  });
}
