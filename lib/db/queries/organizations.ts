import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { withOrg } from '../drizzle';
import type { Organization } from '../schema';
import { organizations, orgMembers } from '../schema';

/**
 * 组织状态里唯一改变「能不能进」的是 `closed`（附录 A.1 的
 * `ck_organization_status` 三值域）。目标态没有 `deleted_at`，关停的组织仍在
 * 表里，所以这层判断搬到查询层来做；`suspended` 属临时限制，登录仍放行。
 */
const notClosed = sql`${organizations.status} <> 'closed'`;

/** All organizations the user belongs to that they can still open, with role. */
export async function getOrgsForUser(userId: string) {
  return withOrg(userId, (tx) =>
    tx
      .select({
        organization: organizations,
        role: orgMembers.role,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.organizationId, organizations.id))
      .where(and(eq(orgMembers.userId, userId), notClosed))
      .orderBy(organizations.createdAt)
  );
}

export async function getOrgById(
  userId: string,
  orgId: string
): Promise<Organization | null> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, orgId), notClosed))
      .limit(1);
    return rows[0] ?? null;
  });
}

/** Resolves the org and the user's role in one membership-scoped lookup. */
export async function getOrgWithRoleBySlug(userId: string, slug: string) {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({
        organization: organizations,
        role: orgMembers.role,
      })
      .from(organizations)
      .innerJoin(
        orgMembers,
        and(
          eq(orgMembers.organizationId, organizations.id),
          eq(orgMembers.userId, userId)
        )
      )
      .where(and(eq(organizations.slug, slug), notClosed))
      .limit(1);

    return rows[0] ?? null;
  });
}

/**
 * Same lookup by internal id, so actions that already have the UUID do not
 * need `getOrgById` + `getOrgRole` (two transactions) just to learn the role.
 */
export async function getOrgWithRoleById(userId: string, orgId: string) {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({
        organization: organizations,
        role: orgMembers.role,
      })
      .from(organizations)
      .innerJoin(
        orgMembers,
        and(
          eq(orgMembers.organizationId, organizations.id),
          eq(orgMembers.userId, userId)
        )
      )
      .where(and(eq(organizations.id, orgId), notClosed))
      .limit(1);

    return rows[0] ?? null;
  });
}

/**
 * Organizations where the user is the only owner. Target state has no soft
 * delete, so the filters left are the membership pair, the owner count and
 * the closed gate.
 *
 * `notClosed` 不能省：漏掉它会造成一个真实的死锁——组织归档后仍被算作
 * 「唯一所有者」，`deleteAccount` 于是永久拒绝销号，而它给用户的提示是
 * 「先把组织归档」，可归档动作又只作用于 `status = 'active'` 的组织，
 * 用户照着做也无路可走。
 */
export async function getSoleOwnerOrgNames(userId: string): Promise<string[]> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .innerJoin(orgMembers, eq(orgMembers.organizationId, organizations.id))
      .where(
        and(
          eq(orgMembers.userId, userId),
          eq(orgMembers.role, 'owner'),
          notClosed,
          sql`(select count(*) from organization_member owners
               where owners.organization_id = ${organizations.id}
                 and owners.role = 'owner') <= 1`
        )
      );

    return rows.map((row) => row.name);
  });
}
