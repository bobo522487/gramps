'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import {
  addChildSchema,
  addSiblingSchema,
  addSpouseSchema,
  createLineageSchema,
  createRootNodeSchema,
  deleteLineageSchema,
  deleteNodeSchema,
  moveNodeSchema,
  reorderSiblingsSchema,
  updateLineageSchema,
  updateNodeSchema,
} from '@/lib/genealogy/schemas';
import {
  addChildInTransaction,
  addSiblingInTransaction,
  addSpouseInTransaction,
  createRootNodeInTransaction,
  deleteNodeInTransaction,
  moveNodeInTransaction,
  type NodeUpdates,
  reorderSiblingsInTransaction,
  updateNodeInTransaction,
} from '@/lib/lineage/node-services';
import {
  createLineageInTransaction,
  deleteLineageInTransaction,
  type LineageUpdates,
  updateLineageInTransaction,
} from '@/lib/lineage/services';

const LINEAGE_ERRORS = {
  forbidden: '你没有编辑谱系的权限',
  not_found: '谱系不存在或已删除',
  invalid_folder: '分类不存在或类型不匹配',
  conflict: '谱系名称已存在',
  referenced: '该谱系已被谱书编目引用，请先移除编目',
  root_exists: '该谱系已经有始祖了',
  root_sibling: '始祖没有父辈，不能添加兄弟',
  invalid_target: '目标人丁无效',
  invalid_parent: '父节点无效',
  cycle: '不能把节点移动到自己的子孙下面',
  invalid_order: '排序数据无效',
} as const;

function revalidateProject() {
  revalidatePath('/dashboard', 'layout');
}

function lineageError(reason: keyof typeof LINEAGE_ERRORS) {
  return { error: LINEAGE_ERRORS[reason] };
}

export const createLineageAction = validatedActionWithUser(
  createLineageSchema,
  async (data, _, user) => {
    const result = await createLineageInTransaction({
      userId: user.id,
      orgId: data.orgId,
      projectId: data.projectId,
      folderId: data.folderId,
      name: data.name,
      surname: data.surname,
      hallCode: data.hallCode,
      generationWords: data.generationWords,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return {
      success: '谱系已创建',
      lineageId: result.lineage.id,
    };
  }
);

export const updateLineageAction = validatedActionWithUser(
  updateLineageSchema,
  async (data, _, user) => {
    const updates: LineageUpdates = {};
    if (data.folderId !== undefined) {
      updates.folderId = data.folderId;
    }
    if (data.name !== undefined) {
      updates.name = data.name;
    }
    if (data.surname !== undefined) {
      updates.surname = data.surname;
    }
    if (data.hallCode !== undefined) {
      updates.hallCode = data.hallCode;
    }
    if (data.generationWords !== undefined) {
      updates.generationWords = data.generationWords;
    }

    const result = await updateLineageInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      updates,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return { success: '谱系已更新', lineageId: result.lineage.id };
  }
);

export const deleteLineageAction = validatedActionWithUser(
  deleteLineageSchema,
  async (data, _, user) => {
    const result = await deleteLineageInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return {
      success:
        result.deletedNodes > 0
          ? `谱系已删除，${result.deletedNodes} 位人丁已归档`
          : '谱系已删除',
    };
  }
);

export const createRootNodeAction = validatedActionWithUser(
  createRootNodeSchema,
  async (data, _, user) => {
    const result = await createRootNodeInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      name: data.name,
      surname: data.surname,
      sex: data.sex,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return { success: '始祖已录入', nodeId: result.node.id };
  }
);

export const addChildAction = validatedActionWithUser(
  addChildSchema,
  async (data, _, user) => {
    const result = await addChildInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      parentId: data.parentId,
      name: data.name,
      surname: data.surname,
      sex: data.sex,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return { success: '子女已添加', nodeId: result.node.id };
  }
);

export const addSiblingAction = validatedActionWithUser(
  addSiblingSchema,
  async (data, _, user) => {
    const result = await addSiblingInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      siblingOfId: data.siblingOfId,
      name: data.name,
      surname: data.surname,
      sex: data.sex,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return { success: '兄弟已添加', nodeId: result.node.id };
  }
);

export const addSpouseAction = validatedActionWithUser(
  addSpouseSchema,
  async (data, _, user) => {
    const result = await addSpouseInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      spouseOfId: data.spouseOfId,
      name: data.name,
      surname: data.surname,
      sex: data.sex,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return { success: '配偶已添加', nodeId: result.node.id };
  }
);

export const updateNodeAction = validatedActionWithUser(
  updateNodeSchema,
  async (data, _, user) => {
    const updates: NodeUpdates = {
      name: data.name,
      surname: data.surname,
      sex: data.sex,
      courtesy: data.courtesy,
      namePrefix: data.namePrefix,
      isAlive: data.isAlive,
      birthText: data.birthText,
      deathText: data.deathText,
      birthYear: data.birthYear,
      deathYear: data.deathYear,
      burialPlace: data.burialPlace,
      biography: data.biography,
    };

    const result = await updateNodeInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      nodeId: data.nodeId,
      updates,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return { success: '人丁信息已保存', nodeId: result.node.id };
  }
);

export const deleteNodeAction = validatedActionWithUser(
  deleteNodeSchema,
  async (data, _, user) => {
    const result = await deleteNodeInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      nodeId: data.nodeId,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return {
      success:
        result.deletedNodes > 1
          ? `已删除该人丁及其子孙，共 ${result.deletedNodes} 位`
          : '人丁已删除',
    };
  }
);

export const moveNodeAction = validatedActionWithUser(
  moveNodeSchema,
  async (data, _, user) => {
    const result = await moveNodeInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      nodeId: data.nodeId,
      newParentId: data.newParentId,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return { success: '人丁已移动', nodeId: result.node.id };
  }
);

export const reorderSiblingsAction = validatedActionWithUser(
  reorderSiblingsSchema,
  async (data, _, user) => {
    const result = await reorderSiblingsInTransaction({
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      parentId: data.parentId ?? null,
      orderedIds: data.orderedIds,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateProject();
    return { success: '排序已保存' };
  }
);
