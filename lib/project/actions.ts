'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import { checkOrgRole } from '@/lib/auth/permissions';
import {
  createProjectSchema,
  deleteProjectSchema,
  updateProjectSchema,
} from '@/lib/auth/schemas';
import {
  createProject,
  deleteProject,
  logActivity,
  updateProject,
} from '@/lib/db/queries';
import { ActivityType } from '@/lib/db/schema';

export const createProjectAction = validatedActionWithUser(
  createProjectSchema,
  async (data, _, user) => {
    const { orgId, name, region } = data;

    if ((await checkOrgRole(user.id, orgId, 'member')) !== null) {
      return { error: '你没有在该组织中创建项目的权限' };
    }

    const project = await createProject({ orgId, name, region });
    if (!project) {
      return { error: '创建项目失败' };
    }

    await logActivity(orgId, user.id, ActivityType.CREATE_PROJECT);
    revalidatePath('/dashboard', 'layout');
    return {
      success: '项目已创建',
      projectId: project.id,
      projectRef: project.ref,
    };
  }
);

export const updateProjectAction = validatedActionWithUser(
  updateProjectSchema,
  async (data, _, user) => {
    const { orgId, projectId, name, status } = data;

    if ((await checkOrgRole(user.id, orgId, 'owner')) !== null) {
      return { error: '只有所有者可以修改项目' };
    }

    const updated = await updateProject(projectId, orgId, { name, status });
    if (!updated) {
      return { error: '项目不存在于该组织' };
    }

    revalidatePath(`/dashboard/project/${updated.ref}`, 'layout');
    revalidatePath('/dashboard', 'layout');
    return { success: '项目已更新' };
  }
);

export const deleteProjectAction = validatedActionWithUser(
  deleteProjectSchema,
  async (data, _, user) => {
    const { orgId, projectId } = data;

    if ((await checkOrgRole(user.id, orgId, 'owner')) !== null) {
      return { error: '只有所有者可以删除项目' };
    }

    const deleted = await deleteProject(projectId, orgId);
    if (!deleted) {
      return { error: '项目不存在于该组织' };
    }

    await logActivity(orgId, user.id, ActivityType.DELETE_PROJECT);
    revalidatePath('/dashboard', 'layout');
    return { success: '项目已删除' };
  }
);
