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
  createInvitation,
  deleteOrg,
  findPendingInvitationByEmail,
  getOrgById,
  isUserInOrgByEmail,
  logActivity,
  renameOrg,
} from '@/lib/db/queries';
import { ActivityType } from '@/lib/db/schema';
import {
  createOrganizationForOwner,
  removeOrgMemberInTransaction,
} from '@/lib/db/services';

export const createOrgAction = validatedActionWithUser(
  createOrgSchema,
  async (data, _, user) => {
    const { name } = data;
    const created = await createOrganizationForOwner({
      userId: user.id,
      name,
    });

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

const REMOVE_MEMBER_ERRORS = {
  org_not_found: '组织不存在',
  forbidden: '只有所有者可以移除组织成员',
  member_not_found: '该成员不在此组织中',
  self_removal: '不能移除自己，请先转让所有权',
  last_owner: '不能移除最后一个所有者',
} as const;

export const removeOrgMember = validatedActionWithUser(
  removeOrgMemberSchema,
  async (data, _, user) => {
    const { orgId, memberId } = data;

    const result = await removeOrgMemberInTransaction({
      orgId,
      memberId,
      actorId: user.id,
    });

    if (!result.ok) {
      return { error: REMOVE_MEMBER_ERRORS[result.reason] };
    }

    revalidatePath('/dashboard', 'layout');
    return { success: '已移除组织成员' };
  }
);
