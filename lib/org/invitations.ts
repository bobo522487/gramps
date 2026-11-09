import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { withOrg } from '@/lib/db/drizzle';
import { invitations } from '@/lib/db/schema';

/** 邀请链接有效期。与旧插件配置的 7 天一致（`SEVEN_DAYS_IN_SECONDS`）。 */
export const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** token 只在这里以明文出现；库里存 sha256（附录 A.1）。 */
const TOKEN_BYTES = 32;

/**
 * token 撞车的重试预算。32 字节随机值的碰撞概率是 2^-256 量级，撞到基本
 * 只可能是有人拿确定性输入灌库，所以 3 次足够；再多只是把故障藏起来。
 */
const TOKEN_ATTEMPTS = 3;

export type IssuedInvitation = {
  token: string;
  expiresAt: Date;
};

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newToken(): string {
  // base64url：可以直接进 URL，不用再 escape；32 字节 → 43 个字符。
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * 签发（或重发）一封邀请，返回**明文 token**。
 *
 * 走附录 A.7 的参数化 `INSERT … ON CONFLICT (organization_id, email) DO UPDATE`：
 * 同一组织同一邮箱只有一行，重发 = 换 token + 续期 + 置回 `pending`。
 *
 * 三个刻意的选择：
 *
 * 1. **`role` 不在 `SET` 里**。重发不是改权限。管理员想调整角色要走独立的
 *    写入路径；在这里顺手同步，等于让「再发一次邮件」变成一次静默提权。
 * 2. **`WHERE invite.accepted_at IS NULL`**。已接受的邀请重发必须是 0 行——
 *    否则把已经加入的人退回 `pending`，他会凭空多一条「待加入」提示，而
 *    `organization_member` 里的成员行还在，两个状态互相矛盾。0 行由调用方
 *    转成业务错误。
 * 3. **`token_hash` 撞车单独重试**。`ON CONFLICT` 只处理 `(organization_id,
 *    email)` 冲突；`token_hash` 上的 UNIQUE 是另一条约束，撞了抛 `23505`
 *    而不会被 `DO UPDATE` 吃掉。
 */
export async function issueInvitation(params: {
  actorId: string;
  organizationId: string;
  email: string;
  role: string;
}): Promise<
  | { ok: true; invitation: IssuedInvitation }
  | { ok: false; reason: 'accepted' | 'token_collision' }
> {
  const email = params.email.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_SECONDS * 1000);

  for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
    const token = newToken();
    const tokenHash = hashInviteToken(token);

    try {
      const rows = await withOrg(params.actorId, (tx) =>
        tx
          .insert(invitations)
          .values({
            organizationId: params.organizationId,
            email,
            role: params.role,
            tokenHash,
            expiresAt,
            invitedBy: params.actorId,
          })
          .onConflictDoUpdate({
            target: [invitations.organizationId, invitations.email],
            set: {
              tokenHash: sql`excluded.token_hash`,
              expiresAt: sql`excluded.expires_at`,
              invitedBy: sql`excluded.invited_by`,
              status: 'pending',
              acceptedAt: null,
            },
            // A.7 的 `WHERE invite.accepted_at IS NULL`：已接受的邀请重发是 0 行。
            where: sql`${invitations.acceptedAt} is null`,
          })
          .returning({ id: invitations.id })
      );

      if (rows.length === 0) {
        return { ok: false, reason: 'accepted' };
      }

      return { ok: true, invitation: { token, expiresAt } };
    } catch (error) {
      if (isTokenHashCollision(error)) {
        continue;
      }
      throw error;
    }
  }

  return { ok: false, reason: 'token_collision' };
}

/**
 * `23505` 且约束名是 `invite_token_hash_key`。
 *
 * 只认约束名，不认「任意唯一冲突」：同一次插入还可能撞
 * `invite_email_unique`（并发重发），把它也当成撞车去重试，就会用一个
 * 新的随机 token 反复制造同一个邮箱冲突，最后报出一个与真实原因无关的错。
 */
export function isTokenHashCollision(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const value = error as { code?: unknown; constraint_name?: unknown };
  return (
    value.code === '23505' && value.constraint_name === 'invite_token_hash_key'
  );
}

export type InvitationPreview = {
  organizationName: string;
  role: string;
  expiresAt: string;
};

/**
 * 待加入者能看到的全部信息。走 `app.invite_join_preview`——他在接受之前
 * 不是成员，`invite` 的 org_isolation 让他一行都看不见。
 *
 * 返回 null = 链接无效（不存在 / 已消费 / 已过期的三合一）。这里刻意**不**
 * 区分原因：区分了就成了一张「这个 token 曾经存在过」的探测接口。
 */
export async function previewInvitation(
  actorId: string,
  token: string
): Promise<InvitationPreview | null> {
  const tokenHash = hashInviteToken(token);
  const rows = await withOrg(actorId, (tx) =>
    tx.execute(
      sql`select organization_name, role, expires_at
            from app.invite_join_preview(${tokenHash})`
    )
  );
  const row = rows[0] as
    | { organization_name?: string; role?: string; expires_at?: string }
    | undefined;
  if (!row?.organization_name) {
    return null;
  }
  return {
    organizationName: row.organization_name,
    role: row.role ?? 'viewer',
    expiresAt: new Date(row.expires_at ?? Date.now()).toISOString(),
  };
}

/**
 * 成员管理页的待处理邀请列表。自建 token 之后业务层自己读 `invite`，
 * 不再有 `listInvitations` 可用。
 *
 * 不选 `token_hash`：视图不需要它，而每多一处出现在查询结果里，就多一处
 * 可能被日志或错误上报带走。
 */
export async function listPendingInvitations(actorId: string, orgId: string) {
  return withOrg(actorId, (tx) =>
    tx
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.organizationId, orgId),
          eq(invitations.status, 'pending')
        )
      )
      .orderBy(invitations.createdAt)
  );
}

/**
 * 撤销：`status` 置 `revoked`。
 *
 * 不删行：邀请链接可能已经被转发出去，删掉后同一个 token 会被
 * `app.accept_invite` 判成「无效」而不是「已撤销」，用户拿到的是
 * 与事实不符的解释。
 */
export async function revokeInvitation(params: {
  actorId: string;
  organizationId: string;
  invitationId: string;
}): Promise<boolean> {
  const rows = await withOrg(params.actorId, (tx) =>
    tx
      .update(invitations)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(invitations.organizationId, params.organizationId),
          eq(invitations.id, params.invitationId),
          eq(invitations.status, 'pending')
        )
      )
      .returning({ id: invitations.id })
  );
  return rows.length > 0;
}
