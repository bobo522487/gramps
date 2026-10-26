'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import {
  createProjectSchema,
  deleteProjectSchema,
  updateProjectSchema,
} from '@/lib/auth/schemas';
import {
  createProjectInTransaction,
  deleteProjectInTransaction,
  type ProjectUpdates,
  updateProjectInTransaction,
} from '@/lib/db/services';
import { revalidateWholeConsole } from '@/lib/lineage/revalidate';

const PROJECT_ERRORS = {
  forbidden: '你没有管理云谱空间的权限',
  not_found: '云谱空间不存在或已归档',
  conflict: '项目创建失败，请重试。',
} as const;

export const createProjectAction = validatedActionWithUser(
  createProjectSchema,
  async (data, _, user) => {
    const result = await createProjectInTransaction({
      userId: user.id,
      orgId: data.orgId,
      input: {
        name: data.name,
        surname: data.surname,
        themeName: data.themeName,
        countriesRegions: data.countriesRegions,
        status: data.status,
        importance: data.importance,
        notes: data.notes,
      },
    });

    if (!result.ok) {
      return { error: PROJECT_ERRORS[result.reason] };
    }

    revalidateWholeConsole();
    return {
      success: '云谱空间已创建',
      projectId: result.project.id,
      projectRef: result.project.ref,
    };
  }
);

export const updateProjectAction = validatedActionWithUser(
  updateProjectSchema,
  async (data, _, user) => {
    const updates: ProjectUpdates = {};
    if (data.name !== undefined) {
      updates.name = data.name;
    }
    if (data.hallCode !== undefined) {
      updates.hallCode = data.hallCode;
    }
    if (data.countriesRegions !== undefined) {
      updates.countriesRegions = data.countriesRegions;
    }
    if (data.status !== undefined) {
      updates.status = data.status;
    }
    if (data.importance !== undefined) {
      updates.importance = data.importance;
    }
    if (data.notes !== undefined) {
      updates.notes = data.notes;
    }

    const result = await updateProjectInTransaction({
      userId: user.id,
      orgId: data.orgId,
      projectId: data.projectId,
      updates,
    });

    if (!result.ok) {
      return { error: PROJECT_ERRORS[result.reason] };
    }

    // Already narrower than the rest: the project subtree is refreshed by path.
    // A full scoping needs orgSlug in updateProjectSchema (tracked in Task 10's
    // ruling); the whole-console call stays until then.
    revalidateWholeConsole();
    revalidatePath(`/dashboard/project/${result.project.ref}`, 'layout');
    return { success: '云谱空间已更新' };
  }
);

export const deleteProjectAction = validatedActionWithUser(
  deleteProjectSchema,
  async (data, _, user) => {
    const result = await deleteProjectInTransaction({
      userId: user.id,
      orgId: data.orgId,
      projectId: data.projectId,
    });

    if (!result.ok) {
      return { error: PROJECT_ERRORS[result.reason] };
    }

    revalidateWholeConsole();
    return { success: '云谱空间已删除' };
  }
);
