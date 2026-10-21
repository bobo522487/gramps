import 'server-only';

import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { withOrg } from '../drizzle';
import type { Project } from '../schema';
import { organizations, orgMembers, projects } from '../schema';

export async function getProjects(
  userId: string,
  orgId: string
): Promise<Project[]> {
  return withOrg(userId, (tx) =>
    tx
      .select()
      .from(projects)
      .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt)))
      .orderBy(desc(projects.createdAt))
  );
}

export async function countProjects(
  userId: string,
  orgId: string
): Promise<number> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({ value: count() })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt)));
    return rows[0]?.value ?? 0;
  });
}

/** Scoped by orgId so a project from another org is never returned. */
export async function getProjectById(
  userId: string,
  projectId: string,
  orgId: string
): Promise<Project | null> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.orgId, orgId),
          isNull(projects.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  });
}

/** Resolves project, org and role together, scoped to the signed-in user. */
export async function getProjectScopeByRef(userId: string, ref: string) {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({
        project: projects,
        organization: organizations,
        role: orgMembers.role,
      })
      .from(projects)
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .innerJoin(
        orgMembers,
        and(
          eq(orgMembers.orgId, organizations.id),
          eq(orgMembers.userId, userId),
          isNull(orgMembers.deletedAt)
        )
      )
      .where(
        and(
          eq(projects.ref, ref),
          isNull(projects.deletedAt),
          isNull(organizations.deletedAt)
        )
      )
      .limit(1);

    return rows[0] ?? null;
  });
}
