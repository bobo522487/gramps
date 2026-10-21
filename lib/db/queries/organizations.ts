import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../drizzle';
import type { Organization, OrgDataWithMembers } from '../schema';
import {
  activityLogs,
  invitations,
  organizations,
  orgMembers,
  users,
} from '../schema';

/** All organizations the user belongs to, with their role in each. */
export async function getOrgsForUser(userId: number) {
  return await db
    .select({
      organization: organizations,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(eq(orgMembers.userId, userId))
    .orderBy(organizations.id);
}

export async function getOrgWithMembersById(
  orgId: number
): Promise<OrgDataWithMembers | null> {
  const org = await getOrgById(orgId);
  if (!org) {
    return null;
  }

  const members = await db
    .select({
      id: orgMembers.id,
      userId: orgMembers.userId,
      role: orgMembers.role,
      joinedAt: orgMembers.joinedAt,
      orgId: orgMembers.orgId,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, org.id), isNull(users.deletedAt)));

  return { ...org, orgMembers: members };
}

export async function getOrgById(orgId: number): Promise<Organization | null> {
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return rows[0] ?? null;
}

/** Resolves the org and the user's role in one membership-scoped lookup. */
export async function getOrgWithRoleBySlug(userId: number, slug: string) {
  const rows = await db
    .select({
      organization: organizations,
      role: orgMembers.role,
    })
    .from(organizations)
    .innerJoin(
      orgMembers,
      and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, userId))
    )
    .where(eq(organizations.slug, slug))
    .limit(1);

  return rows[0] ?? null;
}

/** Single-row role lookup; do not fetch every organization to find one role. */
export async function getOrgRoleForUser(
  userId: number,
  orgId: number
): Promise<string | null> {
  const rows = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)))
    .limit(1);

  return rows[0]?.role ?? null;
}

export async function renameOrg(orgId: number, name: string) {
  const rows = await db
    .update(organizations)
    .set({ name, updatedAt: new Date() })
    .where(eq(organizations.id, orgId))
    .returning();
  return rows[0] ?? null;
}

/** Deleting the org cascades to projects via FKs. */
export async function deleteOrg(orgId: number) {
  await db.transaction(async (tx) => {
    await tx.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
    await tx.delete(invitations).where(eq(invitations.orgId, orgId));
    await tx.delete(activityLogs).where(eq(activityLogs.orgId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
}

export async function isUserInOrgByEmail(
  email: string,
  orgId: number
): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(orgMembers, eq(users.id, orgMembers.userId))
    .where(
      and(
        eq(users.email, email),
        eq(orgMembers.orgId, orgId),
        isNull(users.deletedAt)
      )
    )
    .limit(1);

  return rows.length > 0;
}
