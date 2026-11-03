'use server';

import 'server-only';

import { validatedActionWithUser } from '@/lib/auth/middleware';
import { revalidateWholeConsole } from '@/lib/console/revalidate';
import {
  addChildSchema,
  addPersonSchema,
  addSiblingSchema,
  addSpouseSchema,
  createLineageSchema,
  createRootNodeSchema,
  deleteLineageSchema,
  deleteNodeSchema,
  moveNodeSchema,
  updateLineageSchema,
  updateNodeSchema,
} from '@/lib/genealogy/schemas';
import { deleteLineageError, lineageError } from '@/lib/lineage/lineage-errors';
import {
  addChildInTransaction,
  addSiblingInTransaction,
  addSpouseInTransaction,
  createRootNodeInTransaction,
  deleteNodeInTransaction,
  moveNodeInTransaction,
  type NodeUpdates,
  type OptionalSpouse,
  toNodeDetails,
  updateNodeInTransaction,
} from '@/lib/lineage/node-services';
import {
  createLineageInTransaction,
  deleteLineageInTransaction,
  type LineageUpdates,
  updateLineageInTransaction,
} from '@/lib/lineage/services';

function coSpouse(data: {
  spouseName?: string;
  spouseSurname?: string;
}): OptionalSpouse | undefined {
  if (!data.spouseName || !data.spouseSurname) {
    return undefined;
  }
  return { name: data.spouseName, surname: data.spouseSurname };
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
      region: data.region,
      hallCode: data.hallCode,
      notes: data.notes,
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateWholeConsole();
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
    if (data.hallCode !== undefined) {
      updates.hallCode = data.hallCode;
    }
    if (data.region !== undefined) {
      updates.region = data.region;
    }
    if (data.notes !== undefined) {
      updates.notes = data.notes;
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

    revalidateWholeConsole();
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
      return deleteLineageError(result.reason);
    }

    revalidateWholeConsole();
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
      details: toNodeDetails(data),
      spouse: coSpouse(data),
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateWholeConsole();
    return {
      success: '始祖已录入',
      nodeId: result.node.id,
      ...(result.spouse ? { spouseId: result.spouse.id } : {}),
    };
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
      details: toNodeDetails(data),
      spouse: coSpouse(data),
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateWholeConsole();
    return {
      success: '子女已添加',
      nodeId: result.node.id,
      ...(result.spouse ? { spouseId: result.spouse.id } : {}),
    };
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
      details: toNodeDetails(data),
      spouse: coSpouse(data),
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateWholeConsole();
    return {
      success: '兄弟已添加',
      nodeId: result.node.id,
      ...(result.spouse ? { spouseId: result.spouse.id } : {}),
    };
  }
);

export const addPersonAction = validatedActionWithUser(
  addPersonSchema,
  async (data, _, user) => {
    const params = {
      userId: user.id,
      orgId: data.orgId,
      lineageId: data.lineageId,
      name: data.name,
      surname: data.surname,
      sex: data.sex,
      details: toNodeDetails(data),
      spouse: coSpouse(data),
    };
    const result = data.parentId
      ? await addChildInTransaction({ ...params, parentId: data.parentId })
      : await createRootNodeInTransaction(params);

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateWholeConsole();
    return {
      success: data.parentId ? '族人已添加' : '始祖已录入',
      nodeId: result.node.id,
      ...(result.spouse ? { spouseId: result.spouse.id } : {}),
    };
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
      details: toNodeDetails(data),
    });

    if (!result.ok) {
      return lineageError(result.reason);
    }

    revalidateWholeConsole();
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

    revalidateWholeConsole();
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

    revalidateWholeConsole();
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

    revalidateWholeConsole();
    return { success: '人丁已移动', nodeId: result.node.id };
  }
);
