import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { withOrg } from '../drizzle';
import { type Folder, folders } from '../schema';

export async function getFolders(
  userId: string,
  orgId: string,
  projectId: string,
  kind: number
): Promise<Folder[]> {
  return withOrg(userId, (tx) =>
    tx
      .select()
      .from(folders)
      .where(
        and(
          eq(folders.orgId, orgId),
          eq(folders.projectId, projectId),
          eq(folders.kind, kind),
          isNull(folders.deletedAt)
        )
      )
      .orderBy(asc(folders.sort), asc(folders.createdAt))
  );
}
