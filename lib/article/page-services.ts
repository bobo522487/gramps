import 'server-only';

import { eq } from 'drizzle-orm';

import {
  ARTICLE_SCHEMA_VERSION,
  MAX_PAGES_PER_ARTICLE,
} from '@/lib/article/constants';
import type { ArticleContent, ArticlePage } from '@/lib/article/doc';
import {
  createEmptyPageDoc,
  derivePlainText,
  isReferenced,
  newArticlePageId,
  parseArticleContent,
} from '@/lib/article/doc';
import {
  type ArticleResult,
  FORBIDDEN,
  imagePathsOf,
  lockArticle,
  pageIdsOf,
  refused,
  validateContent,
} from '@/lib/article/mutations';
import { logActivityInTx } from '@/lib/db/queries/activity';
import { ActivityType, articles } from '@/lib/db/schema';
import { withOrgWrite } from '@/lib/db/write';

/**
 * 保存一页（FR-012..FR-017）。行锁 + 只替换该页 = 同一篇谱文的并发只在该页内
 * 后写覆盖先写，其他页不受影响（ADR 0002）。
 */
export async function saveArticlePageInTransaction(params: {
  userId: string;
  orgId: string;
  articleId: string;
  pageId: string;
  /** Zod 之外的来源一律当 `unknown`：白名单在 Action 的 schema，类型收敛在这里。 */
  doc: unknown;
}): Promise<ArticleResult<{ savedAt: string; page: ArticlePage }>> {
  const { userId, orgId, articleId, pageId, doc } = params;

  const result = await withOrgWrite(
    userId,
    orgId,
    'article.write',
    async (tx) => {
      const article = await lockArticle(tx, orgId, articleId);
      if (!article) {
        return { ok: false, reason: 'not_found' } as const;
      }

      const current = parseArticleContent(article.content);
      const index = current.pages.findIndex((page) => page.id === pageId);
      if (index < 0) {
        // 页已被删除：拒绝整次提交，不凭空造页、不动其他页（FR-021）。
        return { ok: false, reason: 'page_not_found' } as const;
      }

      const normalized = parseArticleContent({
        schemaVersion: ARTICLE_SCHEMA_VERSION,
        pages: [{ id: pageId, doc }],
      });
      const candidate = normalized.pages[0];
      // parseArticleContent 认不下这页时会兜底成新的一页（id 也会变），
      // 那说明客户端提交的形状已经不对了，拒绝而不是悄悄清空。
      if (normalized.pages.length !== 1 || candidate?.id !== pageId) {
        return { ok: false, reason: 'invalid_doc' } as const;
      }
      const page: ArticlePage = candidate;
      const pages = [...current.pages];
      pages[index] = page;
      const content: ArticleContent = {
        schemaVersion: ARTICLE_SCHEMA_VERSION,
        pages,
      };

      const invalid = validateContent(content, { orgId, articleId });
      if (invalid) {
        return { ok: false, reason: invalid } as const;
      }

      const savedAt = new Date();
      await tx
        .update(articles)
        .set({
          content,
          plainText: derivePlainText(content),
          updatedAt: savedAt,
        })
        .where(eq(articles.id, articleId));
      await logActivityInTx(tx, userId, orgId, ActivityType.UPDATE_ARTICLE);

      return {
        ok: true as const,
        savedAt: savedAt.toISOString(),
        page,
      };
    }
  );

  return refused(result) ? FORBIDDEN : result;
}

export async function addArticlePageInTransaction(params: {
  userId: string;
  orgId: string;
  articleId: string;
}): Promise<ArticleResult<{ pageId: string; pageOrder: string[] }>> {
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

      const current = parseArticleContent(article.content);
      if (current.pages.length >= MAX_PAGES_PER_ARTICLE) {
        return { ok: false, reason: 'max_pages' } as const;
      }

      const page: ArticlePage = {
        id: newArticlePageId(),
        doc: createEmptyPageDoc(),
      };
      const content: ArticleContent = {
        schemaVersion: ARTICLE_SCHEMA_VERSION,
        pages: [...current.pages, page],
      };

      const savedAt = new Date();
      await tx
        .update(articles)
        .set({
          content,
          plainText: derivePlainText(content),
          updatedAt: savedAt,
        })
        .where(eq(articles.id, articleId));
      await logActivityInTx(tx, userId, orgId, ActivityType.UPDATE_ARTICLE);

      return {
        ok: true as const,
        pageId: page.id,
        pageOrder: pageIdsOf(content),
      };
    }
  );

  return refused(result) ? FORBIDDEN : result;
}

