import 'server-only';

import { and, asc, eq } from 'drizzle-orm';
import { withOrg } from '../drizzle';
import { type Folder, folders } from '../schema';

/**
 * 项目内的扁平分类列表。附录 A.2 的 `folder` 是单层：谱系 / 谱文 / 谱书
 * 共用同一套分类，所以这里不按 `kind` 过滤，只按项目圈定、按 `seq` 排序。
 */
export async function getFolders(
  userId: string,
  orgId: string,
  projectId: string
): Promise<Folder[]> {
  return withOrg(userId, (tx) =>
    tx
      .select()
      .from(folders)
      .where(and(eq(folders.orgId, orgId), eq(folders.projectId, projectId)))
      .orderBy(asc(folders.seq), asc(folders.createdAt))
  );
}
