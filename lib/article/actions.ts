'use server';

import 'server-only';

import { ARTICLE_ERRORS } from '@/lib/article/constants';
import type { ArticlePageDoc } from '@/lib/article/doc';
import { getMediaStore } from '@/lib/article/media/store';
import type { ArticleResult } from '@/lib/article/mutations';
import {
  addArticlePageInTransaction,
  deleteArticlePageInTransaction,
  reorderArticlePagesInTransaction,
  saveArticlePageInTransaction,
} from '@/lib/article/page-services';
import {
  addArticlePageSchema,
  createArticleSchema,
  deleteArticlePageSchema,
  deleteArticleSchema,
  moveArticleSchema,
  previewArticleSchema,
  previewFolderSchema,
  reorderArticlePagesSchema,
  saveArticlePageSchema,
  updateArticleTitleSchema,
} from '@/lib/article/schemas';
import {
  createArticleInTransaction,
  deleteArticleInTransaction,
  moveArticleInTransaction,
  updateArticleTitleInTransaction,
} from '@/lib/article/services';
import { validatedActionWithUserObject } from '@/lib/auth/middleware';
import type { ActionState } from '@/lib/auth/types';
import type {
  ArticleDeletePreview,
  FolderDeletePreview,
} from '@/lib/db/queries/articles';
import {
  getArticleDeletePreview,
  getFolderDeletePreview,
  hasCatalogReference,
} from '@/lib/db/queries/articles';
import { revalidateWholeConsole } from '@/lib/lineage/revalidate';
import { logger } from '@/lib/logger';

/**
 * 谱文写入 Action（contracts §1.1–§1.8）。
 *
 * 失效口径（research §6）：新建/改标题/移分类/删除 → 整棵控制台失效；
 * 保存页/加页/删页/重排 → **不失效**，否则服务端快照会在用户敲字的间隙被推回编辑器。
 * 页级操作的回显只到「本次提交成功的那一页」（FR-017）。
 */

function failure(
  result: Extract<ArticleResult<never>, { ok: false }>
): ActionState {
  return { error: ARTICLE_ERRORS[result.reason] };
}

