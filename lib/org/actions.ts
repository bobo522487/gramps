'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import { checkOrgRole } from '@/lib/auth/permissions';
import {
  createOrgSchema,
  deleteOrgSchema,
  inviteOrgMemberSchema,
  removeOrgMemberSchema,
  renameOrgSchema,
} from '@/lib/auth/schemas';
import {
  addOrgMember,
  createInvitation,
  createOrg,
  deleteOrg,
  findPendingInvitationByEmail,
  getOrgById,
  isUserInOrgByEmail,
  logActivity,
  removeMemberFromOrg,
  renameOrg,
} from '@/lib/db/queries';
import { ActivityType } from '@/lib/db/schema';

export const createOrgAction = validatedActionWithUser(
  createOrgSchema,
  async (data, _, user) => {
    const { name } = data;
    const created = await createOrg(name);
    if (!created) {
      return { error: '创建组织失败' };
    }

    await addOrgMember({ userId: user.id, orgId: created.id, role: 'owner' });
    await logActivity(created.id, user.id, ActivityType.CREATE_ORG);

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
    const { orgId, name } = data;

    const denied = await checkOrgRole(user.id, orgId, 'owner');
    if (denied) {
      return { error: denied };
    }

    const updated = await renameOrg(orgId, name);
    if (!updated) {
      return { error: '组织不存在' };
    }

    await logActivity(orgId, user.id, ActivityType.RENAME_ORG);
    revalidatePath(`/dashboard/org/${updated.slug}`, 'layout');
    return { success: '组织已重命名' };
  }
);

export const deleteOrgAction = validatedActionWithUser(
  deleteOrgSchema,
  async (data, _, user) => {
    const { orgId } = data;

    // Owner membership must be verified before destroying the org row
    const denied = await checkOrgRole(user.id, orgId, 'owner');
    if (denied) {
      return { error: denied };
    }

    await deleteOrg(orgId);
    revalidatePath('/dashboard', 'layout');
    return { success: '组织已删除' };
  }
);

export const inviteOrgMember = validatedActionWithUser(
  inviteOrgMemberSchema,
  async (data, _, user) => {
    const { orgId, email, role } = data;

    // Permission is enforced server-side, not just via disabled UI buttons
    if ((await checkOrgRole(user.id, orgId, 'owner')) !== null) {
      return { error: '只有所有者可以邀请组织成员' };
    }

    const org = await getOrgById(orgId);
    if (!org) {
      return { error: '组织不存在' };
    }

    const alreadyMember = await isUserInOrgByEmail(email, orgId);
    if (alreadyMember) {
      return { error: '该用户已是组织成员' };
    }

    const existingInvitation = await findPendingInvitationByEmail(email, orgId);
    if (existingInvitation) {
      return { error: '已向该邮箱发送过邀请' };
    }

    await createInvitation({ orgId, email, role, invitedBy: user.id });
    await logActivity(orgId, user.id, ActivityType.INVITE_ORG_MEMBER);

    // TODO: Send invitation email and include ?inviteId={id} to sign-up URL

    return { success: '邀请已发送' };
  }
);

export const removeOrgMember = validatedActionWithUser(
  removeOrgMemberSchema,
  async (data, _, user) => {
    const { orgId, memberId } = data;

    if ((await checkOrgRole(user.id, orgId, 'owner')) !== null) {
      return { error: '只有所有者可以移除组织成员' };
    }

    const removedOrgId = await removeMemberFromOrg({ memberId, orgId });
    if (!removedOrgId) {
      return { error: '该成员不在此组织中' };
    }

    await logActivity(orgId, user.id, ActivityType.REMOVE_ORG_MEMBER);
    revalidatePath('/dashboard', 'layout');
    return { success: '已移除组织成员' };
  }
);
