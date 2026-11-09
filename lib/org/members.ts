import 'server-only';

import { eq, inArray } from 'drizzle-orm';
import { getAuthDb } from '@/lib/db/auth-db';
import { withOrg } from '@/lib/db/drizzle';
import { orgMembers, users } from '@/lib/db/schema';

export type OrgMemberView = {
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
};

/**
 * 成员名单分两段读：成员行（含角色 / 加入时间）走业务连接，由 RLS 圈定可见
 * 范围；姓名与邮箱在 `auth.user`，业务角色读不到那张表（附录 A.0 / A.6——
 * 应用侧读邮箱走 SECURITY DEFINER 函数或 auth_service 连接），按 id 集合
 * 经 auth 连接补齐。T28 拆掉 organization 插件后这就是唯一的成员列表路径。
 */
export async function listOrgMembers(
  actorId: string,
  organizationId: string
): Promise<OrgMemberView[]> {
  const members = await withOrg(actorId, (tx) =>
    tx
      .select({
        userId: orgMembers.userId,
        role: orgMembers.role,
        joinedAt: orgMembers.createdAt,
      })
      .from(orgMembers)
      .where(eq(orgMembers.organizationId, organizationId))
  );

  if (members.length === 0) {
    return [];
  }

  const profiles = await getAuthDb()
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, members.map((m) => m.userId)));
  const byId = new Map(profiles.map((p) => [p.id, p]));

  return members.map((m) => {
    const profile = byId.get(m.userId);
    return {
      userId: m.userId,
      name: profile?.name ?? '',
      email: profile?.email ?? '',
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    };
  });
}
