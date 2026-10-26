'use server';

import 'server-only';

import { validatedActionWithUser } from '@/lib/auth/middleware';
import {
  createFolderInTransaction,
  deleteFolderInTransaction,
  renameFolderInTransaction,
} from '@/lib/folder/services';
import {
  createFolderSchema,
  deleteFolderSchema,
  renameFolderSchema,
} from '@/lib/genealogy/schemas';
import { revalidateWholeConsole } from '@/lib/lineage/revalidate';

const FOLDER_ERRORS = {
  forbidden: '你没有管理云谱空间的权限',
  not_found: '分类不存在或已删除',
  invalid_parent: '上级分类不存在',
  depth_exceeded: '分类最多支持 3 层',
} as const;

export const createFolderAction = validatedActionWithUser(
  createFolderSchema,
  async (data, _, user) => {
    const result = await createFolderInTransaction({
      userId: user.id,
      orgId: data.orgId,
      projectId: data.projectId,
      kind: data.kind,
      parentId: data.parentId,
      name: data.name,
    });

    if (!result.ok) {
      return { error: FOLDER_ERRORS[result.reason] };
    }

    revalidateWholeConsole();
    return { success: '分类已创建', folderId: result.folder.id };
  }
);

export const renameFolderAction = validatedActionWithUser(
  renameFolderSchema,
  async (data, _, user) => {
    const result = await renameFolderInTransaction({
      userId: user.id,
      orgId: data.orgId,
      folderId: data.folderId,
      name: data.name,
    });

    if (!result.ok) {
      return { error: FOLDER_ERRORS[result.reason] };
    }

    revalidateWholeConsole();
    return { success: '分类已重命名', folderId: result.folder.id };
  }
);

export const deleteFolderAction = validatedActionWithUser(
  deleteFolderSchema,
  async (data, _, user) => {
    const result = await deleteFolderInTransaction({
      userId: user.id,
      orgId: data.orgId,
      folderId: data.folderId,
    });

    if (!result.ok) {
      return { error: FOLDER_ERRORS[result.reason] };
    }

    revalidateWholeConsole();
    return {
      success:
        result.unfiledContent > 0
          ? `分类已删除，${result.unfiledContent} 项内容已移入未分类`
          : '分类已删除',
    };
  }
);
