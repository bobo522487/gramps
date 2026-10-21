import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { queryRows, withOrg } from '../drizzle';
import type { Organization } from '../schema';
import { organizations, orgMembers } from '../schema';

export type OrgMemberRecord = {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  name: string | null;
  email: string;
};

export type OrgWithMembers = Organization & {
  members: OrgMemberRecord[];
};

/** All organizations the user belongs to, with their role in each. */
export async function getOrgsForUser(userId: string) {
  return withOrg(userId, (tx) =>
    tx
      .select({
        organization: organizations,
        role: orgMembers.role,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(
        and(
          eq(orgMembers.userId, userId),
          isNull(orgMembers.deletedAt),
          isNull(organizations.deletedAt)
        )
      )
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
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
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
          eq(orgMembers.orgId, organizations.id),
          eq(orgMembers.userId, userId),
          isNull(orgMembers.deletedAt)
        )
      )
      .where(and(eq(organizations.slug, slug), isNull(organizations.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  });
}

/**
 * Member names and emails live in auth.users, which app_rw cannot read
 * directly; the SECURITY DEFINER function returns only this org's members.
 */
export async function getOrgWithMembersById(
  userId: string,
  orgId: string
): Promise<OrgWithMembers | null> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .limit(1);
    const org = rows[0];
    if (!org) {
      return null;
    }

    const members = await queryRows<{
      id: string;
      userId: string;
      role: string;
      createdAt: Date;
      name: string | null;
      email: string;
    }>(tx, sql`select * from auth.list_org_members(${orgId}::uuid)`);

    return {
      ...org,
      members: members.map((member) => ({
        id: member.id,
        userId: member.userId,
        role: member.role,
        createdAt: member.createdAt,
        name: member.name,
        email: member.email,
      })),
    };
  });
}

export async function renameOrg(
  userId: string,
  orgId: string,
  name: string
): Promise<Organization | null> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .update(organizations)
      .set({ name })
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .returning();
    return rows[0] ?? null;
  });
}

/**
 * Soft delete: app_rw has no DELETE grant. The org disappears from every
 * navigation entry; content rows stay for a future restore/export flow.
 */
export async function archiveOrg(
  userId: string,
  orgId: string
): Promise<Organization | null> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .update(organizations)
      .set({ status: 'closed', deletedAt: new Date() })
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .returning();
    return rows[0] ?? null;
  });
}

export async function isUserInOrgByEmail(
  userId: string,
  email: string,
  orgId: string
): Promise<boolean> {
  return withOrg(userId, async (tx) => {
    const rows = await queryRows<{ found: boolean }>(
      tx,
      sql`select auth.is_user_in_org_by_email(${email}, ${orgId}::uuid) as found`
    );
    return rows[0]?.found ?? false;
  });
}
