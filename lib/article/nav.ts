import 'server-only';

import { cache } from 'react';
import { countArticlesByFolder, listArticles } from '@/lib/db/queries/articles';
import { getFolders } from '@/lib/db/queries/folders';

/**
 * 请求级共享的谱文导航数据。
 *
 * 谱文与谱系是并列的两类导航，故不复用 `lib/lineage/nav.ts`（那是谱系模块），
 * 而是按同一模式在本模块提供 `cache()` 包装，避免每次渲染重复查库。
 */

export const getNavArticleFolders = cache(
  async (userId: string, orgId: string, projectId: string) =>
    getFolders(userId, orgId, projectId, 1)
);

export const getNavArticleList = cache(
  async (userId: string, orgId: string, projectId: string) =>
    listArticles(userId, orgId, projectId)
);

export const getNavArticleCounts = cache(
  async (userId: string, orgId: string, projectId: string) =>
    countArticlesByFolder(userId, orgId, projectId)
);
