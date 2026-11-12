'use server';

import 'server-only';

import { eq, sql } from 'drizzle-orm';
import {
  authErrorMessage,
  isSlugConflict,
  mapAuthError,
} from '@/lib/auth/errors';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import { checkOrgPermission, getOrgRole } from '@/lib/auth/permissions';
import { getServerConfig } from '@/lib/config';
import { revalidateWholeConsole } from '@/lib/console/revalidate';
import { queryRows, withOrg } from '@/lib/db/drizzle';
import { pgErrorOf } from '@/lib/db/errors';
import { getOrgById } from '@/lib/db/queries/organizations';
import { organizations } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import { hashInviteToken, issueInvitation } from '@/lib/org/invitations';
import {
  acceptInviteSchema,
  createOrgSchema,
  deleteOrgSchema,
  inviteOrgMemberSchema,
  removeOrgMemberSchema,
  renameOrgSchema,
  updateOrgMemberRoleSchema,
} from '@/lib/org/schemas';

const SLUG_ATTEMPTS = 3;

export const createOrgAction = validatedActionWithUser(
  createOrgSchema,
  async (data, _, _user) => {
    let created: { id: string; slug: string } | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      try {
        // 建组织走 SECDEF 的 `app.create_organization`（附录 A.6，基线 590 行）：
        // 一个函数里同时落组织行 + owner 成员行，且 `created_by` 由
        // `app.current_user_id()` 取自事务内注入的 `app.user_id`。slug 用列默认
        // `public.generate_public_id()`，撞 `uk_organization_slug` 就整批回滚
        // 重试——组织与 owner 成员必须同生同死，拆成两条应用层写入做不到。
        created = await withOrg(_user.id, async (tx) => {
          const [row] = await queryRows<{ id: string }>(
            tx,
            sql`select app.create_organization(${data.name}) as id`
          );
          if (!row?.id) {
            throw new Error('app.create_organization 未返回组织 ID');
          }
          // 同事务回读：SECDEF 已插入 owner 成员行，RLS 视图随即可见。
          const rows = await tx
            .select({ id: organizations.id, slug: organizations.slug })
            .from(organizations)
            .where(eq(organizations.id, row.id))
            .limit(1);
          return rows[0] ?? null;
        });
        if (created) {
          break;
        }
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
    try {
      // 重命名走 SECDEF 的 app.rename_organization：owner 守卫、active 前置、
      // 组织存在性都在函数体内单事务原子判定，应用层不再分别预检。
      await withOrg(user.id, (tx) =>
        tx.execute(
          sql`select app.rename_organization(${data.orgId}, ${data.name})`
        )
      );
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
    try {
      // 归档收敛到 app.archive_organization（B4 收口）：函数体带
      // status = 'active' 条件、owner 守卫；重复归档由 22023 表达，
      // 文案统一交给 mapAuthError()。单事务，不再分别预检 org / 权限。
      await withOrg(user.id, (tx) =>
        tx.execute(sql`select app.archive_organization(${data.orgId})`)
      );
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
 * `app.accept_invite` 的业务失败走 `pgErrorOf()` 的单一 SQLSTATE 表：
 * 邀请域专用文案集中在 `MESSAGE_OVERRIDES`，这里不再散三条按码分支。
 * 未命中 SQLSTATE 的错误才回落到 Better Auth / HTTP status 兜底。
 */
function mapAcceptInviteError(error: unknown) {
  const pg = pgErrorOf(error);
  return pg ? { error: pg.message, code: pg.code } : mapAuthError(error);
}

export const removeOrgMember = validatedActionWithUser(
  removeOrgMemberSchema,
  async (data, _, user) => {
    try {
      // actor 角色、last-owner、不能移除自己、admin 不能管 admin 全部由
      // app.remove_org_member 在单事务内原子判定。成员寻址按 userId，
      // 动作入参 memberId 承载的就是 userId（附录 A.1）。
      await withOrg(user.id, (tx) =>
        tx.execute(
          sql`select app.remove_org_member(${data.orgId}, ${data.memberId})`
        )
      );
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
    try {
      // 权限、owner 保护、admin 不能管 admin、目标角色合法性全部由
      // app.set_org_member_role 在单事务内原子判定，应用层不再预检。
      await withOrg(user.id, (tx) =>
        tx.execute(
          sql`select app.set_org_member_role(${data.orgId}, ${data.memberId}, ${data.role})`
        )
      );
    } catch (error) {
      return mapAuthError(error);
    }

    revalidateWholeConsole();
    return { success: '成员角色已更新' };
  }
);
