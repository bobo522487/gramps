import 'server-only';

import { eq } from 'drizzle-orm';
import {
  createEmptyArticleContent,
  parseArticleContent,
} from '@/lib/article/doc';
import {
  type ArticleResult,
  articleFolderIdOrNull,
  ensureDefaultFolder,
  FORBIDDEN,
  hasCatalogReferenceInTx,
  imagePathsOf,
  lockArticle,
  projectExists,
  refused,
} from '@/lib/article/mutations';
import { articles } from '@/lib/db/schema';
import { withOrgWrite } from '@/lib/db/write';

export async function createArticleInTransaction(params: {
  userId: string;
  orgId: string;
  projectId: string;
  title: string;
  folderId?: string | null;
}): Promise<ArticleResult<{ articleId: string }>> {
  const { userId, orgId, projectId, title } = params;

  const result = await withOrgWrite(
    userId,
    orgId,
    'article.write',
    async (tx) => {
      if (!(await projectExists(tx, orgId, projectId))) {
        return { ok: false, reason: 'not_found' } as const;
      }

      let folderId = params.folderId ?? null;
      if (folderId) {
        const resolved = await articleFolderIdOrNull(
          tx,
          orgId,
          projectId,
          folderId
        );
        if (!resolved) {
          return { ok: false, reason: 'not_found' } as const;
        }
        folderId = resolved;
      } else {
        folderId = await ensureDefaultFolder(tx, orgId, projectId, userId);
      }

      const content = createEmptyArticleContent();
      const inserted = await tx
        .insert(articles)
        .values({
          orgId,
          projectId,
          folderId,
          title,
          kind: null,
          content,
          plainText: '',
          createdBy: userId,
        })
        .returning({ id: articles.id });

      const articleId = inserted[0]?.id;
      if (!articleId) {
        throw new Error('创建谱文失败');
      }

      return { ok: true as const, articleId };
    }
  );

  return refused(result) ? FORBIDDEN : result;
}

export async function updateArticleTitleInTransaction(params: {
  userId: string;
  orgId: string;
  articleId: string;
  title: string;
}): Promise<ArticleResult<{ updatedAt: Date }>> {
  const { userId, orgId, articleId, title } = params;

  const result = await withOrgWrite(
    userId,
    orgId,
    'article.write',
    async (tx) => {
      const article = await lockArticle(tx, orgId, articleId);
      if (!article) {
        return { ok: false, reason: 'not_found' } as const;
      }

      // Target state has no `updated_at`; the timestamp is only echoed back to
      // the caller so the editor can show "saved at", it is not persisted.
      const updatedAt = new Date();
      await tx
        .update(articles)
        .set({ title })
        .where(eq(articles.id, articleId));
      return { ok: true as const, updatedAt };
    }
  );

  return refused(result) ? FORBIDDEN : result;
}

export async function moveArticleInTransaction(params: {
  userId: string;
  orgId: string;
  articleId: string;
  folderId: string | null;
}): Promise<ArticleResult<{ updatedAt: Date }>> {
  const { userId, orgId, articleId, folderId } = params;

  const result = await withOrgWrite(
    userId,
    orgId,
    'article.write',
    async (tx) => {
      const article = await lockArticle(tx, orgId, articleId);
      if (!article) {
        return { ok: false, reason: 'not_found' } as const;
      }

      let targetFolderId: string | null = folderId;
      if (folderId) {
        const resolved = await articleFolderIdOrNull(
          tx,
          orgId,
          article.projectId,
          folderId
        );
        if (!resolved) {
          return { ok: false, reason: 'not_found' } as const;
        }
        targetFolderId = resolved;
      }

      const updatedAt = new Date();
      await tx
        .update(articles)
        .set({ folderId: targetFolderId })
        .where(eq(articles.id, articleId));
      return { ok: true as const, updatedAt };
    }
  );

  return refused(result) ? FORBIDDEN : result;
}

/**
 * 硬删谱文（目标态无软删）。返回的 `pathnames` 是提交后应当删除的图片——
 * 事务里删字节会在回滚时留下无法恢复的空引用，所以删除动作交给 Action 在
 * 提交后执行。被活动编目引用时 `book_catalog_article_fk`（RESTRICT）也会
 * 挡住删除，与这里的预检一致。
 */
export async function deleteArticleInTransaction(params: {
  userId: string;
  orgId: string;
  articleId: string;
}): Promise<ArticleResult<{ pathnames: string[] }>> {
  const { userId, orgId, articleId } = params;

  const result = await withOrgWrite(
    userId,
    orgId,
    'article.write',
    async (tx) => {
      const article = await lockArticle(tx, orgId, articleId);
      if (!article) {
        return { ok: false, reason: 'not_found' } as const;
      }
      if (await hasCatalogReferenceInTx(tx, orgId, articleId)) {
        return { ok: false, reason: 'catalog_referenced' } as const;
      }

      await tx.delete(articles).where(eq(articles.id, articleId));

      return {
        ok: true as const,
        pathnames: imagePathsOf(parseArticleContent(article.content)),
      };
    }
  );

  return refused(result) ? FORBIDDEN : result;
}

/**
 * 保存一页（FR-012..FR-017）。行锁 + 只替换该页 = 同一篇谱文的并发只在该页内
 * 后写覆盖先写，其他页不受影响（ADR 0002）。
 */
