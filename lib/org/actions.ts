'use server';

import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth/better-auth';
import {
  authErrorMessage,
  isSlugConflict,
  mapAuthError,
} from '@/lib/auth/errors';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import {
  checkOrgPermission,
  getOrgRole,
  hasPermission,
} from '@/lib/auth/permissions';
import { getClientIp } from '@/lib/auth/rate-limit';
import {
  acceptInviteSchema,
  createOrgSchema,
  deleteOrgSchema,
  inviteOrgMemberSchema,
  removeOrgMemberSchema,
  renameOrgSchema,
  updateOrgMemberRoleSchema,
} from '@/lib/auth/schemas';
import { getServerConfig } from '@/lib/config';
import { withOrg } from '@/lib/db/drizzle';
import { isRaisedException } from '@/lib/db/errors';
import { logActivity } from '@/lib/db/queries/activity';
import { getOrgById } from '@/lib/db/queries/organizations';
import { ActivityType, orgMembers } from '@/lib/db/schema';
import { generatePublicId } from '@/lib/ids';
import { logger } from '@/lib/logger';

const SLUG_ATTEMPTS = 3;

async function authHeaders() {
  return headers();
}

async function logOrgActivity(
  userId: string,
  orgId: string | null,
  type: ActivityType
) {
  try {
    const ip = await getClientIp();
    await logActivity(userId, orgId, type, ip === 'unknown' ? undefined : ip);
  } catch (error) {
    logger.warn('failed to write activity log', { type, userId, error });
  }
}

async function findMember(actorId: string, orgId: string, memberId: string) {
  return withOrg(actorId, async (tx) => {
    const rows = await tx
      .select({
        id: orgMembers.id,
        userId: orgMembers.userId,
        role: orgMembers.role,
      })
      .from(orgMembers)
      .where(
        and(eq(orgMembers.id, memberId), eq(orgMembers.organizationId, orgId))
      )
      .limit(1);
    return rows[0] ?? null;
  });
}

export const createOrgAction = validatedActionWithUser(
  createOrgSchema,
  async (data, _, user) => {
    let created: Awaited<
      ReturnType<ReturnType<typeof getAuth>['api']['createOrganization']>
    > | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      try {
        created = await getAuth().api.createOrganization({
          body: { name: data.name, slug: generatePublicId() },
          headers: await authHeaders(),
        });
        break;
      } catch (error) {
        lastError = error;
        if (!isSlugConflict(error)) {
          return { error: authErrorMessage(error) };
        }
      }
    }

    if (!created) {
      logger.warn('organization slug allocation failed', { error: lastError });
      return { error: '组织创建失败，请稍后重试。' };
    }

    await logOrgActivity(user.id, created.id, ActivityType.CREATE_ORG);
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
    const org = await getOrgById(user.id, data.orgId);
    if (!org) {
      return { error: '组织不存在或已归档' };
    }

    const denied = await checkOrgPermission(
      user.id,
      data.orgId,
      'org.settings'
    );
    if (denied) {
      return { error: denied };
    }

    try {
      await getAuth().api.updateOrganization({
        body: { organizationId: data.orgId, data: { name: data.name } },
        headers: await authHeaders(),
      });
    } catch (error) {
      return mapAuthError(error);
    }

    await logOrgActivity(user.id, data.orgId, ActivityType.RENAME_ORG);
    revalidatePath('/dashboard', 'layout');
    return { success: '组织已重命名' };
  }
);

export const deleteOrgAction = validatedActionWithUser(
  deleteOrgSchema,
  async (data, _, user) => {
    const org = await getOrgById(user.id, data.orgId);
    if (!org) {
      return { error: '组织不存在或已归档' };
    }

    const denied = await checkOrgPermission(
      user.id,
      data.orgId,
      'org.settings'
    );
    if (denied) {
      return { error: denied };
    }

    try {
      await withOrg(user.id, (tx) =>
        tx.execute(sql`select auth.archive_organization(${data.orgId}::uuid)`)
      );
    } catch (error) {
      if (isRaisedException(error, 'forbidden')) {
        return { error: '只有所有者可以归档组织' };
      }
      return mapAuthError(error);
    }

    await logOrgActivity(user.id, data.orgId, ActivityType.ARCHIVE_ORG);
    revalidatePath('/dashboard', 'layout');
    return { success: '组织已归档' };
  }
);

