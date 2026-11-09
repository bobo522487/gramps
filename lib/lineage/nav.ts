import 'server-only';

import { cache } from 'react';
import { getFolders } from '@/lib/db/queries/folders';
import { getLineages } from '@/lib/db/queries/lineages';

export const getNavFolders = cache(
  async (userId: string, orgId: string, projectId: string) =>
    getFolders(userId, orgId, projectId)
);

export const getNavLineages = cache(
  async (userId: string, orgId: string, projectId: string) =>
    getLineages(userId, orgId, projectId)
);
