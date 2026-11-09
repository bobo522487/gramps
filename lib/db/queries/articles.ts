import 'server-only';

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { withOrg } from '../drizzle';
import {
  type Article,
  articles,
  bookCatalogs,
  books,
  folders,
} from '../schema';

/**
 * 谱文读取层。页数与图片数都从 `article.body`
 * 的分页文档包现算——不占列、不会有第二份真相。
 * 所有查询都走 `withOrg` 并同时带 `orgId`，外组织一律空结果而不是报错。
 *
 * 目标态（附录 A.5）里 `article` / `book` / `folder` 都没有 `deleted_at`，删除即
 * 真删，所以本文件不再按软删过滤。唯一例外是 `book_catalog`：它的软删列随
 * B3 / T25 一起退役，`hasCatalogReference` 仍按它过滤——这一处是登记在案的中间态。
 */

export type ArticleSummary = {
  id: string;
  title: string;
  folderId: string | null;
  pageCount: number;
  createdAt: Date;
};

export type ArticleFolderCounts = {
  /** 只含至少有一篇谱文的分类；没有谱文的分类不出现在里面。 */
  byFolder: Map<string, number>;
  /** 总数减去各分类之和：未分类的谱文算在这里。 */
  unfiled: number;
  total: number;
};

export type ArticleDeletePreview = {
  title: string;
  pageCount: number;
  imageCount: number;
};

export type FolderDeletePreview = {
  name: string;
  /** 含自身与全部子孙的谱文分类数。 */
  folderCount: number;
  /** 这批分类下当前还活着的谱文数。 */
  articleCount: number;
};

/** 旧的单文档形状没有 `pages`，兜底显示 1 页，与 `parseArticleContent` 一致。 */
const pageCountSql = sql<number>`case
  when jsonb_typeof(((${articles.body})::jsonb -> 'pages')) = 'array'
  then jsonb_array_length((${articles.body})::jsonb -> 'pages')
  else 1
end`;

const imageCountSql = sql<number>`coalesce(jsonb_array_length(
  jsonb_path_query_array(
    (${articles.body})::jsonb,
    '$.pages[*].doc.content[*] ? (@.type == "articleImage")'
  )
), 0)`;

export async function listArticles(
  userId: string,
  orgId: string,
  projectId: string
): Promise<ArticleSummary[]> {
  return withOrg(userId, (tx) =>
    tx
      .select({
        id: articles.id,
        title: articles.title,
        folderId: articles.folderId,
        createdAt: articles.createdAt,
        pageCount: pageCountSql,
      })
      .from(articles)
      .where(and(eq(articles.orgId, orgId), eq(articles.projectId, projectId)))
      // 目标态没有 `updated_at`，「最近动过」的排序键只剩 `created_at`。
      .orderBy(desc(articles.createdAt), asc(articles.id))
  );
}

export async function getArticle(
  userId: string,
  orgId: string,
  articleId: string
): Promise<Article | null> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.orgId, orgId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function countArticlesByFolder(
  userId: string,
  orgId: string,
  projectId: string
): Promise<ArticleFolderCounts> {
  // 分组与总数必须在同一事务快照里相减，否则并发写入会让 unfiled 偏一甚至为负。
  return withOrg(userId, async (tx) => {
    const rows = await tx
      // innerJoin 之后 folderId 不可能为 null：取 folders.id，免得留个走不到的分支。
      .select({ folderId: folders.id, value: sql<number>`count(*)` })
      .from(articles)
      .innerJoin(folders, eq(folders.id, articles.folderId))
      .where(and(eq(articles.orgId, orgId), eq(articles.projectId, projectId)))
      .groupBy(folders.id);

    const totalRows = await tx
      .select({ value: sql<number>`count(*)` })
      .from(articles)
      .where(and(eq(articles.orgId, orgId), eq(articles.projectId, projectId)));
    // count(*) arrives as a string over the wire (bigint), same as everywhere else.
    const total = Number(totalRows[0]?.value ?? 0);

    const byFolder = new Map<string, number>();
    let filed = 0;
    for (const row of rows) {
      byFolder.set(row.folderId, Number(row.value));
      filed += Number(row.value);
    }

    return { byFolder, unfiled: total - filed, total };
  });
}

export async function getArticleDeletePreview(
  userId: string,
  orgId: string,
  articleId: string
): Promise<ArticleDeletePreview | null> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({
        title: articles.title,
        pageCount: pageCountSql,
        imageCount: imageCountSql,
      })
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.orgId, orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      title: row.title,
      pageCount: Number(row.pageCount),
      imageCount: Number(row.imageCount),
    };
  });
}

/** 被任何活动谱书的活动编目引用过就不能删（FR-006）。 */
export async function hasCatalogReference(
  userId: string,
  orgId: string,
  articleId: string
): Promise<boolean> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({ id: bookCatalogs.id })
      .from(bookCatalogs)
      .innerJoin(books, eq(books.id, bookCatalogs.bookId))
      .where(
        and(
          eq(bookCatalogs.orgId, orgId),
          eq(bookCatalogs.articleId, articleId)
        )
      )
      .limit(1);
    return rows.length > 0;
  });
}

/**
 * 删分类前的确认口径：这一条分类下会转入「未分类」的谱文数。
 * 扁平单层没有子树，`folderCount` 恒为 1（删的就是这一条）。
 */
export async function getFolderDeletePreview(
  userId: string,
  orgId: string,
  folderId: string
): Promise<FolderDeletePreview | null> {
  return withOrg(userId, async (tx) => {
    const [root] = await tx
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.orgId, orgId)))
      .limit(1);
    if (!root) {
      return null;
    }

    const counted = await tx
      .select({ value: sql<number>`count(*)` })
      .from(articles)
      .where(and(eq(articles.orgId, orgId), eq(articles.folderId, folderId)));

    return {
      name: root.name,
      folderCount: 1,
      articleCount: Number(counted[0]?.value ?? 0),
    };
  });
}

export type ArticleScope = {
  id: string;
  orgId: string;
  projectId: string;
  folderId: string | null;
  title: string;
};

/**
 * Resolves an article inside the caller's organization. A foreign `articleId`
 * comes back `null` rather than an error, so callers can answer "not found"
 * without leaking existence.
 */
export async function getArticleScope(
  userId: string,
  orgId: string,
  articleId: string
): Promise<ArticleScope | null> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({
        id: articles.id,
        orgId: articles.orgId,
        projectId: articles.projectId,
        folderId: articles.folderId,
        title: articles.title,
      })
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.orgId, orgId)))
      .limit(1);
    return rows[0] ?? null;
  });
}
