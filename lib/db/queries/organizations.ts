import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { withOrg } from '../drizzle';
import type { Organization } from '../schema';
import { organizations, orgMembers } from '../schema';

/** All active organizations the user belongs to, with their role in each. */
export async function getOrgsForUser(userId: string) {
  return withOrg(userId, (tx) =>
    tx
      .select({
        organization: organizations,
        role: orgMembers.role,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.organizationId, organizations.id))
      .where(
        and(eq(orgMembers.userId, userId), isNull(organizations.deletedAt))
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
          eq(orgMembers.organizationId, organizations.id),
          eq(orgMembers.userId, userId)
        )
      )
      .where(and(eq(organizations.slug, slug), isNull(organizations.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  });
}

/**
 * Organizations where the user is the only owner. Archived organizations are
 * excluded: they no longer block account deletion or ownership transfers.
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
          isNull(organizations.deletedAt),
          sql`(select count(*) from organization_member owners
               where owners.organization_id = ${organizations.id}
                 and owners.role = 'owner') <= 1`
        )
      );

    return rows.map((row) => row.name);
  });
}
