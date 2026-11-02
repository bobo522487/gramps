import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { withOrg } from '../drizzle';
import { articles } from '../schema';

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
 * without leaking existence (AGENTS §5.4).
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
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.orgId, orgId),
          isNull(articles.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  });
}
