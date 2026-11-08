'use server';

import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
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
import { sqlStateOf } from '@/lib/db/errors';
import { getOrgById } from '@/lib/db/queries/organizations';
import { organizations, orgMembers } from '@/lib/db/schema';
import { generatePublicId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { hashInviteToken, issueInvitation } from '@/lib/org/invitations';

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
      // 自建 token 之后没有 `listInvitations`，「顺手清掉过期邀请」这一步
      // 也不再需要：`app.invite_join_preview` 与 `app.accept_invite` 都带
      // `expires_at > now()`，过期邀请无论 status 是 pending 还是别的都
      // 进不去。重发会原地覆盖同一行（附录 A.7），不会堆出多条。
      const issued = await issueInvitation({
        actorId: user.id,
        organizationId: data.orgId,
        email: data.email,
        role: data.role,
      });

      if (!issued.ok) {
        return issued.reason === 'accepted'
          ? { error: '该邮箱已是成员，无需重复邀请' }
          : { error: '邀请链接生成失败，请重试' };
      }

      revalidateWholeConsole();
      return {
        success: '邀请已创建，请把链接发送给对方。',
        // 明文 token 只在这里出现一次。库里只有 sha256——再也取不回来。
        inviteUrl: `${getServerConfig().BETTER_AUTH_URL}/join?token=${issued.invitation.token}`,
      };
    } catch (error) {
      return mapAuthError(error);
    }
  }
);

export const acceptInviteAction = validatedActionWithUser(
  acceptInviteSchema,
  async (data, _, user) => {
    // 凭据是**明文 token**，不是入库行 id。库里只有 sha256（附录 A.1），
    // 所以先把明文哈希掉，再交给 `app.accept_invite`。
    //
    // 三道判断一次性落在数据库函数里：token 有效且未过期、组织未关停、
    // 邀请邮箱与当前账号一致。放在应用层做会拆成三次往返，中间每一步都
    // 有窗口；放到函数里，`SELECT ... FOR UPDATE` 之后的重判才是原子的。
    const tokenHash = hashInviteToken(data.token);

    try {
      await withOrg(user.id, (tx) =>
        tx.execute(sql`select app.accept_invite(${tokenHash})`)
      );
    } catch (error) {
      return mapAcceptInviteError(error);
    }

    revalidateWholeConsole();
    return { success: '已加入组织' };
  }
);

/**
 * `app.accept_invite` 的三种业务失败都带自定义 SQLSTATE，逐条映射成人话。
 *
 * 不直接 `mapAuthError`：那一层只认 Better Auth 的 statusCode / error.code，
 * 碰到 `P0001` 之类的原始 SQLSTATE 会一律压成「操作失败，请稍后重试。」——
 * 用户拿着一封过期邀请只会看到一句无从下手的兜底文案。
 */
function mapAcceptInviteError(error: unknown) {
  // 必须走 `sqlStateOf` 而不是读 `error.code`：Drizzle 把驱动异常包成
  // `DrizzleQueryError(query, params, cause)`，SQLSTATE 只在 `cause` 上。
  // 直接读顶层 `code` 一律是 undefined，三个分支都命中不了，所有失败都会
  // 退化成「操作失败，请稍后重试。」——实测踩过。
  if (sqlStateOf(error, '22023')) {
    return { error: '邀请无效或已过期，请让管理员重新邀请' };
  }
  if (sqlStateOf(error, '42501')) {
    return { error: '该邀请不是发给当前账号的' };
  }
  if (sqlStateOf(error, '23505')) {
    return { error: '当前账号已是该组织成员' };
  }
  return mapAuthError(error);
}

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
