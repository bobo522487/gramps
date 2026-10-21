import 'server-only';

import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/session';
import { generatePublicId } from '@/lib/ids';
import { db } from './drizzle';
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

export async function getUserWithOrg(userId: number) {
  const result = await db
    .select({
      user: users,
      orgId: orgMembers.orgId,
      role: orgMembers.role,
    })
    .from(users)
    .leftJoin(orgMembers, eq(users.id, orgMembers.userId))
    .where(eq(users.id, userId))
    .limit(1);

  return result[0];
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
    .where(eq(orgMembers.orgId, org.id));

  return { ...org, orgMembers: members };
}

export async function logActivity(
  orgId: number | null | undefined,
  userId: number,
  type: ActivityType,
  ipAddress?: string
) {
  if (orgId === null || orgId === undefined) {
    return;
  }
  await db.insert(activityLogs).values({
    orgId,
    userId,
    action: type,
    ipAddress: ipAddress || '',
  });
}

// --- Sign-in / sign-up -------------------------------------------------------

export async function findUserWithOrgByEmail(email: string) {
  const rows = await db
    .select({
      user: users,
      organization: organizations,
    })
    .from(users)
    .leftJoin(orgMembers, eq(users.id, orgMembers.userId))
    .leftJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(eq(users.email, email))
    .limit(1);

  return rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0] ?? null;
}

export async function createUser(email: string, passwordHash: string) {
  const [createdUser] = await db
    .insert(users)
    .values({ email, passwordHash, role: 'owner' })
    .returning();
  return createdUser ?? null;
}

export async function findPendingInvitation(inviteId: string) {
  const id = parseInt(inviteId, 10);
  if (Number.isNaN(id)) return null;

  const [invitation] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.id, id), eq(invitations.status, 'pending')))
    .limit(1);

  if (!invitation) return null;
  return invitation;
}

export async function acceptInvitation(invitationId: number) {
  await db
    .update(invitations)
    .set({ status: 'accepted' })
    .where(eq(invitations.id, invitationId));
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

export async function createOrg(name: string): Promise<Organization | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [createdOrg] = await db
        .insert(organizations)
        .values({ name, slug: generatePublicId() })
        .returning();
      return createdOrg ?? null;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }
  throw new Error('Failed to generate a unique organization slug');
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

export async function addOrgMember(params: {
  userId: number;
  orgId: number;
  role: string;
}) {
  await db.insert(orgMembers).values(params);
}

/**
 * Removes a member only if they belong to the given org.
 * Returns the org id when a row was deleted, null otherwise.
 */
export async function removeMemberFromOrg(params: {
  memberId: number;
  orgId: number;
}): Promise<number | null> {
  const rows = await db
    .delete(orgMembers)
    .where(
      and(
        eq(orgMembers.id, params.memberId),
        eq(orgMembers.orgId, params.orgId)
      )
    )
    .returning({ orgId: orgMembers.orgId });

  return rows[0]?.orgId ?? null;
}

export async function isUserInOrgByEmail(
  email: string,
  orgId: number
): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(orgMembers, eq(users.id, orgMembers.userId))
    .where(and(eq(users.email, email), eq(orgMembers.orgId, orgId)))
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
  await db
    .update(users)
    .set({
      passwordHash,
      tokenVersion: sql`${users.tokenVersion} + 1`,
    })
    .where(eq(users.id, userId));
}

export async function updateUserProfile(params: {
  userId: number;
  name: string;
  email: string;
}) {
  const { userId, name, email } = params;
  await db.update(users).set({ name, email }).where(eq(users.id, userId));
}

/** Soft delete + leave orgs + bump tokenVersion (revokes all sessions). */
export async function softDeleteUser(userId: number, orgId?: number | null) {
  await db
    .update(users)
    .set({
      deletedAt: sql`CURRENT_TIMESTAMP`,
      email: sql`CONCAT(email, '-', id, '-deleted')`, // Ensure email uniqueness
      tokenVersion: sql`${users.tokenVersion} + 1`,
    })
    .where(eq(users.id, userId));

  if (orgId) {
    await db
      .delete(orgMembers)
      .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)));
  }
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
  // org/slug is unique; append a suffix on collision
  const slug = await pickUniqueSlug(base, params.orgId);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [createdProject] = await db
        .insert(projects)
        .values({ ...params, slug, ref: generatePublicId() })
        .returning();
      return createdProject ?? null;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }
  throw new Error('Failed to generate a unique project ref');
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

async function pickUniqueSlug(base: string, orgId: number): Promise<string> {
  let candidate = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.slug, candidate)))
      .limit(1);
    if (existing.length === 0) {
      return candidate;
    }
    candidate = `${base}-${randomBytes(2).toString('hex')}`;
  }
  throw new Error('Failed to generate a unique project slug');
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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}
