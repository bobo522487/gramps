import 'server-only';

import { and, eq, ne, sql } from 'drizzle-orm';
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
import { DEFAULT_FOLDER_NAME } from './constants';

type FolderFailure = 'forbidden' | 'not_found' | 'conflict';

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

/**
 * 同项目下一个 `seq` 值。扁平单层只有一层，不再有「同层」概念；
 * 谱文 / 谱系两侧创建「默认分类」都复用这一个算法。
 */
export async function nextFolderSeq(
  tx: DbTransaction,
  orgId: string,
  projectId: string
) {
  const [row] = await tx
    .select({ value: sql<number>`coalesce(max(${folders.seq}), -1)::int` })
    .from(folders)
    .where(and(eq(folders.orgId, orgId), eq(folders.projectId, projectId)));
  return (row?.value ?? -1) + 1;
}

/**
 * 「默认分类」在同一事务里确保存在。谱系与谱文共用这一份竞态处理：
 * 先查，未命中则插入，`folder_name_unique` 冲突说明并发方刚插过，重查即可。
 */
export async function ensureDefaultFolderInTx(
  tx: DbTransaction,
  orgId: string,
  projectId: string,
  name = DEFAULT_FOLDER_NAME
): Promise<string> {
  const [existing] = await tx
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.orgId, orgId),
        eq(folders.projectId, projectId),
        eq(folders.name, name)
      )
    )
    .limit(1);
  if (existing) {
    return existing.id;
  }

  const created = await tx
    .insert(folders)
    .values({
      orgId,
      projectId,
      name,
      seq: await nextFolderSeq(tx, orgId, projectId),
    })
    .onConflictDoNothing({ target: [folders.projectId, folders.name] })
    .returning({ id: folders.id });

  if (created[0]) {
    return created[0].id;
  }

  const [raced] = await tx
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.orgId, orgId),
        eq(folders.projectId, projectId),
        eq(folders.name, name)
      )
    )
    .limit(1);
  if (!raced) {
    throw new Error('failed to resolve the default folder');
  }
  return raced.id;
}

export async function createFolderInTransaction(params: {
  userId: string;
  orgId: string;
  projectId: string;
  name: string;
  ipAddress?: string;
}): Promise<FolderMutationResult> {
  const { userId, orgId, projectId, name } = params;

  return withOrgWrite(userId, orgId, 'project.write', async (tx) => {
    if (!(await assertProjectInOrg(tx, orgId, projectId))) {
      return { ok: false, reason: 'not_found' as const };
    }

    // 扁平单层：名字在项目内唯一，撞名由 `folder_name_unique` 拒绝。
    // 用 `onConflictDoNothing` 一次往返处理并发，空返回即撞名。
    const inserted = await tx
      .insert(folders)
      .values({
        orgId,
        projectId,
        name,
        seq: await nextFolderSeq(tx, orgId, projectId),
      })
      .onConflictDoNothing({ target: [folders.projectId, folders.name] })
      .returning();

    const folder = inserted[0];
    if (!folder) {
      return { ok: false, reason: 'conflict' as const };
    }

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
    const [target] = await tx
      .select({ id: folders.id, projectId: folders.projectId })
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.orgId, orgId)))
      .limit(1);
    if (!target) {
      return { ok: false, reason: 'not_found' as const };
    }

    const [duplicate] = await tx
      .select({ id: folders.id })
      .from(folders)
      .where(
        and(
          eq(folders.orgId, orgId),
          eq(folders.projectId, target.projectId),
          eq(folders.name, name),
          ne(folders.id, folderId)
        )
      )
      .limit(1);
    if (duplicate) {
      return { ok: false, reason: 'conflict' as const };
    }

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
    const [target] = await tx
      .select({ id: folders.id, projectId: folders.projectId })
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.orgId, orgId)))
      .limit(1);
    if (!target) {
      return { ok: false, reason: 'not_found' as const };
    }

    // 扁平单层：三类内容共用一套分类，删一条分类要把三张表的 `folder_id`
    // 都置空。外键本身是 `ON DELETE SET NULL (folder_id)`，但显式 UPDATE
    // 才能数出「转入未分类」的条数并给用户交代。
    const unfiledLineages = await tx
      .update(lineages)
      .set({ folderId: null })
      .where(
        and(
          eq(lineages.orgId, orgId),
          eq(lineages.projectId, target.projectId),
          eq(lineages.folderId, folderId)
        )
      )
      .returning({ id: lineages.id });
    const unfiledArticles = await tx
      .update(articles)
      .set({ folderId: null })
      .where(
        and(
          eq(articles.orgId, orgId),
          eq(articles.projectId, target.projectId),
          eq(articles.folderId, folderId)
        )
      )
      .returning({ id: articles.id });
    const unfiledBooks = await tx
      .update(books)
      .set({ folderId: null })
      .where(
        and(
          eq(books.orgId, orgId),
          eq(books.projectId, target.projectId),
          eq(books.folderId, folderId)
        )
      )
      .returning({ id: books.id });

    const unfiledContent =
      unfiledLineages.length + unfiledArticles.length + unfiledBooks.length;

    // 目标态无软删：真删。单层没有子节点，不需要 BFS。
    await tx.delete(folders).where(eq(folders.id, folderId));

    return { ok: true as const, deletedFolders: 1, unfiledContent };
  });
}
