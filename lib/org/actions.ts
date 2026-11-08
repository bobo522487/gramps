'use server';

import 'server-only';

import { and, eq } from 'drizzle-orm';
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
import { revalidateWholeConsole } from '@/lib/console/revalidate';
import { withOrg } from '@/lib/db/drizzle';
import { getOrgById } from '@/lib/db/queries/organizations';
import { organizations, orgMembers } from '@/lib/db/schema';
import { generatePublicId } from '@/lib/ids';
import { logger } from '@/lib/logger';

const SLUG_ATTEMPTS = 3;

async function authHeaders() {
  return headers();
}

/**
 * 成员表仍有代理主键 `id`（要去掉它必须同时去掉 Better Auth organization 插件，
 * 见 lib/db/schema/org.ts 的说明与 T28），所以这里按 `id` 查，与前端表单传的
 * `member.id` 一致。`userId` 一并选出，供「不能移除自己」这类判断使用。
 */
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
  async (data, _, _user) => {
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

    revalidateWholeConsole();
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

    revalidateWholeConsole();
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
      // 目标态没有软删，「归档」只剩这一个落点：把 status 写成 closed。
      // 原来这里调的是一个 SECURITY DEFINER 归档函数，它在旧迁移里，B0 重建
      // 基线后已不存在，按钮必然 500。
      // 权限已由上面的 `org.settings` 检查兜住，这里再按 status 加一次条件，
      // 保证并发下只有 `active` 的组织能被归档，避免把 `suspended` 覆盖成
      // `closed` 而丢失停用原因。
      const archived = await withOrg(user.id, async (tx) => {
        const rows = await tx
          .update(organizations)
          .set({ status: 'closed' })
          .where(
            and(
              eq(organizations.id, data.orgId),
              eq(organizations.status, 'active')
            )
          )
          .returning({ id: organizations.id });
        return rows.length;
      });

      if (archived === 0) {
        return { error: '组织已归档或已停用，无需重复操作' };
      }
    } catch (error) {
      return mapAuthError(error);
    }

    revalidateWholeConsole();
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

      revalidateWholeConsole();
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
  async (data, _, _user) => {
    let _accepted: Awaited<
      ReturnType<ReturnType<typeof getAuth>['api']['acceptInvitation']>
    >;
    try {
      _accepted = await getAuth().api.acceptInvitation({
        body: { invitationId: data.invitationId },
        headers: await authHeaders(),
      });
    } catch (error) {
      return mapAuthError(error);
    }

    revalidateWholeConsole();
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
        // 必须传 `member.id`：插件的 `crud-members` 走 `adapter.findMemberById()`，
        // 传 userId 只会 MEMBER_NOT_FOUND（uuid 列收到非 uuid 还可能 22P02）。
        // 成员表仍有代理主键（见 lib/db/schema/org.ts），去主键随 B4 / T28。
        body: { memberIdOrEmail: member.id, organizationId: data.orgId },
        headers: await authHeaders(),
      });
    } catch (error) {
      return mapAuthError(error);
    }

    revalidateWholeConsole();
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
          // 同 removeMember：插件按 `member.id` 定位，不是 `user_id`。
          memberId: member.id,
          organizationId: data.orgId,
        },
        headers: await authHeaders(),
      });
    } catch (error) {
      return mapAuthError(error);
    }

    revalidateWholeConsole();
    return { success: '成员角色已更新' };
  }
);
