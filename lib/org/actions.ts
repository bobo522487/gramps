'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import {
  acceptInviteSchema,
  createOrgSchema,
  deleteOrgSchema,
  inviteOrgMemberSchema,
  removeOrgMemberSchema,
  renameOrgSchema,
  updateOrgMemberRoleSchema,
} from '@/lib/auth/schemas';
import {
  acceptInvite,
  archiveOrganization,
  createOrganizationForOwner,
  inviteOrgMember as inviteOrgMemberService,
  removeOrgMemberInTransaction,
  renameOrganization,
  updateOrgMemberRoleInTransaction,
} from '@/lib/db/services';

export const createOrgAction = validatedActionWithUser(
  createOrgSchema,
  async (data, _, user) => {
    const created = await createOrganizationForOwner({
      userId: user.id,
      name: data.name,
    });
    if (!created) {
      return { error: '组织创建失败，请稍后重试。' };
    }

    revalidatePath('/dashboard', 'layout');
    return {
      success: '组织已创建',
      orgId: created.id,
      orgSlug: created.slug,
    };
  }
);

export const renameOrgAction = validatedActionWithUser(
  renameOrgSchema,
  async (data, _, user) => {
    const result = await renameOrganization({
      userId: user.id,
      orgId: data.orgId,
      name: data.name,
    });

    if (!result.ok) {
      return {
        error:
          result.reason === 'forbidden'
            ? '只有所有者可以修改组织设置'
            : '组织不存在',
      };
    }

    revalidatePath('/dashboard', 'layout');
    return { success: '组织已重命名' };
  }
);

export const deleteOrgAction = validatedActionWithUser(
  deleteOrgSchema,
  async (data, _, user) => {
    const result = await archiveOrganization({
      userId: user.id,
      orgId: data.orgId,
    });

    if (!result.ok) {
      return {
        error:
          result.reason === 'forbidden'
            ? '只有所有者可以归档组织'
            : '组织不存在',
      };
    }

    revalidatePath('/dashboard', 'layout');
    return { success: '组织已归档' };
  }
);

const INVITE_ERRORS = {
  forbidden: '只有所有者或管理员可以邀请成员',
  org_not_found: '组织不存在或已归档',
  already_member: '该用户已是组织成员',
  pending_exists: '已向该邮箱发出邀请，请等待对方接受',
} as const;

export const inviteOrgMember = validatedActionWithUser(
  inviteOrgMemberSchema,
  async (data, _, user) => {
    const result = await inviteOrgMemberService({
      userId: user.id,
      orgId: data.orgId,
      email: data.email,
      role: data.role,
    });

    if (!result.ok) {
      return { error: INVITE_ERRORS[result.reason] };
    }

    revalidatePath('/dashboard', 'layout');
    return {
      success: '邀请已创建，请把链接发送给对方。',
      inviteUrl: result.inviteUrl,
    };
  }
);

export const acceptInviteAction = validatedActionWithUser(
  acceptInviteSchema,
  async (data, _, user) => {
    const result = await acceptInvite({
      userId: user.id,
      token: data.token,
    });

    if (!result.ok) {
      return {
        error:
          result.reason === 'forbidden'
            ? '你没有接受该邀请的权限'
            : '邀请无效或已过期。',
      };
    }

    revalidatePath('/dashboard', 'layout');
    return { success: '已加入组织' };
  }
);

const REMOVE_MEMBER_ERRORS = {
  forbidden: '只有所有者或管理员可以移除成员',
  member_not_found: '该成员不在此组织中',
  self_removal: '不能移除自己，请先转让所有权',
  last_owner: '不能移除最后一个所有者',
} as const;

export const removeOrgMember = validatedActionWithUser(
  removeOrgMemberSchema,
  async (data, _, user) => {
    const result = await removeOrgMemberInTransaction({
      orgId: data.orgId,
      memberId: data.memberId,
      actorId: user.id,
    });

    if (!result.ok) {
      return { error: REMOVE_MEMBER_ERRORS[result.reason] };
    }

    revalidatePath('/dashboard', 'layout');
    return { success: '已移除组织成员' };
  }
);

const UPDATE_ROLE_ERRORS = {
  forbidden: '你没有调整该成员角色的权限',
  member_not_found: '该成员不在此组织中',
  owner_immutable: '不能修改所有者的角色',
  same_role: '该成员已经是此角色',
} as const;

export const updateOrgMemberRole = validatedActionWithUser(
  updateOrgMemberRoleSchema,
  async (data, _, user) => {
    const result = await updateOrgMemberRoleInTransaction({
      orgId: data.orgId,
      memberId: data.memberId,
      role: data.role,
      actorId: user.id,
    });

    if (!result.ok) {
      return { error: UPDATE_ROLE_ERRORS[result.reason] };
    }

    revalidatePath('/dashboard', 'layout');
    return { success: '成员角色已更新' };
  }
);