/** 事务提交之后再删字节：回滚时不能把还在引用的图片删掉（ADR 0019）。 */
async function releaseImages(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) {
    return;
  }
  const store = getMediaStore();
  for (const pathname of pathnames) {
    try {
      await store.delete(pathname);
    } catch (error) {
      logger.warn('图片字节清理失败（不影响数据）', {
        pathname,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const createArticleAction = validatedActionWithUserObject(
  createArticleSchema,
  async (data, user) => {
    const result = await createArticleInTransaction({
      userId: user.id,
      orgId: data.orgId,
      projectId: data.projectId,
      title: data.title,
      folderId: data.folderId ?? null,
    });
    if (!result.ok) {
      return failure(result);
    }

    revalidateWholeConsole();
    return { success: '谱文已创建', data: { articleId: result.articleId } };
  }
);

export const updateArticleTitleAction = validatedActionWithUserObject(
  updateArticleTitleSchema,
  async (data, user) => {
    const result = await updateArticleTitleInTransaction({
      userId: user.id,
      orgId: data.orgId,
      articleId: data.articleId,
      title: data.title,
    });
    if (!result.ok) {
      return failure(result);
    }

    revalidateWholeConsole();
    return { success: '标题已保存' };
  }
);

export const moveArticleAction = validatedActionWithUserObject(
  moveArticleSchema,
  async (data, user) => {
    const result = await moveArticleInTransaction({
      userId: user.id,
      orgId: data.orgId,
      articleId: data.articleId,
      folderId: data.folderId,
    });
    if (!result.ok) {
      return failure(result);
    }

    revalidateWholeConsole();
    return { success: '已移动到新分类' };
  }
);

export const deleteArticleAction = validatedActionWithUserObject(
  deleteArticleSchema,
  async (data, user) => {
    const result = await deleteArticleInTransaction({
      userId: user.id,
      orgId: data.orgId,
      articleId: data.articleId,
    });
    if (!result.ok) {
      return failure(result);
    }

    await releaseImages(result.pathnames);
    revalidateWholeConsole();
    return { success: '谱文已删除' };
  }
);

export type SavedPagePayload = {
  savedAt: string;
  page: { id: string; doc: ArticlePageDoc };
};

export const saveArticlePageAction = validatedActionWithUserObject(
  saveArticlePageSchema,
  async (data, user): Promise<ActionState<SavedPagePayload>> => {
    const result = await saveArticlePageInTransaction({
      userId: user.id,
      orgId: data.orgId,
      articleId: data.articleId,
      pageId: data.pageId,
      doc: data.doc,
    });
    if (!result.ok) {
      return failure(result);
    }

    return {
      success: '已保存',
      data: { savedAt: result.savedAt, page: result.page },
    };
  }
);

export type PageOrderPayload = { pageOrder: string[] };

export const addArticlePageAction = validatedActionWithUserObject(
  addArticlePageSchema,
  async (
    data,
    user
  ): Promise<ActionState<{ pageId: string } & PageOrderPayload>> => {
    const result = await addArticlePageInTransaction({
      userId: user.id,
      orgId: data.orgId,
      articleId: data.articleId,
    });
    if (!result.ok) {
      return failure(result);
    }

    return {
      success: '已添加一页',
      data: { pageId: result.pageId, pageOrder: result.pageOrder },
    };
  }
);

export const deleteArticlePageAction = validatedActionWithUserObject(
  deleteArticlePageSchema,
  async (data, user): Promise<ActionState<PageOrderPayload>> => {
    const result = await deleteArticlePageInTransaction({
      userId: user.id,
      orgId: data.orgId,
      articleId: data.articleId,
      pageId: data.pageId,
    });
    if (!result.ok) {
      return failure(result);
    }

    await releaseImages(result.pathnames);
    return { success: '已删除该页', data: { pageOrder: result.pageOrder } };
  }
);

export const reorderArticlePagesAction = validatedActionWithUserObject(
  reorderArticlePagesSchema,
  async (data, user): Promise<ActionState<PageOrderPayload>> => {
    const result = await reorderArticlePagesInTransaction({
      userId: user.id,
      orgId: data.orgId,
      articleId: data.articleId,
      pageIds: data.pageIds,
    });
    if (!result.ok) {
      return failure(result);
    }

    return { success: '页序已保存', data: { pageOrder: result.pageOrder } };
  }
);

/**
 * 删除确认框的预览读取（contracts §1.10、FR-004/005/006、SC-005）。
 *
 * 只读：不写库、不失效缓存。数字只有服务端算得准——页数与图片数来自
 * `article.content` 的分页文档包，引用状态要跨 `book_catalog`/`book` 的软删判断。
 * 看不见（含跨组织）一律按不存在处理，不泄露存在性（FR-034）。
 */

export type ArticleDeletePreviewPayload = ArticleDeletePreview & {
  referencedByCatalog: boolean;
};

export const getArticleDeletePreviewAction = validatedActionWithUserObject(
  previewArticleSchema,
  async (data, user): Promise<ArticleDeletePreviewPayload | ActionState> => {
    const preview = await getArticleDeletePreview(
      user.id,
      data.orgId,
      data.articleId
    );
    if (!preview) {
      return { error: ARTICLE_ERRORS.not_found };
    }

    return {
      ...preview,
      referencedByCatalog: await hasCatalogReference(
        user.id,
        data.orgId,
        data.articleId
      ),
    };
  }
);

export const getFolderDeletePreviewAction = validatedActionWithUserObject(
  previewFolderSchema,
  async (data, user): Promise<FolderDeletePreview | ActionState> => {
    const preview = await getFolderDeletePreview(
      user.id,
      data.orgId,
      data.folderId
    );
    return preview ?? { error: ARTICLE_ERRORS.not_found };
  }
);
