import 'server-only';

import { randomBytes } from 'node:crypto';
import { and, count, desc, eq } from 'drizzle-orm';
import { generatePublicId } from '@/lib/ids';
import { db } from '../drizzle';
import { isUniqueViolation } from '../errors';
import type { Project } from '../schema';
import { organizations, orgMembers, projects } from '../schema';

export async function getProjects(orgId: number): Promise<Project[]> {
  return await db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .orderBy(desc(projects.createdAt));
}

export async function countProjects(orgId: number): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(projects)
    .where(eq(projects.orgId, orgId));
  return rows[0]?.value ?? 0;
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