/** 删页。返回该页独有（其他页不再引用）的图片，交给 Action 在提交后清字节。 */

/** 删页。返回该页独有（其他页不再引用）的图片，交给 Action 在提交后清字节。 */
export async function deleteArticlePageInTransaction(params: {
  userId: string;
  orgId: string;
  articleId: string;
  pageId: string;
}): Promise<ArticleResult<{ pageOrder: string[]; pathnames: string[] }>> {
  const { userId, orgId, articleId, pageId } = params;

  const result = await withOrgWrite(
    userId,
    orgId,
    'article.write',
    async (tx) => {
      const article = await lockArticle(tx, orgId, articleId);
      if (!article) {
        return { ok: false, reason: 'not_found' } as const;
      }

      const current = parseArticleContent(article.content);
      const removed = current.pages.find((page) => page.id === pageId);
      if (!removed) {
        return { ok: false, reason: 'page_not_found' } as const;
      }
      if (current.pages.length === 1) {
        return { ok: false, reason: 'last_page' } as const;
      }

      const pages = current.pages.filter((page) => page.id !== pageId);
      const content: ArticleContent = {
        schemaVersion: ARTICLE_SCHEMA_VERSION,
        pages,
      };

      const savedAt = new Date();
      await tx
        .update(articles)
        .set({
          content,
          plainText: derivePlainText(content),
          updatedAt: savedAt,
        })
        .where(eq(articles.id, articleId));
      await logActivityInTx(tx, userId, orgId, ActivityType.UPDATE_ARTICLE);

      const pathnames = imagePathsOf(removed.doc).filter(
        (pathname) => !isReferenced(pathname, content)
      );
      return { ok: true as const, pageOrder: pageIdsOf(content), pathnames };
    }
  );

  return refused(result) ? FORBIDDEN : result;
}

export async function reorderArticlePagesInTransaction(params: {
  userId: string;
  orgId: string;
  articleId: string;
  pageIds: string[];
}): Promise<ArticleResult<{ pageOrder: string[] }>> {
  const { userId, orgId, articleId, pageIds } = params;

  const result = await withOrgWrite(
    userId,
    orgId,
    'article.write',
    async (tx) => {
      const article = await lockArticle(tx, orgId, articleId);
      if (!article) {
        return { ok: false, reason: 'not_found' } as const;
      }

      const current = parseArticleContent(article.content);
      const byId = new Map(current.pages.map((page) => [page.id, page]));
      const isSameSet =
        pageIds.length === byId.size &&
        pageIds.every((id) => byId.has(id)) &&
        new Set(pageIds).size === pageIds.length;
      if (!isSameSet) {
        // 另一端加/删过页：拒绝这次重排，让客户端按服务端页序重来（FR-021）。
        return { ok: false, reason: 'page_not_found' } as const;
      }

      const pages = pageIds.map((id) => byId.get(id)!);
      const content: ArticleContent = {
        schemaVersion: ARTICLE_SCHEMA_VERSION,
        pages,
      };

      const savedAt = new Date();
      await tx
        .update(articles)
        .set({
          updatedAt: savedAt,
          plainText: derivePlainText(content),
          content,
        })
        .where(eq(articles.id, articleId));
      await logActivityInTx(tx, userId, orgId, ActivityType.UPDATE_ARTICLE);

      return { ok: true as const, pageOrder: pageIdsOf(content) };
    }
  );

  return refused(result) ? FORBIDDEN : result;
}
