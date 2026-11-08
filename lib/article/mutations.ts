export type ArticleMutationFailure = ArticleErrorCode | 'forbidden';

export type ArticleResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: ArticleMutationFailure };

export const FORBIDDEN = { ok: false, reason: 'forbidden' } as const;

/**
 * 谱文写入层的共用件（宪法 III：每个入口一个事务；权限在事务内复核）。
 *
 * 与 `services.ts` / `page-services.ts` 分文件是 F6 单文件 ≤400 行的要求，
 * 不是「以后可能用到」的提前拆层——两个消费者都已经在用。
 */

import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';
import type { ArticleErrorCode } from '@/lib/article/constants';
import { DEFAULT_ARTICLE_FOLDER_NAME } from '@/lib/article/constants';
import { type ArticleContent, eachImageAttrs } from '@/lib/article/doc';
import { articleContentSchema } from '@/lib/article/schemas';
import type { DbTransaction } from '@/lib/db/drizzle';
import {
  type Article,
  articles,
  bookCatalogs,
  books,
  folders,
  projects,
} from '@/lib/db/schema';
import { nextFolderSort } from '@/lib/folder/services';

/**
 * `withOrgWrite` 的拒绝和业务自己的失败都是 `{ ok: false }` 形状，只有 `reason`
 * 能区分——一律当「没权限」会把「不存在」报成「没权限」。
 */
export function refused(
  result: unknown
): result is { ok: false; reason: 'forbidden' } {
  if (typeof result !== 'object' || result === null) {
    return false;
  }
  const failure = result as { ok?: unknown; reason?: unknown };
  return failure.ok === false && failure.reason === 'forbidden';
}

/** 云谱空间必须属于本组织；公开 ID 与 UUID 都算不得授权凭证。 */
export async function projectExists(
  tx: DbTransaction,
  orgId: string,
  projectId: string
): Promise<boolean> {
  const rows = await tx
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
  return rows.length > 0;
}

/** 分类必须是本组织、本云谱空间、未删除的**谱文**分类（kind = 1）。 */
export async function articleFolderIdOrNull(
  tx: DbTransaction,
  orgId: string,
  projectId: string,
  folderId: string
): Promise<string | null> {
  const rows = await tx
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.orgId, orgId),
        eq(folders.projectId, projectId),
        eq(folders.kind, 1),
        isNull(folders.deletedAt)
      )
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * 「默认分类」在同一事务里确保存在（FR-001）。分类管理入口属于
 * `project.write`，编辑者看不到新建分类按钮，所以不能要求他先建分类才能写谱文。
 */

/**
 * 「默认分类」在同一事务里确保存在（FR-001）。分类管理入口属于
 * `project.write`，编辑者看不到新建分类按钮，所以不能要求他先建分类才能写谱文。
 */
export async function ensureDefaultFolder(
  tx: DbTransaction,
  orgId: string,
  projectId: string,
  userId: string
): Promise<string> {
  const existing = await tx
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.orgId, orgId),
        eq(folders.projectId, projectId),
        eq(folders.kind, 1),
        eq(folders.name, DEFAULT_ARTICLE_FOLDER_NAME),
        isNull(folders.parentId),
        isNull(folders.deletedAt)
      )
    )
    .orderBy(asc(folders.createdAt))
    .limit(1);
  const found = existing[0];
  if (found) {
    return found.id;
  }

  const created = await tx
    .insert(folders)
    .values({
      orgId,
      projectId,
      kind: 1,
      parentId: null,
      name: DEFAULT_ARTICLE_FOLDER_NAME,
      sort: await nextFolderSort(tx, orgId, projectId, 1, null),
      createdBy: userId,
    })
    .returning({ id: folders.id });
  const folderId = created[0]?.id;
  if (!folderId) {
    throw new Error('创建默认分类失败');
  }
  return folderId;
}

/** 锁定谱文行；返回 `null` 表示不存在、已删除或不属于本组织。 */
export async function lockArticle(
  tx: DbTransaction,
  orgId: string,
  articleId: string
): Promise<Article | null> {
  const rows = await tx
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.id, articleId),
        eq(articles.orgId, orgId),
        isNull(articles.deletedAt)
      )
    )
    .limit(1)
    .for('update');
  return rows[0] ?? null;
}

/** 活动编目 + 活动谱书都算引用（FR-006、软删语义）。 */
export async function hasCatalogReferenceInTx(
  tx: DbTransaction,
  orgId: string,
  articleId: string
): Promise<boolean> {
  const rows = await tx
    .select({ id: bookCatalogs.id })
    .from(bookCatalogs)
    .innerJoin(
      books,
      and(eq(books.id, bookCatalogs.bookId), isNull(books.deletedAt))
    )
    .where(
      and(
        eq(bookCatalogs.orgId, orgId),
        eq(bookCatalogs.articleId, articleId),
        isNull(bookCatalogs.deletedAt)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** 整篇（含未提交的其他页）再过一次白名单：单页图片数与 pathname 前缀。 */
export function validateContent(
  content: ArticleContent,
  scope: { orgId: string; articleId: string }
): ArticleErrorCode | null {
  const parsed = articleContentSchema(scope).safeParse(content);
  if (parsed.success) {
    return null;
  }
  const message = parsed.error.issues[0]?.message ?? '';
  if (message.includes('张图片')) {
    return 'too_many_images';
  }
  if (message.includes('页')) {
    return 'max_pages';
  }
  return 'invalid_doc';
}

export function pageIdsOf(content: ArticleContent): string[] {
  return content.pages.map((page) => page.id);
}

export function imagePathsOf(value: unknown): string[] {
  const paths: string[] = [];
  eachImageAttrs(value, (attrs) => {
    const pathname = attrs.pathname;
    if (typeof pathname === 'string') {
      paths.push(pathname);
    }
  });
  return paths;
}
