import 'server-only';

import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/session';
import { generatePublicId } from '@/lib/ids';
import { db } from './drizzle';
import { isUniqueViolation } from './errors';
import type {
  ActivityType,
  Organization,
  OrgDataWithMembers,
  Project,
  User,
} from './schema';
import {
  activityLogs,
  invitations,
  organizations,
  orgMembers,
  projects,
  users,
} from './schema';

export async function getUser() {
  const sessionCookie = (await cookies()).get('session');
  if (!sessionCookie?.value) {
    return null;
  }

  const sessionData = await verifyToken(sessionCookie.value);
  if (!sessionData?.user || typeof sessionData.user.id !== 'number') {
    return null;
  }

  if (new Date(sessionData.expires) < new Date()) {
    return null;
  }

  const user = await db
    .select({
      user: users,
      tokenVersion: sql<number>`coalesce(${users.tokenVersion}, 0)`,
    })
    .from(users)
    .where(and(eq(users.id, sessionData.user.id), isNull(users.deletedAt)))
    .limit(1);

  if (user.length === 0) {
    return null;
  }

  // Tokens issued before tokenVersion existed are treated as version 0
  if ((sessionData.tv ?? 0) !== user[0].tokenVersion) {
    return null;
  }

  return user[0].user;
}

export async function getActivityLogs() {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  return await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      timestamp: activityLogs.timestamp,
      ipAddress: activityLogs.ipAddress,
      userName: users.name,
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.userId, users.id))
    .where(eq(activityLogs.userId, user.id))
    .orderBy(desc(activityLogs.timestamp))
    .limit(10);
}

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

/** Account-level events pass a null org instead of guessing one of many. */
export async function logActivity(
  orgId: number | null | undefined,
  userId: number,
  type: ActivityType,
  ipAddress?: string
) {
  await db.insert(activityLogs).values({
    orgId: orgId ?? null,
    userId,
    action: type,
    ipAddress: ipAddress || '',
  });
}

// --- Sign-in / sign-up -------------------------------------------------------

export async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

// --- Organization management -------------------------------------------------

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

export async function findPendingInvitationByEmail(
  email: string,
  orgId: number
) {
  const rows = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.email, email),
        eq(invitations.orgId, orgId),
        eq(invitations.status, 'pending')
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function createInvitation(params: {
  orgId: number;
  email: string;
  role: string;
  invitedBy: number;
}) {
  await db.insert(invitations).values({ ...params, status: 'pending' });
}

// --- Account -----------------------------------------------------------------

export async function updateUserPassword(userId: number, passwordHash: string) {
  const rows = await db
    .update(users)
    .set({
      passwordHash,
      tokenVersion: sql`${users.tokenVersion} + 1`,
    })
    .where(eq(users.id, userId))
    .returning({ tokenVersion: users.tokenVersion });

  return rows[0] ?? null;
}

export async function updateUserProfile(params: {
  userId: number;
  name: string;
  email: string;
}) {
  const { userId, name, email } = params;
  await db.update(users).set({ name, email }).where(eq(users.id, userId));
}

// --- Projects ----------------------------------------------------------------

export async function getProjects(orgId: number): Promise<Project[]> {
  return await db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .orderBy(desc(projects.createdAt));
}

/** Scoped by orgId so a project from another org is never returned. */
export async function getProjectById(
  projectId: number,
  orgId: number
): Promise<Project | null> {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  );
}

export async function createProject(params: {
  orgId: number;
  name: string;
  region: string;
}): Promise<Project | null> {
  const base = slugify(params.name);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    // Regenerate both ids on every attempt: slug and ref each have their own
    // unique index, so a concurrent insert can collide on either one.
    const slug =
      attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;

    try {
      const [createdProject] = await db
        .insert(projects)
        .values({ ...params, slug, ref: generatePublicId() })
        .onConflictDoNothing()
        .returning();

      if (createdProject) {
        return createdProject;
      }
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  throw new Error('Failed to generate a unique project slug or ref');
}

/** Resolves project, org and role together, scoped to the signed-in user. */
export async function getProjectScopeByRef(userId: number, ref: string) {
  const rows = await db
    .select({
      project: projects,
      organization: organizations,
      role: orgMembers.role,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .innerJoin(
      orgMembers,
      and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, userId))
    )
    .where(eq(projects.ref, ref))
    .limit(1);

  return rows[0] ?? null;
}

export async function updateProject(
  projectId: number,
  orgId: number,
  updates: Partial<Pick<Project, 'name' | 'region' | 'status'>>
): Promise<Project | null> {
  const rows = await db
    .update(projects)
    .set(updates)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .returning();
  return rows[0] ?? null;
}

/** org-scoped delete so a projectId from another org is a no-op. */
export async function deleteProject(projectId: number, orgId: number) {
  const rows = await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .returning({ id: projects.id });
  return rows.length > 0;
}