export const inviteOrgMember = validatedActionWithUser(
  inviteOrgMemberSchema,
  async (data, _, user) => {
    const org = await getOrgById(user.id, data.orgId);
    if (!org) {
      return { error: '组织不存在或已归档' };
    }

    const denied = await checkOrgPermission(
      user.id,
      data.orgId,
      'member.invite'
    );
    if (denied) {
      return { error: denied };
    }

    const actorRole = await getOrgRole(user.id, data.orgId);
    if (actorRole === 'admin' && data.role === 'admin') {
      return { error: '管理员不能管理其他管理员' };
    }

    try {
      const pending = await getAuth().api.listInvitations({
        query: { organizationId: data.orgId },
        headers: await authHeaders(),
      });
      const now = Date.now();
      for (const invitation of pending) {
        if (
          invitation.status === 'pending' &&
          new Date(invitation.expiresAt).getTime() <= now
        ) {
          await getAuth().api.cancelInvitation({
            body: { invitationId: invitation.id },
            headers: await authHeaders(),
          });
        }
      }

      const invitation = await getAuth().api.createInvitation({
        body: {
          email: data.email,
          role: data.role,
          organizationId: data.orgId,
        },
        headers: await authHeaders(),
      });

      await logOrgActivity(user.id, data.orgId, ActivityType.INVITE_ORG_MEMBER);
      revalidatePath('/dashboard', 'layout');
      return {
        success: '邀请已创建，请把链接发送给对方。',
        inviteUrl: `${getServerConfig().BETTER_AUTH_URL}/sign-up?invite=${invitation.id}`,
      };
    } catch (error) {
      return mapAuthError(error);
    }
  }
);

export const acceptInviteAction = validatedActionWithUser(
  acceptInviteSchema,
  async (data, _, user) => {
    let accepted: Awaited<
      ReturnType<ReturnType<typeof getAuth>['api']['acceptInvitation']>
    >;
    try {
      accepted = await getAuth().api.acceptInvitation({
        body: { invitationId: data.invitationId },
        headers: await authHeaders(),
      });
    } catch (error) {
      return mapAuthError(error);
    }

    await logOrgActivity(
      user.id,
      accepted.member.organizationId,
      ActivityType.ACCEPT_INVITATION
    );
    revalidatePath('/dashboard', 'layout');
    return { success: '已加入组织' };
  }
);

export const removeOrgMember = validatedActionWithUser(
  removeOrgMemberSchema,
  async (data, _, user) => {
    const org = await getOrgById(user.id, data.orgId);
    if (!org) {
      return { error: '组织不存在或已归档' };
    }

    const role = await getOrgRole(user.id, data.orgId);
    if (!role || !hasPermission(role, 'member.manage')) {
      return { error: '只有所有者或管理员可以移除成员' };
    }

    const member = await findMember(user.id, data.orgId, data.memberId);
    if (!member) {
      return { error: '该成员不在此组织中' };
    }
    if (member.userId === user.id) {
      return { error: '不能移除自己，请先转让所有权' };
    }
    if (member.role === 'owner') {
      return { error: '不能移除最后一个所有者' };
    }
    if (role === 'admin' && member.role === 'admin') {
      return { error: '管理员不能管理其他管理员' };
    }

    try {
      await getAuth().api.removeMember({
        body: { memberIdOrEmail: member.id, organizationId: data.orgId },
        headers: await authHeaders(),
      });
    } catch (error) {
      return mapAuthError(error);
    }

    await logOrgActivity(user.id, data.orgId, ActivityType.REMOVE_ORG_MEMBER);
    revalidatePath('/dashboard', 'layout');
    return { success: '已移除组织成员' };
  }
);

export const updateOrgMemberRole = validatedActionWithUser(
  updateOrgMemberRoleSchema,
  async (data, _, user) => {
    const org = await getOrgById(user.id, data.orgId);
    if (!org) {
      return { error: '组织不存在或已归档' };
    }

    const role = await getOrgRole(user.id, data.orgId);
    if (!role || !hasPermission(role, 'member.manage')) {
      return { error: '你没有调整该成员角色的权限' };
    }

    const member = await findMember(user.id, data.orgId, data.memberId);
    if (!member) {
      return { error: '该成员不在此组织中' };
    }
    if (member.role === 'owner') {
      return { error: '不能修改所有者的角色' };
    }
    if (
      role === 'admin' &&
      (member.role === 'admin' || data.role === 'admin')
    ) {
      return { error: '管理员不能管理其他管理员' };
    }
    if (member.role === data.role) {
      return { error: '该成员已经是此角色' };
    }

    try {
      await getAuth().api.updateMemberRole({
        body: {
          role: data.role,
          memberId: member.id,
          organizationId: data.orgId,
        },
        headers: await authHeaders(),
      });
    } catch (error) {
      return mapAuthError(error);
    }

    await logOrgActivity(user.id, data.orgId, ActivityType.UPDATE_MEMBER_ROLE);
    revalidatePath('/dashboard', 'layout');
    return { success: '成员角色已更新' };
  }
);
